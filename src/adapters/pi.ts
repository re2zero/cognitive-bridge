/**
 * pi 适配器：将 CognitiveBridge 接入 pi 的 ExtensionAPI。
 * 
 * 使用 pi 的钩子系统：input, before_agent_start, context, turn_end。
 */
import type { Persona } from '../types.js';
import type { DiaryEntry } from '../memory.js';
import { CognitiveBridge } from '../core.js';
import { loadPersona, savePersona } from '../storage.js';
import { buildMoodReport } from '../mood.js';

// ── pi 扩展 API 类型（简化声明）──

interface PiExtensionAPI {
  on(event: string, handler: Function): void;
}

interface PiEvent {
  text?: string;
  messages?: any[];
  source?: string;
  message?: any;
  systemPrompt?: string;
}

interface PiContext {
  sessionManager?: {
    getSessionId?(): string;
  };
  ui?: {
    notify?(message: string, level?: string): void;
  };
}

// ── 辅助函数 ──

/**
 * 构建日记上下文文本，注入到系统提示词。
 */
function buildDiaryContext(diary: DiaryEntry[]): string {
  if (diary.length === 0) return '';

  const lines = [
    '## 最近会话记录',
    ...diary.map(d => {
      const date = d.createdAt.slice(0, 10);
      return `- ${date}: ${d.title}`;
    }),
    ''
  ];

  return lines.join('\n');
}

// ── 适配器实现 ──

export function registerPiExtension(pi: PiExtensionAPI, bridge: CognitiveBridge): void {
  const LOG_TAG = '[cog:pi]';
  let pendingAnchor: string | null = null;
  let isCodingSession = false;

  // ── session_start：加载 persona + 日记 ──
  pi.on('session_start', (_event: any, _ctx: any) => {
    if (!bridge.awakened) {
      const p = loadPersona();
      if (p) {
        bridge.setPersona(p);
        console.error(`${LOG_TAG} Persona loaded: ${p.name}`);
      }
    }

    // 加载最近日记，注入到系统提示词
    const recentDiary = bridge.readDiary(3);
    if (recentDiary.length > 0) {
      const diaryContext = buildDiaryContext(recentDiary);
      console.error(`${LOG_TAG} Loaded ${recentDiary.length} recent diary entries`);
      // 日记上下文通过 before_agent_start 注入
      (pi as any)._cogDiaryContext = diaryContext;
    }

    console.error(`${LOG_TAG} Session started. Awakened: ${bridge.awakened}`);
  });

  // ── input：仪式检查 / 情绪识别 ──
  pi.on('input', async (event: PiEvent, ctx: PiContext) => {
    if (event?.source === 'extension') return { action: 'continue' };
    const text = event?.text || '';

    // 觉醒仪式
    if (bridge.needsCeremony()) {
      const result = bridge.handleCeremony(text);
      if (result.completed) savePersona(result.completed);
      ctx?.ui?.notify?.(result.response, 'info');
      return { action: 'handled' };
    }

    // /mood 命令
    if (text.trim().toLowerCase() === '/mood') {
      const state = bridge.currentState;
      const trend = bridge.emotionTrend();
      const report = buildMoodReport(state, trend, bridge.currentPersona);
      ctx?.ui?.notify?.(report, 'info');
      return { action: 'handled' };
    }

    // /memory 命令：查看记忆统计
    if (text.trim().toLowerCase() === '/memory') {
      const stats = bridge.getMemoryStats();
      const report = [
        '## 记忆统计',
        `- 总记忆数：${stats.totalMemories}`,
        `- 决策：${stats.memoriesByType.decision}`,
        `- Bug 修复：${stats.memoriesByType.bugfix}`,
        `- 发现：${stats.memoriesByType.discovery}`,
        `- 模式：${stats.memoriesByType.pattern}`,
        `- 偏好：${stats.memoriesByType.preference}`,
        `- 日记：${stats.totalDiaryEntries}`,
        `- 知识图谱事实：${stats.currentFacts}`,
        `- 待判断冲突：${stats.pendingConflicts}`,
        `- 数据库大小：${(stats.databaseSize / 1024).toFixed(1)} KB`
      ].join('\n');
      ctx?.ui?.notify?.(report, 'info');
      return { action: 'handled' };
    }

    // 正常流程：情绪识别
    const signal = bridge.lexiconIntent(text);
    const feedback = bridge.detectFeedback(text);
    bridge.advanceState(signal, feedback);
    const currentTrend = bridge.emotionTrend();
    console.error(
      `${LOG_TAG} Turn ${bridge.currentState.cycle}: ` +
      `emotion=${signal.emotion.toFixed(2)}, ` +
      `intensity=${signal.intensity.toFixed(2)}, ` +
      `trend=${currentTrend.toFixed(2)}, ` +
      `keywords=[${signal.keywords.join(',')}]`
    );

    // 编码任务检测
    if (bridge.isCodingTask(text)) {
      isCodingSession = true;
    } else if (isCodingSession && bridge.currentState.cycle > 10) {
      isCodingSession = false;
    }
    return { action: 'continue' };
  });

  // ── before_agent_start：注入身份 + 设置 NAP 锚点 ──
  pi.on('before_agent_start', async (event: PiEvent, _ctx: PiContext) => {
    const ret: Record<string, unknown> = {};

    // 身份注入（分层）
    if (bridge.awakened) {
      const layer = bridge.currentState.cycle === 0 ? 'full' : 'core';
      let identityBlock = bridge.buildIdentityBlock(layer);

      // 编码任务时追加 L3
      if (isCodingSession) {
        identityBlock += '\n\n' + bridge.buildIdentityBlock('coding');
      }

      // 日记上下文（只注入一次）
      const diaryContext = (pi as any)._cogDiaryContext;
      if (diaryContext) {
        identityBlock += '\n\n' + diaryContext;
        (pi as any)._cogDiaryContext = null;
      }

      ret.systemPrompt = identityBlock + '\n\n' + (event.systemPrompt || '');
    }

    // NAP 锚点
    if (bridge.currentState.cycle > 0) {
      const narrative = bridge.generateNarrative();
      pendingAnchor = narrative;
    }

    return Object.keys(ret).length > 0 ? ret : undefined;
  });

  // ── context：prepend 锚点到最新用户消息 ──
  pi.on('context', async (event: PiEvent, _ctx: PiContext) => {
    if (pendingAnchor === null) return undefined;
    const anchor = pendingAnchor;
    pendingAnchor = null;

    const messages = event.messages;
    if (!Array.isArray(messages)) return undefined;

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'user') {
        const content = typeof m.content === 'string' ? m.content : '';
        messages[i] = {
          ...m,
          content: `[认知状态]\n${anchor}\n[/认知状态]\n\n${content}`
        };
        return { messages };
      }
    }
    return undefined;
  });

  // ── turn_end：记录完成 + 工具调用 + 冲突检查 ──
  pi.on('turn_end', async (event: PiEvent, ctx: PiContext) => {
    console.error(`${LOG_TAG} Turn ${bridge.currentState.cycle} complete`);

    // 拦截 LLM 回复中的工具调用
    const message = event?.message;
    if (message) {
      const text = typeof message.content === 'string' ? message.content : '';
      processToolCalls(text, bridge, ctx);
    }

    // 检查待判断冲突
    const conflicts = bridge.getPendingConflicts();
    if (conflicts.length > 0) {
      for (const c of conflicts.slice(0, 3)) {
        ctx?.ui?.notify?.(
          `[cog] 记忆冲突待判断：${c.relation}（置信度 ${c.confidence.toFixed(2)}）`,
          'info'
        );
      }
    }
  });

  console.error(`${LOG_TAG} Extension loaded. Awakened: ${bridge.awakened}`);
}

// ── 工具调用处理 ──

/**
 * 解析并执行 LLM 回复中的工具调用。
 */
function processToolCalls(text: string, bridge: any, ctx: PiContext): void {
  const LOG_TAG = '[cog:tools]';

  // memorize 工具
  const memorizeMatch = text.match(/\[memorize\]([\s\S]*?)\[\/memorize\]/);
  if (memorizeMatch) {
    try {
      const params = parseParams(memorizeMatch[1]);
      const memory = bridge.memorize({
        type: params.type || 'decision',
        topic: params.topic || 'general',
        title: params.title || 'Untitled',
        content: params.content || '',
        topicKey: params.topicKey
      });
      console.error(`${LOG_TAG} Memory saved: ${memory.title}`);
      ctx?.ui?.notify?.(`[cog] 记忆已保存：${memory.title}`, 'info');
    } catch (e: any) {
      console.error(`${LOG_TAG} memorize error: ${e.message}`);
    }
  }

  // recall 工具
  const recallMatch = text.match(/\[recall\]([\s\S]*?)\[\/recall\]/);
  if (recallMatch) {
    try {
      const params = parseParams(recallMatch[1]);
      const results = bridge.recall(params.query || '', {
        topic: params.topic,
        type: params.type,
        limit: parseInt(params.limit) || 5
      });
      console.error(`${LOG_TAG} Recall: ${results.length} results for "${params.query}"`);
      if (results.length > 0) {
        const summary = results.map((r: any) => `- ${r.title} (${r.createdAt.slice(0, 10)})`).join('\n');
        ctx?.ui?.notify?.(`[cog] 找到 ${results.length} 条相关记忆：\n${summary}`, 'info');
      }
    } catch (e: any) {
      console.error(`${LOG_TAG} recall error: ${e.message}`);
    }
  }

  // addFact 工具
  const addFactMatch = text.match(/\[addFact\]([\s\S]*?)\[\/addFact\]/);
  if (addFactMatch) {
    try {
      const params = parseParams(addFactMatch[1]);
      const fact = bridge.addFact(params.subject, params.predicate, params.object);
      console.error(`${LOG_TAG} Fact added: ${fact.subject} → ${fact.predicate} → ${fact.object}`);
    } catch (e: any) {
      console.error(`${LOG_TAG} addFact error: ${e.message}`);
    }
  }

  // writeDiary 工具
  const writeDiaryMatch = text.match(/\[writeDiary\]([\s\S]*?)\[\/writeDiary\]/);
  if (writeDiaryMatch) {
    try {
      const params = parseParams(writeDiaryMatch[1]);
      const entry = bridge.writeDiary(params.title || 'Session diary', params.content || '');
      console.error(`${LOG_TAG} Diary written: ${entry.title}`);
    } catch (e: any) {
      console.error(`${LOG_TAG} writeDiary error: ${e.message}`);
    }
  }
}

/**
 * 解析工具参数（URL query string 格式）。
 */
function parseParams(paramString: string): Record<string, string> {
  const params: Record<string, string> = {};

  // 支持两种格式：
  // 1. type=decision&topic=architecture
  // 2. type: decision\n topic: architecture

  // 尝试 URL query string 格式
  const urlParams = new URLSearchParams(paramString);
  for (const [key, value] of urlParams.entries()) {
    if (value) params[key] = value;
  }

  // 如果 URL 格式没有解析到内容，尝试 key: value 格式
  if (!params.content) {
    const lines = paramString.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*(\w+)\s*:\s*(.+)\s*$/);
      if (match) {
        params[match[1]] = match[2].trim();
      }
    }
  }

  return params;
}

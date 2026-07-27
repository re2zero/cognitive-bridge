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

  // ── turn_end：记录完成 + 冲突检查 ──
  pi.on('turn_end', async (event: PiEvent, ctx: PiContext) => {
    console.error(`${LOG_TAG} Turn ${bridge.currentState.cycle} complete`);

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


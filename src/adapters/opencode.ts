/**
 * opencode 适配器：将 CognitiveBridge 接入 opencode 的插件系统。
 * 
 * opencode 使用 plugins/ 目录，插件是 TypeScript 文件。
 */
import type { OpencodePlugin } from '../types.js';
import type { DiaryEntry } from '../memory.js';
import { CognitiveBridge } from '../core.js';
import { buildMoodReport } from '../mood.js';

// ── 辅助函数 ──

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

export function createOpencodePlugin(bridge: CognitiveBridge): OpencodePlugin {
  const LOG_TAG = '[cog:opencode]';
  let isCodingSession = false;
  let diaryContextInjected = false;

  return {
    name: 'cog',

    async onUserMessage(message: string) {
      // 仪式检查
      if (bridge.needsCeremony()) {
        const result = bridge.handleCeremony(message);
        return { text: result.response };
      }

      // /mood 命令
      if (message.trim().toLowerCase() === '/mood') {
        const state = bridge.currentState;
        const trend = bridge.emotionTrend();
        const report = buildMoodReport(state, trend, bridge.currentPersona);
        return { text: report };
      }

      // /memory 命令
      if (message.trim().toLowerCase() === '/memory') {
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
        return { text: report };
      }

      // 编码任务检测
      if (bridge.isCodingTask(message)) {
        isCodingSession = true;
      } else if (isCodingSession && bridge.currentState.cycle > 10) {
        isCodingSession = false;
      }

      // 情绪识别 + 反馈检测
      const signal = bridge.lexiconIntent(message);
      const feedback = bridge.detectFeedback(message);
      bridge.advanceState(signal, feedback);
      const trend = bridge.emotionTrend();
      console.error(
        `${LOG_TAG} Turn ${bridge.currentState.cycle}: ` +
        `emotion=${signal.emotion.toFixed(2)}, ` +
        `trend=${trend.toFixed(2)}`
      );

      // 生成叙事锚点 + 身份注入
      const narrative = bridge.generateNarrative();
      const layer = bridge.currentState.cycle <= 1 ? 'full' : 'core';
      let identityBlock = bridge.buildIdentityBlock(layer);
      if (isCodingSession) {
        identityBlock += '\n\n' + bridge.buildIdentityBlock('coding');
      }

      // 日记上下文（只注入一次）
      if (!diaryContextInjected) {
        const recentDiary = bridge.readDiary(3);
        if (recentDiary.length > 0) {
          identityBlock += '\n\n' + buildDiaryContext(recentDiary);
        }
        diaryContextInjected = true;
      }

      return {
        text: `${identityBlock}\n\n[认知状态]\n${narrative}\n[/认知状态]\n\n${message}`
      };
    },

    async onAssistantMessage(message: string) {
      // 拦截工具调用
      processToolCalls(message, bridge);
      return null;
    },

    async onTurnEnd() {
      console.error(`${LOG_TAG} Turn ${bridge.currentState.cycle} complete`);

      // 检查待判断冲突
      const conflicts = bridge.getPendingConflicts();
      if (conflicts.length > 0) {
        console.error(
          `${LOG_TAG} Pending conflicts: ${conflicts.length}`
        );
      }
    }
  };
}


// ── 工具调用处理 ──

function processToolCalls(text: string, bridge: any): void {
  const LOG_TAG = '[cog:tools]';

  // memorize
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
    } catch (e: any) {
      console.error(`${LOG_TAG} memorize error: ${e.message}`);
    }
  }

  // recall
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
    } catch (e: any) {
      console.error(`${LOG_TAG} recall error: ${e.message}`);
    }
  }

  // addFact
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

  // writeDiary
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

function parseParams(paramString: string): Record<string, string> {
  const params: Record<string, string> = {};
  const urlParams = new URLSearchParams(paramString);
  for (const [key, value] of urlParams.entries()) {
    if (value) params[key] = value;
  }
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
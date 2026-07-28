/**
 * opencode 适配器：将 CognitiveBridge 接入 opencode 的插件系统。
 * 
 * 使用标准工具注册 API，LLM 通过标准工具调用格式调用记忆工具。
 * 
 * 防重复加载：通过 singleton 模块确保 OMP 中不与 Pi 扩展双重注册。
 */
import type { Plugin, ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { CognitiveBridge } from '../core.js';
import { loadPersona, savePersona } from '../storage.js';
import { buildMoodReport } from '../mood.js';
import { tryInit } from '../singleton.js';
import type { DiaryEntry, MemoryType } from '../memory.js';

// ── 辅助函数 ──

function buildDiaryContext(diary: DiaryEntry[]): string {
  if (diary.length === 0) return '';
  const lines = [
    '## 最近会话记录',
    ...diary.map(d => `- ${d.createdAt.slice(0, 10)}: ${d.title}`),
    ''
  ];
  return lines.join('\n');
}

function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => {
      if (typeof p === 'string') return p;
      if (p?.type === 'text') return p.text || '';
      return '';
    }).join('\n');
  }
  return '';
}

// ── 工具定义 ──

function createMemoryTools(bridge: CognitiveBridge): Record<string, ToolDefinition> {
  return {
    cog_memorize: tool({
      description: 'Save a persistent memory. Use after important decisions, bug fixes, discoveries, patterns, or learning user preferences.',
      args: {
        type: tool.schema.enum(['decision', 'bugfix', 'discovery', 'pattern', 'preference'] as const)
          .describe('Memory type'),
        topic: tool.schema.string()
          .describe('Topic category, e.g. architecture, auth, deployment'),
        title: tool.schema.string()
          .describe('Short title, verb-first, e.g. "Fixed N+1 query in UserList"'),
        content: tool.schema.string()
          .describe('Content in [What]/[Why]/[Where]/[Learned] format'),
        topicKey: tool.schema.string().optional()
          .describe('Stable key for evolving topics, e.g. architecture/auth-model'),
        context: tool.schema.string().optional()
          .describe('Optional additional context')
      },
      execute: async (args) => {
        const memory = bridge.memorize(args);
        return `Memory saved: ${memory.title} (id: ${memory.id.slice(0, 8)})`;
      }
    }),

    cog_recall: tool({
      description: 'Search memories by keyword. Use when you need to recall past decisions, experiences, or knowledge.',
      args: {
        query: tool.schema.string()
          .describe('Search query, supports phrases and keywords'),
        topic: tool.schema.string().optional()
          .describe('Filter by topic'),
        type: tool.schema.enum(['decision', 'bugfix', 'discovery', 'pattern', 'preference'] as const).optional()
          .describe('Filter by type'),
        limit: tool.schema.number().optional()
          .describe('Max results (default: 10)')
      },
      execute: async (args) => {
        const results = bridge.recall(args.query, {
          topic: args.topic,
          type: args.type,
          limit: args.limit ?? 10
        });
        if (results.length === 0) {
          return `No memories found for "${args.query}"`;
        }
        const items = results.map((r: any) =>
          `- [${r.type}] ${r.title} (${r.createdAt.slice(0, 10)})\n  ${r.content.slice(0, 200)}`
        ).join('\n\n');
        return `Found ${results.length} memory(ies):\n\n${items}`;
      }
    }),

    cog_get_by_topic_key: tool({
      description: 'Get all memories for an evolving topic by its stable key.',
      args: {
        topicKey: tool.schema.string()
          .describe('Topic key, e.g. architecture/auth-model')
      },
      execute: async (args) => {
        const memories = bridge.getByTopicKey(args.topicKey);
        if (memories.length === 0) {
          return `No memories found for topic key "${args.topicKey}"`;
        }
        const items = memories.map((m: any) =>
          `- ${m.title} (${m.createdAt.slice(0, 10)})\n  ${m.content.slice(0, 200)}`
        ).join('\n\n');
        return `Found ${memories.length} memory(ies) for "${args.topicKey}":\n\n${items}`;
      }
    }),

    cog_add_fact: tool({
      description: 'Add a fact to the knowledge graph. Use to record entity relationships.',
      args: {
        subject: tool.schema.string()
          .describe('Subject entity, e.g. "银月", "cog", "公子"'),
        predicate: tool.schema.string()
          .describe('Relationship, e.g. works_on, created_by, prefers, knows, decided'),
        object: tool.schema.string()
          .describe('Object entity')
      },
      execute: async (args) => {
        const fact = bridge.addFact(args.subject, args.predicate, args.object);
        return `Fact added: ${fact.subject} → ${fact.predicate} → ${fact.object}`;
      }
    }),

    cog_query_facts: tool({
      description: 'Query current facts about an entity from the knowledge graph.',
      args: {
        entity: tool.schema.string()
          .describe('Entity to query, e.g. "银月", "cog"')
      },
      execute: async (args) => {
        const facts = bridge.queryFacts(args.entity);
        if (facts.length === 0) {
          return `No facts found about "${args.entity}"`;
        }
        const items = facts.map((f: any) =>
          `- ${f.subject} → ${f.predicate} → ${f.object}${f.validTo ? ` (ended: ${f.validTo.slice(0, 10)})` : ' (current)'}`
        ).join('\n');
        return `Facts about "${args.entity}":\n${items}`;
      }
    }),

    cog_timeline: tool({
      description: 'Get the chronological timeline of facts about an entity.',
      args: {
        entity: tool.schema.string()
          .describe('Entity to get timeline for')
      },
      execute: async (args) => {
        const timeline = bridge.timeline(args.entity);
        if (timeline.length === 0) {
          return `No timeline found for "${args.entity}"`;
        }
        const items = timeline.map((f: any) =>
          `- ${f.validFrom.slice(0, 10)}: ${f.subject} → ${f.predicate} → ${f.object}${f.validTo ? ` → ended ${f.validTo.slice(0, 10)}` : ''}`
        ).join('\n');
        return `Timeline for "${args.entity}":\n${items}`;
      }
    }),

    cog_write_diary: tool({
      description: 'Write a session diary entry. Use at the end of a significant session.',
      args: {
        title: tool.schema.string()
          .describe('Short title for the diary entry'),
        content: tool.schema.string()
          .describe('Diary content in AAAK format: ## Goal / ## Discoveries / ## Accomplished / ## Next Steps')
      },
      execute: async (args) => {
        const entry = bridge.writeDiary(args.title, args.content);
        return `Diary written: ${entry.title}`;
      }
    }),

    cog_read_diary: tool({
      description: 'Read recent diary entries to recall past sessions.',
      args: {
        limit: tool.schema.number().optional()
          .describe('Number of recent entries (default: 5)')
      },
      execute: async (args) => {
        const entries = bridge.readDiary(args.limit ?? 5);
        if (entries.length === 0) {
          return 'No diary entries found';
        }
        const items = entries.map((e: any) =>
          `- ${e.createdAt.slice(0, 10)}: ${e.title}\n  ${e.content.slice(0, 300)}`
        ).join('\n\n');
        return `Recent diary entries:\n\n${items}`;
      }
    }),

    cog_get_conflicts: tool({
      description: 'Get pending memory conflicts that need judgment.',
      args: {},
      execute: async () => {
        const conflicts = bridge.getPendingConflicts();
        if (conflicts.length === 0) {
          return 'No pending conflicts';
        }
        const items = conflicts.map((c: any) =>
          `- [${c.id.slice(0, 8)}] ${c.relation} (confidence: ${c.confidence.toFixed(2)})\n  new: ${c.newMemoryId.slice(0, 8)} vs existing: ${c.existingMemoryId.slice(0, 8)}`
        ).join('\n');
        return `Pending conflicts:\n${items}`;
      }
    }),

    cog_judge_conflict: tool({
      description: 'Judge a memory conflict by specifying the relationship.',
      args: {
        conflictId: tool.schema.string()
          .describe('Conflict ID'),
        relation: tool.schema.enum(['supersedes', 'conflicts_with', 'compatible', 'related', 'scoped', 'not_conflict'] as const)
          .describe('Relationship'),
        reason: tool.schema.string().optional()
          .describe('Reason for the judgment')
      },
      execute: async (args) => {
        bridge.judgeConflict(args.conflictId, args.relation, args.reason);
        return `Conflict judged: ${args.relation}`;
      }
    }),

    cog_stats: tool({
      description: 'Get memory statistics.',
      args: {},
      execute: async () => {
        const stats = bridge.getMemoryStats();
        return [
          '## Memory Statistics',
          `- Total memories: ${stats.totalMemories}`,
          `- By type:`,
          `  - decisions: ${stats.memoriesByType.decision}`,
          `  - bugfixes: ${stats.memoriesByType.bugfix}`,
          `  - discoveries: ${stats.memoriesByType.discovery}`,
          `  - patterns: ${stats.memoriesByType.pattern}`,
          `  - preferences: ${stats.memoriesByType.preference}`,
          `- Diary entries: ${stats.totalDiaryEntries}`,
          `- Knowledge graph facts: ${stats.currentFacts} current, ${stats.expiredFacts} expired`,
          `- Pending conflicts: ${stats.pendingConflicts}`,
          `- Database size: ${(stats.databaseSize / 1024).toFixed(1)} KB`
        ].join('\n');
      }
    })
  };
}

// ── 插件导出 ──

export const CogPlugin: Plugin = async (ctx) => {
  // 注意：统一入口 (initOpencodePlugin) 已处理 tryInit，
  // 这里直接创建 bridge，不再重复检查
  const bridge = new CognitiveBridge();
  const existingPersona = loadPersona();
  if (existingPersona) {
    bridge.setPersona(existingPersona);
  }

  const LOG_TAG = '[cog:opencode]';
  let isCodingSession = false;
  let diaryContextInjected = false;

  return {
    tool: createMemoryTools(bridge),

    event: async ({ event }) => {
      if (event.type === 'session.created') {
        const info = (event.properties as any)?.info;
        const sessionId = info?.id;
        if (sessionId) {
          console.error(`${LOG_TAG} Session created: ${sessionId}`);
        }
      }
    },

    'chat.message': async (input, output) => {
      const text = extractText(output.parts);

      // 仪式检查
      if (bridge.needsCeremony()) {
        const result = bridge.handleCeremony(text);
        if (result.completed) {
          bridge.setPersona(result.completed);
          savePersona(result.completed);
        }
        output.parts = [{ type: 'text', text: result.response } as any];
        return;
      }

      // /mood 命令
      if (text.trim().toLowerCase() === '/mood') {
        const state = bridge.currentState;
        const trend = bridge.emotionTrend();
        const report = buildMoodReport(state, trend, bridge.currentPersona);
        output.parts = [{ type: 'text', text: report } as any];
        return;
      }

      // /memory 命令
      if (text.trim().toLowerCase() === '/memory') {
        const stats = bridge.getMemoryStats();
        const report = [
          '## Memory Statistics',
          `- Total memories: ${stats.totalMemories}`,
          `- By type:`,
          `  - decisions: ${stats.memoriesByType.decision}`,
          `  - bugfixes: ${stats.memoriesByType.bugfix}`,
          `  - discoveries: ${stats.memoriesByType.discovery}`,
          `  - patterns: ${stats.memoriesByType.pattern}`,
          `  - preferences: ${stats.memoriesByType.preference}`,
          `- Diary entries: ${stats.totalDiaryEntries}`,
          `- Knowledge graph facts: ${stats.currentFacts} current`,
          `- Pending conflicts: ${stats.pendingConflicts}`,
          `- Database size: ${(stats.databaseSize / 1024).toFixed(1)} KB`
        ].join('\n');
        output.parts = [{ type: 'text', text: report } as any];
        return;
      }

      // 编码任务检测
      if (bridge.isCodingTask(text)) {
        isCodingSession = true;
      } else if (isCodingSession && bridge.currentState.cycle > 10) {
        isCodingSession = false;
      }

      // 情绪识别
      const signal = bridge.lexiconIntent(text);
      const feedback = bridge.detectFeedback(text);
      bridge.advanceState(signal, feedback);

      // 生成叙事锚点（缓存供 system.transform 使用）
      bridge.generateNarrative();
    },

    // ─── 系统提示词注入（静态身份）──
    'experimental.chat.system.transform': async (_input, output) => {
      if (!output.system) output.system = [];

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

      output.system.unshift(identityBlock);
    },

    // ─── 消息注入（动态认知状态）──
    'experimental.chat.messages.transform': async (_input, output) => {
      if (!output.messages || !Array.isArray(output.messages)) return;

      const narrative = bridge.generateNarrative();
      if (!narrative) return;

      // 找到最新的 user 消息，在其第一个 text part 前置注入认知状态
      for (let i = output.messages.length - 1; i >= 0; i--) {
        const msg = output.messages[i];
        if (!msg || !msg.info || msg.info.role !== 'user') continue;
        const textParts = (msg.parts || []).filter(
          (p: any) => p.type === 'text' && typeof p.text === 'string'
        );
        if (textParts.length > 0) {
          (textParts[0] as any).text = `<cognitive_state>\n${narrative}\n</cognitive_state>\n\n${(textParts[0] as any).text}`;
        }
      }
    },

    'tool.execute.after': async (input, output) => {
      if (input.tool.startsWith('cog_')) {
        const conflicts = bridge.getPendingConflicts();
        if (conflicts.length > 0) {
          output.metadata = {
            ...output.metadata,
            cog_conflicts: conflicts.length
          };
        }
      }
    }
  };
};

// ── 向后兼容导出 ──

export function createOpencodeCog() {
  console.error('[cog] createOpencodeCog is deprecated. Use CogPlugin directly.');
  const bridge = new CognitiveBridge();
  const existingPersona = loadPersona();
  if (existingPersona) {
    bridge.setPersona(existingPersona);
  }
  return {
    name: 'cog',
    async onUserMessage(message: string) {
      if (bridge.needsCeremony()) {
        const result = bridge.handleCeremony(message);
        return { text: result.response };
      }
      const signal = bridge.lexiconIntent(message);
      const feedback = bridge.detectFeedback(message);
      bridge.advanceState(signal, feedback);
      const narrative = bridge.generateNarrative();
      const layer = bridge.currentState.cycle <= 1 ? 'full' : 'core';
      const identityBlock = bridge.buildIdentityBlock(layer);
      return {
        text: `${identityBlock}\n\n[认知状态]\n${narrative}\n[/认知状态]\n\n${message}`
      };
    }
  };
}

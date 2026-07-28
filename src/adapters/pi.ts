/**
 * pi 适配器：将 CognitiveBridge 接入 pi 的 ExtensionAPI。
 * 
 * 使用标准工具注册 API：pi.registerTool()
 * 使用钩子系统：input, before_agent_start, turn_end
 */
import type { Persona } from '../types.js';
import type { DiaryEntry } from '../memory.js';
import { CognitiveBridge } from '../core.js';
import { loadPersona, savePersona } from '../storage.js';
import { buildMoodReport } from '../mood.js';

// ── pi 扩展 API 类型（简化声明）──

interface PiExtensionAPI {
  on(event: string, handler: Function): void;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: any;
    execute(id: string, params: any): Promise<any>;
  }): void;
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

function buildDiaryContext(diary: DiaryEntry[]): string {
  if (diary.length === 0) return '';
  const lines = [
    '## 最近会话记录',
    ...diary.map(d => `- ${d.createdAt.slice(0, 10)}: ${d.title}`),
    ''
  ];
  return lines.join('\n');
}

// ── 适配器实现 ──

export function registerPiExtension(pi: PiExtensionAPI, bridge: CognitiveBridge): void {
  const LOG_TAG = '[cog:pi]';
  let isCodingSession = false;

  // ── 注册记忆工具 ──

  pi.registerTool({
    name: 'cog_memorize',
    label: 'Memorize',
    description: 'Save a persistent memory. Use after important decisions, bug fixes, discoveries, patterns, or learning user preferences.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['decision', 'bugfix', 'discovery', 'pattern', 'preference'],
          description: 'Memory type'
        },
        topic: {
          type: 'string',
          description: 'Topic category, e.g. architecture, auth, deployment'
        },
        title: {
          type: 'string',
          description: 'Short title, verb-first, e.g. "Fixed N+1 query in UserList"'
        },
        content: {
          type: 'string',
          description: 'Content in [What]/[Why]/[Where]/[Learned] format'
        },
        topicKey: {
          type: 'string',
          description: 'Stable key for evolving topics, e.g. architecture/auth-model'
        },
        context: {
          type: 'string',
          description: 'Optional additional context'
        }
      },
      required: ['type', 'topic', 'title', 'content']
    },
    async execute(_id, params) {
      const memory = bridge.memorize(params);
      return {
        content: [{ type: 'text', text: `Memory saved: ${memory.title} (id: ${memory.id.slice(0, 8)})` }]
      };
    }
  });

  pi.registerTool({
    name: 'cog_recall',
    label: 'Recall Memory',
    description: 'Search memories by keyword. Use when you need to recall past decisions, experiences, or knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, supports phrases and keywords' },
        topic: { type: 'string', description: 'Filter by topic' },
        type: {
          type: 'string',
          enum: ['decision', 'bugfix', 'discovery', 'pattern', 'preference'],
          description: 'Filter by type'
        },
        limit: { type: 'integer', description: 'Max results (default: 10)' }
      },
      required: ['query']
    },
    async execute(_id, params) {
      const results = bridge.recall(params.query, {
        topic: params.topic,
        type: params.type,
        limit: params.limit ?? 10
      });
      if (results.length === 0) {
        return { content: [{ type: 'text', text: `No memories found for "${params.query}"` }] };
      }
      const items = results.map((r: any) =>
        `- [${r.type}] ${r.title} (${r.createdAt.slice(0, 10)})\n  ${r.content.slice(0, 200)}`
      ).join('\n\n');
      return { content: [{ type: 'text', text: `Found ${results.length} memory(ies):\n\n${items}` }] };
    }
  });

  pi.registerTool({
    name: 'cog_get_by_topic_key',
    label: 'Get by Topic Key',
    description: 'Get all memories for an evolving topic by its stable key.',
    parameters: {
      type: 'object',
      properties: {
        topicKey: { type: 'string', description: 'Topic key, e.g. architecture/auth-model' }
      },
      required: ['topicKey']
    },
    async execute(_id, params) {
      const memories = bridge.getByTopicKey(params.topicKey);
      if (memories.length === 0) {
        return { content: [{ type: 'text', text: `No memories found for topic key "${params.topicKey}"` }] };
      }
      const items = memories.map((m: any) =>
        `- ${m.title} (${m.createdAt.slice(0, 10)})\n  ${m.content.slice(0, 200)}`
      ).join('\n\n');
      return { content: [{ type: 'text', text: `Found ${memories.length} memory(ies) for "${params.topicKey}":\n\n${items}` }] };
    }
  });

  pi.registerTool({
    name: 'cog_add_fact',
    label: 'Add Fact',
    description: 'Add a fact to the knowledge graph. Use to record entity relationships.',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Subject entity, e.g. "银月", "cog", "公子"' },
        predicate: { type: 'string', description: 'Relationship, e.g. works_on, created_by, prefers, knows, decided' },
        object: { type: 'string', description: 'Object entity' }
      },
      required: ['subject', 'predicate', 'object']
    },
    async execute(_id, params) {
      const fact = bridge.addFact(params.subject, params.predicate, params.object);
      return { content: [{ type: 'text', text: `Fact added: ${fact.subject} → ${fact.predicate} → ${fact.object}` }] };
    }
  });

  pi.registerTool({
    name: 'cog_query_facts',
    label: 'Query Facts',
    description: 'Query current facts about an entity from the knowledge graph.',
    parameters: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity to query, e.g. "银月", "cog"' }
      },
      required: ['entity']
    },
    async execute(_id, params) {
      const facts = bridge.queryFacts(params.entity);
      if (facts.length === 0) {
        return { content: [{ type: 'text', text: `No facts found about "${params.entity}"` }] };
      }
      const items = facts.map((f: any) =>
        `- ${f.subject} → ${f.predicate} → ${f.object}${f.validTo ? ` (ended: ${f.validTo.slice(0, 10)})` : ' (current)'}`
      ).join('\n');
      return { content: [{ type: 'text', text: `Facts about "${params.entity}":\n${items}` }] };
    }
  });

  pi.registerTool({
    name: 'cog_timeline',
    label: 'Timeline',
    description: 'Get the chronological timeline of facts about an entity.',
    parameters: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity to get timeline for' }
      },
      required: ['entity']
    },
    async execute(_id, params) {
      const timeline = bridge.timeline(params.entity);
      if (timeline.length === 0) {
        return { content: [{ type: 'text', text: `No timeline found for "${params.entity}"` }] };
      }
      const items = timeline.map((f: any) =>
        `- ${f.validFrom.slice(0, 10)}: ${f.subject} → ${f.predicate} → ${f.object}${f.validTo ? ` → ended ${f.validTo.slice(0, 10)}` : ''}`
      ).join('\n');
      return { content: [{ type: 'text', text: `Timeline for "${params.entity}":\n${items}` }] };
    }
  });

  pi.registerTool({
    name: 'cog_write_diary',
    label: 'Write Diary',
    description: 'Write a session diary entry. Use at the end of a significant session.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the diary entry' },
        content: { type: 'string', description: 'Diary content in AAAK format: ## Goal / ## Discoveries / ## Accomplished / ## Next Steps' }
      },
      required: ['title', 'content']
    },
    async execute(_id, params) {
      const entry = bridge.writeDiary(params.title, params.content);
      return { content: [{ type: 'text', text: `Diary written: ${entry.title}` }] };
    }
  });

  pi.registerTool({
    name: 'cog_read_diary',
    label: 'Read Diary',
    description: 'Read recent diary entries to recall past sessions.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number of recent entries (default: 5)' }
      },
      required: []
    },
    async execute(_id, params) {
      const entries = bridge.readDiary(params.limit ?? 5);
      if (entries.length === 0) {
        return { content: [{ type: 'text', text: 'No diary entries found' }] };
      }
      const items = entries.map((e: any) =>
        `- ${e.createdAt.slice(0, 10)}: ${e.title}\n  ${e.content.slice(0, 300)}`
      ).join('\n\n');
      return { content: [{ type: 'text', text: `Recent diary entries:\n\n${items}` }] };
    }
  });

  pi.registerTool({
    name: 'cog_get_conflicts',
    label: 'Get Conflicts',
    description: 'Get pending memory conflicts that need judgment.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const conflicts = bridge.getPendingConflicts();
      if (conflicts.length === 0) {
        return { content: [{ type: 'text', text: 'No pending conflicts' }] };
      }
      const items = conflicts.map((c: any) =>
        `- [${c.id.slice(0, 8)}] ${c.relation} (confidence: ${c.confidence.toFixed(2)})\n  new: ${c.newMemoryId.slice(0, 8)} vs existing: ${c.existingMemoryId.slice(0, 8)}`
      ).join('\n');
      return { content: [{ type: 'text', text: `Pending conflicts:\n${items}` }] };
    }
  });

  pi.registerTool({
    name: 'cog_judge_conflict',
    label: 'Judge Conflict',
    description: 'Judge a memory conflict by specifying the relationship.',
    parameters: {
      type: 'object',
      properties: {
        conflictId: { type: 'string', description: 'Conflict ID' },
        relation: {
          type: 'string',
          enum: ['supersedes', 'conflicts_with', 'compatible', 'related', 'scoped', 'not_conflict'],
          description: 'Relationship'
        },
        reason: { type: 'string', description: 'Reason for the judgment' }
      },
      required: ['conflictId', 'relation']
    },
    async execute(_id, params) {
      bridge.judgeConflict(params.conflictId, params.relation, params.reason);
      return { content: [{ type: 'text', text: `Conflict judged: ${params.relation}` }] };
    }
  });

  pi.registerTool({
    name: 'cog_stats',
    label: 'Memory Stats',
    description: 'Get memory statistics.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const stats = bridge.getMemoryStats();
      const text = [
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
      return { content: [{ type: 'text', text }] };
    }
  });

  // ── session_start：加载 persona + 日记 ──
  pi.on('session_start', (_event: any, _ctx: any) => {
    if (!bridge.awakened) {
      const p = loadPersona();
      if (p) {
        bridge.setPersona(p);
        console.error(`${LOG_TAG} Persona loaded: ${p.name}`);
      }
    }

    const recentDiary = bridge.readDiary(3);
    if (recentDiary.length > 0) {
      const diaryContext = buildDiaryContext(recentDiary);
      console.error(`${LOG_TAG} Loaded ${recentDiary.length} recent diary entries`);
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
      if (result.completed) {
        bridge.setPersona(result.completed);  // 更新 bridge 状态
        savePersona(result.completed);
      }
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

    // /memory 命令
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
    // 正常流程返回 undefined，让 pi 继续处理
    return undefined;
  });

  // ── before_agent_start：注入身份 + 设置 NAP 锚点 ──
  pi.on('before_agent_start', async (event: PiEvent, _ctx: PiContext) => {
    const ret: Record<string, unknown> = {};

    if (bridge.awakened) {
      const layer = bridge.currentState.cycle === 0 ? 'full' : 'core';
      let identityBlock = bridge.buildIdentityBlock(layer);

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

    // NAP 锚点（条件注入，KV 缓存友好）
    // 只在状态有意义变化时注入，避免重复 token
    if (bridge.currentState.cycle > 0 && bridge.shouldInjectNarrative()) {
      const narrative = bridge.generateNarrative();
      bridge.markNarrativeInjected();
      (pi as any)._cogPendingAnchor = narrative;
    }

    return Object.keys(ret).length > 0 ? ret : undefined;
  });

  // ── context：注入 NAP 锚点到最新用户消息 ──
  // 注意：content 可能是 string 或 array（[{type:'text',...}]），必须正确处理 array，
  // 否则原始用户消息丢失 + 类型不一致导致 TUI 渲染异常（双层）。
  function prependStateToUserContent(content: any, anchor: string): any {
    const block = `<cognitive_state>\n${anchor}\n</cognitive_state>\n\n`;
    if (typeof content === 'string') return block + content;
    if (Array.isArray(content)) {
      if (content.length > 0 && content[0]?.type === 'text') {
        return [{ type: 'text', text: block + content[0].text }, ...content.slice(1)];
      }
      return [{ type: 'text', text: block }, ...content];
    }
    return block + String(content ?? '');
  }

  pi.on('context', async (event: PiEvent, _ctx: PiContext) => {
    const anchor = (pi as any)._cogPendingAnchor;
    if (!anchor) return undefined;
    (pi as any)._cogPendingAnchor = null;

    const messages = event.messages;
    if (!Array.isArray(messages)) return undefined;

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'user') {
        const newMessages = [...messages];
        newMessages[i] = {
          ...m,
          content: prependStateToUserContent(m.content, anchor)
        };
        return { messages: newMessages };
      }
    }
    return undefined;
  });
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

  console.error(`${LOG_TAG} Extension loaded. Awakened: ${bridge.awakened}. Tools registered: 12`);
}

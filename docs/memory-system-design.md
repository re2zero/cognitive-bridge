# cog 记忆系统设计文档

> 版本：1.0
> 日期：2026-07-27
> 状态：待实施

## 1. 设计目标

### 1.1 核心目标

为 cog 注入**跨会话持久记忆能力**，使银月能够在不同会话之间保持连续性：
- 记住过去的决策、发现、约定
- 记住用户偏好和约束
- 记住修复过的 bug 和踩过的坑
- 通过知识图谱理解实体关系及其时间演变

### 1.2 设计原则

| 原则 | 说明 |
|---|---|
| **收益最大化** | 不因为时间、复杂度、工程便利而简化设计；每个决策以长期收益为唯一标准 |
| **零运行时依赖** | 不启动 daemon，不连接 Unix socket，不调 RPC；所有逻辑在插件进程内完成 |
| **统一存储** | 单一 SQLite 数据库，统一入口，避免多文件管理的碎片化 |
| **原文存储** | 记忆内容存储原文，不做摘要/改写；元数据与内容分离 |
| **结构化组织** | 层级化分类 + 知识图谱，支持多维度检索 |
| **时间感知** | 记忆和事实都有时间戳；事实支持时间窗口（valid_from/valid_to） |
| **去重与冲突** | 写入前检测重复；冲突时标记待判断，不静默覆盖 |

### 1.3 借鉴来源

| 项目 | 借鉴内容 |
|---|---|
| **Engram** | SQLite + FTS5 存储；What/Why/Where/Learned 结构；Topic key；Conflict surfacing；Session lifecycle |
| **MemPalace** | Wings→Rooms→Drawers 层级组织；Verbatim storage；知识图谱时间窗口；Checkpoint 批量写入；Agent diary |
| **Magic Context** | Tiered compartments（历史分层）；Decay rendering（旧内容降级） |

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  CognitiveBridge（核心层）                                    │
│  ├─ 身份管理（已有）                                          │
│  ├─ 情绪识别（已有）                                          │
│  ├─ 状态机（已有）                                            │
│  ├─ NAP 锚点生成（已有）                                      │
│  └─ 记忆集成（新增）                                          │
│      ├─ memorize() → MemoryStore                             │
│      ├─ recall() → MemoryStore                               │
│      ├─ addFact() → MemoryStore                              │
│      └─ writeDiary() → MemoryStore                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  MemoryStore（记忆层）                                       │
│  ├─ 记忆 CRUD + FTS5 搜索                                    │
│  ├─ 知识图谱三元组管理                                       │
│  ├─ 会话日记管理                                             │
│  ├─ 去重检测                                                 │
│  ├─ 冲突检测                                                 │
│  └─ 批量操作（checkpoint）                                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  SQLite 数据库（~/.config/cog/cog.db）                        │
│  ├─ memories（记忆表）                                       │
│  ├─ memories_fts（FTS5 全文搜索）                            │
│  ├─ triples（知识图谱三元组）                                │
│  ├─ diary（会话日记）                                        │
│  ├─ conflicts（待判断冲突）                                  │
│  └─ sessions（会话记录）                                     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 文件 | 职责 |
|---|---|---|
| **MemoryStore** | `src/memory.ts` | 记忆层核心类，统一入口，封装所有数据库操作 |
| **Memory Types** | `src/types.ts` | 记忆相关类型定义（扩展现有文件） |
| **CognitiveBridge 集成** | `src/core.ts` | 在核心类中集成记忆 API（扩展现有文件） |
| **Adapters 集成** | `src/adapters/*.ts` | 在钩子中调用记忆 API（扩展现有文件） |

---

## 3. 数据库设计

### 3.1 存储路径

```
~/.config/cog/cog.db
```

### 3.2 表结构

#### 3.2.1 memories — 记忆表

存储所有跨会话记忆，每条记忆是原文片段 + 元数据。

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,              -- UUID v4
  type TEXT NOT NULL CHECK(type IN (
    'decision',      -- 架构/设计决策
    'bugfix',        -- 修复的 bug
    'discovery',     -- 非显而易见的发现
    'pattern',       -- 建立的约定/模式
    'preference',    -- 用户偏好/约束
    'diary'          -- 会话日记（也可用 diary 表）
  )),
  topic TEXT NOT NULL,              -- 主题分类（如 architecture, auth, deployment）
  title TEXT NOT NULL,              -- 简短标题（动词开头，可搜索）
  content TEXT NOT NULL,            -- 原文内容（What/Why/Where/Learned 结构）
  context TEXT,                     -- 可选：额外上下文
  emotion_weight REAL DEFAULT 0.5,  -- 情绪权重（0-1，高情绪=重要）
  confidence REAL DEFAULT 0.8,      -- 置信度（0-1）
  topic_key TEXT,                   -- 稳定键（如 architecture/auth-model），用于演进主题
  hash TEXT NOT NULL UNIQUE,        -- SHA-256(content)，用于去重
  created_at TEXT NOT NULL,         -- ISO 8601
  updated_at TEXT NOT NULL,         -- ISO 8601
  session_id TEXT,                  -- 创建时的会话 ID（可选）
  source TEXT                       -- 来源（manual/auto/diary）
);
```

**字段说明**：

- `type`：记忆类型，决定如何被检索和展示
- `topic`：主题分类，自由字符串，但建议用小写连字符（如 `architecture`, `auth-migration`）
- `title`：简短标题，动词开头，如 "Fixed N+1 query in UserList"
- `content`：原文内容，推荐结构：
  ```
  [What] 一句话描述做了什么
  [Why] 动机（用户请求、bug、性能等）
  [Where] 涉及的文件或路径
  [Learned] 注意事项、边界情况、意外发现（可选）
  ```
- `emotion_weight`：创建时的认知情绪权重，高情绪强度的记忆优先召回
- `topic_key`：稳定键，用于演进主题。例如 `architecture/auth-model` 的所有记忆都指向同一个主题，更新时可以选择覆盖或追加
- `hash`：SHA-256(content)，写入前检查是否已存在相同内容
- `source`：`manual`（agent 主动调用）、`auto`（自动捕获）、`diary`（日记生成）

#### 3.2.2 memories_fts — FTS5 全文搜索虚拟表

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title,
  content,
  context,
  topic,
  content='memories',
  content_rowid='rowid'
);
```

**触发器**（自动同步）：

```sql
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content, context, topic)
  VALUES (new.rowid, new.title, new.content, new.context, new.topic);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, context, topic)
  VALUES('delete', old.rowid, old.title, old.content, old.context, old.topic);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, context, topic)
  VALUES('delete', old.rowid, old.title, old.content, old.context, old.topic);
  INSERT INTO memories_fts(rowid, title, content, context, topic)
  VALUES (new.rowid, new.title, new.content, new.context, new.topic);
END;
```

#### 3.2.3 triples — 知识图谱三元组

存储实体关系，带时间窗口。

```sql
CREATE TABLE triples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,            -- 主体实体（如 "银月", "cog", "公子"）
  predicate TEXT NOT NULL,          -- 关系（如 "works_on", "prefers", "knows", "created_by"）
  object TEXT NOT NULL,             -- 客体实体
  valid_from TEXT NOT NULL,         -- ISO 8601，何时生效
  valid_to TEXT,                    -- ISO 8601，何时失效（NULL = 仍然有效）
  confidence REAL DEFAULT 0.8,      -- 置信度（0-1）
  source_memory_id TEXT REFERENCES memories(id),  -- 关联的记忆 ID
  created_at TEXT NOT NULL          -- ISO 8601
);

CREATE INDEX idx_triples_subject ON triples(subject);
CREATE INDEX idx_triples_object ON triples(object);
CREATE INDEX idx_triples_predicate ON triples(predicate);
CREATE INDEX idx_triples_valid ON triples(valid_from, valid_to);
CREATE INDEX idx_triples_current ON triples(subject, predicate, valid_to) WHERE valid_to IS NULL;
```

**关系谓词示例**：

| 谓词 | 说明 | 示例 |
|---|---|---|
| `works_on` | 正在工作于 | 银月 → works_on → cog |
| `created_by` | 由...创建 | 银月 → created_by → 公子 |
| `prefers` | 偏好 | 公子 → prefers → TypeScript |
| `knows` | 知道/掌握 | 银月 → knows → SQLite |
| `decided` | 决定 | cog → decided → use-SQLite |
| `depends_on` | 依赖于 | cog → depends_on → better-sqlite3 |
| `fixed` | 修复了 | 银月 → fixed → auth-bug-123 |
| `discovered` | 发现了 | 银月 → discovered → FTS5-performance |

#### 3.2.4 diary — 会话日记

存储每次会话的日记条目。

```sql
CREATE TABLE diary (
  id TEXT PRIMARY KEY,              -- UUID v4
  session_id TEXT NOT NULL,         -- 会话 ID
  title TEXT NOT NULL,              -- 简短标题
  content TEXT NOT NULL,            -- 日记内容（AAAK 格式推荐）
  emotion_avg REAL,                 -- 会话平均情绪
  emotion_peak REAL,                -- 会话峰值情绪
  memories_count INTEGER DEFAULT 0, -- 本次会话创建的記憶数量
  created_at TEXT NOT NULL,         -- ISO 8601
  updated_at TEXT NOT NULL          -- ISO 8601
);

CREATE INDEX idx_diary_session ON diary(session_id);
CREATE INDEX idx_diary_created ON diary(created_at);
```

**AAAK 格式**（Adaptive Agentic Authoring & Knowledge）：

```
## Goal
[本次会话的目标]

## Instructions
[用户偏好或约束 — 可选]

## Discoveries
- [技术发现、注意事项、意外]

## Accomplished
- [完成的事项]

## Next Steps
- [待办事项]

## Relevant Files
- path/to/file — [说明]
```

#### 3.2.5 conflicts — 待判断冲突

当新记忆与旧记忆可能冲突时，记录待判断。

```sql
CREATE TABLE conflicts (
  id TEXT PRIMARY KEY,              -- UUID v4
  new_memory_id TEXT NOT NULL REFERENCES memories(id),
  existing_memory_id TEXT NOT NULL REFERENCES memories(id),
  relation TEXT NOT NULL CHECK(relation IN (
    'supersedes',      -- 新记忆取代旧记忆
    'conflicts_with',  -- 新记忆与旧记忆冲突
    'compatible',      -- 两者兼容
    'related',         -- 相关但不冲突
    'scoped',          -- 不同作用域
    'not_conflict'     -- 不构成冲突
  )),
  confidence REAL NOT NULL,         -- 冲突检测置信度（0-1）
  reason TEXT,                      -- 冲突原因描述
  evidence TEXT,                    -- 用户提供的证据（可选）
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_conflicts_pending ON conflicts(status, created_at) WHERE status = 'pending';
CREATE INDEX idx_conflicts_new ON conflicts(new_memory_id);
CREATE INDEX idx_conflicts_existing ON conflicts(existing_memory_id);
```

#### 3.2.6 sessions — 会话记录

记录每次会话的基本信息。

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- 会话 ID
  started_at TEXT NOT NULL,         -- ISO 8601
  ended_at TEXT,                    -- ISO 8601（NULL = 进行中）
  messages_count INTEGER DEFAULT 0, -- 消息数量
  memories_created INTEGER DEFAULT 0, -- 创建的記憶数量
  facts_added INTEGER DEFAULT 0,    -- 添加的事实数量
  diary_written INTEGER DEFAULT 0   -- 是否写了日记
);

CREATE INDEX idx_sessions_started ON sessions(started_at);
CREATE INDEX idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;
```

### 3.3 索引策略

| 索引 | 用途 |
|---|---|
| `idx_memories_topic` | 按主题过滤 |
| `idx_memories_type` | 按类型过滤 |
| `idx_memories_created` | 按时间排序 |
| `idx_memories_hash` | 去重检查（UNIQUE 约束） |
| `idx_memories_topic_key` | 按稳定键查询演进主题 |
| `idx_triples_*` | 知识图谱查询 |
| `idx_diary_*` | 日记查询 |
| `idx_conflicts_pending` | 待判断冲突查询 |

---

## 4. API 设计

### 4.1 MemoryStore 类

```typescript
// src/memory.ts

import { Database } from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

// ── 类型 ──

export type MemoryType = 'decision' | 'bugfix' | 'discovery' | 'pattern' | 'preference' | 'diary';

export interface MemoryInput {
  type: MemoryType;
  topic: string;
  title: string;
  content: string;
  context?: string;
  emotionWeight?: number;
  confidence?: number;
  topicKey?: string;
  source?: 'manual' | 'auto' | 'diary';
}

export interface Memory {
  id: string;
  type: MemoryType;
  topic: string;
  title: string;
  content: string;
  context?: string;
  emotionWeight: number;
  confidence: number;
  topicKey?: string;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  source: string;
}

export interface RecallOptions {
  topic?: string;
  type?: MemoryType;
  limit?: number;
  minConfidence?: number;
  includeContext?: boolean;
  sortBy?: 'relevance' | 'time' | 'emotion';
}

export interface Triple {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  validFrom: string;
  validTo?: string;
  confidence: number;
  sourceMemoryId?: string;
  createdAt: string;
}

export interface DiaryEntry {
  id: string;
  sessionId: string;
  title: string;
  content: string;
  emotionAvg?: number;
  emotionPeak?: number;
  memoriesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Conflict {
  id: string;
  newMemoryId: string;
  existingMemoryId: string;
  relation: string;
  confidence: number;
  reason?: string;
  evidence?: string;
  status: 'pending' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

export interface MemoryStats {
  totalMemories: number;
  memoriesByType: Record<MemoryType, number>;
  totalTriples: number;
  currentFacts: number;
  expiredFacts: number;
  totalDiaryEntries: number;
  pendingConflicts: number;
  databaseSize: number; // bytes
}

// ── 核心类 ──

export class MemoryStore {
  private db: Database;
  private configDir: string;
  private dbPath: string;

  constructor(configDir?: string) {
    this.configDir = configDir || join(homedir(), '.config', 'cog');
    this.dbPath = join(this.configDir, 'cog.db');
    this.ensureConfigDir();
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.initializeSchema();
  }

  // ── 初始化 ──

  private ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
  }

  private initializeSchema(): void {
    // 创建所有表和索引（见 3.2 节）
  }

  private hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  // ── 记忆 CRUD ──

  /**
   * 保存记忆。
   * - 检查重复（基于 content hash）
   * - 检查冲突（基于 topic_key 和语义）
   * - 写入记忆
   * - 更新 FTS5
   */
  memorize(input: MemoryInput, sessionId?: string): Memory {
    const hash = this.hash(input.content);

    // 1. 去重检查
    const existing = this.db.prepare(
      'SELECT id, topic_key FROM memories WHERE hash = ?'
    ).get(hash) as { id: string; topic_key: string | null } | undefined;

    if (existing) {
      // 内容完全相同，返回已有记录
      return this.getMemory(existing.id)!;
    }

    // 2. 冲突检测（如果有 topic_key）
    if (input.topicKey) {
      this.detectConflicts(input, existing?.topic_key);
    }

    // 3. 写入
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO memories (
        id, type, topic, title, content, context,
        emotion_weight, confidence, topic_key, hash,
        created_at, updated_at, session_id, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.topic,
      input.title,
      input.content,
      input.context || null,
      input.emotionWeight ?? 0.5,
      input.confidence ?? 0.8,
      input.topicKey || null,
      hash,
      now,
      now,
      sessionId || null,
      input.source || 'manual'
    );

    return this.getMemory(id)!;
  }

  /**
   * 搜索记忆。
   * - FTS5 全文搜索
   * - 支持 topic/type 过滤
   * - 支持按相关性/时间/情绪排序
   */
  recall(query: string, options: RecallOptions = {}): Memory[] {
    const {
      topic,
      type,
      limit = 10,
      minConfidence = 0.0,
      sortBy = 'relevance'
    } = options;

    let whereClauses: string[] = [];
    let params: any[] = [];

    if (topic) {
      whereClauses.push('m.topic = ?');
      params.push(topic);
    }

    if (type) {
      whereClauses.push('m.type = ?');
      params.push(type);
    }

    if (minConfidence > 0) {
      whereClauses.push('m.confidence >= ?');
      params.push(minConfidence);
    }

    const whereClause = whereClauses.length > 0
      ? `WHERE ${whereClauses.join(' AND ')}`
      : '';

    // FTS5 搜索 + 排序
    const orderBy = sortBy === 'time'
      ? 'm.created_at DESC'
      : sortBy === 'emotion'
      ? 'm.emotion_weight DESC, m.confidence DESC'
      : 'rank ASC';

    const sql = `
      SELECT m.* FROM memories m
      INNER JOIN memories_fts ON memories_fts.rowid = m.rowid
      WHERE memories_fts MATCH ?
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ?
    `;

    params.unshift(query);
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(this.mapMemoryRow);
  }

  /**
   * 按 topic_key 获取演进主题的所有记忆。
   */
  getByTopicKey(topicKey: string): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories WHERE topic_key = ? ORDER BY created_at DESC'
    ).all(topicKey);
    return rows.map(this.mapMemoryRow);
  }

  /**
   * 获取单条记忆。
   */
  getMemory(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return row ? this.mapMemoryRow(row) : null;
  }

  /**
   * 更新记忆。
   */
  updateMemory(id: string, updates: Partial<Pick<MemoryInput, 'title' | 'content' | 'context' | 'confidence' | 'topicKey'>>): void {
    const existing = this.getMemory(id);
    if (!existing) throw new Error(`Memory not found: ${id}`);

    const now = new Date().toISOString();
    const newHash = updates.content ? this.hash(updates.content) : existing.hash;

    this.db.prepare(`
      UPDATE memories SET
        title = COALESCE(? , title),
        content = COALESCE(? , content),
        context = COALESCE(? , context),
        confidence = COALESCE(? , confidence),
        topic_key = COALESCE(? , topic_key),
        hash = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updates.title,
      updates.content,
      updates.context,
      updates.confidence,
      updates.topicKey,
      newHash,
      now,
      id
    );
  }

  /**
   * 删除记忆。
   */
  deleteMemory(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  // ── 知识图谱 ──

  /**
   * 添加事实。
   */
  addFact(
    subject: string,
    predicate: string,
    object: string,
    options: { validFrom?: string; confidence?: number; sourceMemoryId?: string } = {}
  ): Triple {
    const validFrom = options.validFrom || new Date().toISOString();
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      INSERT INTO triples (subject, predicate, object, valid_from, confidence, source_memory_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      subject,
      predicate,
      object,
      validFrom,
      options.confidence ?? 0.8,
      options.sourceMemoryId || null,
      now
    );

    return this.getTriple(Number(result.lastInsertRowid))!;
  }

  /**
   * 查询实体的所有事实。
   */
  queryFacts(entity: string, asOf?: string): Triple[] {
    const now = asOf || new Date().toISOString();

    const rows = this.db.prepare(`
      SELECT * FROM triples
      WHERE (subject = ? OR object = ?)
        AND valid_from <= ?
        AND (valid_to IS NULL OR valid_to >= ?)
      ORDER BY valid_from DESC
    `).all(entity, entity, now, now);

    return rows.map(this.mapTripleRow);
  }

  /**
   * 使事实失效。
   */
  invalidateFact(subject: string, predicate: string, object: string, ended?: string): boolean {
    const validTo = ended || new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE triples SET valid_to = ?
      WHERE subject = ? AND predicate = ? AND object = ? AND valid_to IS NULL
    `).run(validTo, subject, predicate, object);

    return result.changes > 0;
  }

  /**
   * 原子替换事实（supersede）。
   */
  supersedeFact(
    subject: string,
    predicate: string,
    oldObject: string,
    newObject: string,
    at?: string
  ): { superseded: boolean; newFact: Triple } {
    const boundary = at || new Date().toISOString();

    const tx = this.db.transaction(() => {
      // 使旧事实失效
      this.db.prepare(`
        UPDATE triples SET valid_to = ?
        WHERE subject = ? AND predicate = ? AND object = ? AND valid_to IS NULL
      `).run(boundary, subject, predicate, oldObject);

      // 添加新事实
      const result = this.db.prepare(`
        INSERT INTO triples (subject, predicate, object, valid_from, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(subject, predicate, newObject, boundary, boundary);

      return Number(result.lastInsertRowid);
    });

    const newId = tx();
    return { superseded: true, newFact: this.getTriple(newId)! };
  }

  /**
   * 获取单条事实。
   */
  getTriple(id: number): Triple | null {
    const row = this.db.prepare('SELECT * FROM triples WHERE id = ?').get(id);
    return row ? this.mapTripleRow(row) : null;
  }

  /**
   * 获取实体的时间线。
   */
  timeline(entity: string): Triple[] {
    const rows = this.db.prepare(`
      SELECT * FROM triples
      WHERE subject = ? OR object = ?
      ORDER BY valid_from ASC
    `).all(entity, entity);

    return rows.map(this.mapTripleRow);
  }

  // ── 日记 ──

  /**
   * 写日记条目。
   */
  writeDiary(
    sessionId: string,
    title: string,
    content: string,
    options: { emotionAvg?: number; emotionPeak?: number; memoriesCount?: number } = {}
  ): DiaryEntry {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO diary (id, session_id, title, content, emotion_avg, emotion_peak, memories_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      title,
      content,
      options.emotionAvg || null,
      options.emotionPeak || null,
      options.memoriesCount ?? 0,
      now,
      now
    );

    return this.getDiaryEntry(id)!;
  }

  /**
   * 读取最近日记。
   */
  readDiary(limit: number = 10): DiaryEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM diary ORDER BY created_at DESC LIMIT ?'
    ).all(limit);

    return rows.map(this.mapDiaryRow);
  }

  /**
   * 获取单条日记。
   */
  getDiaryEntry(id: string): DiaryEntry | null {
    const row = this.db.prepare('SELECT * FROM diary WHERE id = ?').get(id);
    return row ? this.mapDiaryRow(row) : null;
  }

  // ── 冲突检测 ──

  /**
   * 检测新记忆与现有记忆的冲突。
   * - 基于 topic_key 匹配
   * - 基于内容相似度（简单关键词重叠）
   * - 记录到 conflicts 表，状态为 pending
   */
  private detectConflicts(input: MemoryInput, existingTopicKey?: string | null): void {
    if (!existingTopicKey) return;

    // 查找同 topic_key 的现有记忆
    const existing = this.db.prepare(
      'SELECT id, title, content FROM memories WHERE topic_key = ? AND id != ? ORDER BY created_at DESC LIMIT 5'
    ).all(existingTopicKey, '');

    for (const mem of existing) {
      // 简单冲突检测：关键词重叠 + 类型判断
      const overlap = this.keywordOverlap(input.title + input.content, mem.title + mem.content);

      if (overlap > 0.3) {
        // 可能冲突，记录待判断
        const relation = this.suggestRelation(input.type, mem.type, overlap);
        const confidence = Math.min(0.9, overlap * 1.5);

        if (confidence >= 0.5) {
          this.recordConflict(input, mem.id, relation, confidence);
        }
      }
    }
  }

  /**
   * 关键词重叠度。
   */
  private keywordOverlap(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    let overlap = 0;
    for (const w of words1) {
      if (words2.has(w)) overlap++;
    }

    return overlap / Math.max(words1.size, words2.size);
  }

  /**
   * 建议冲突关系。
   */
  private suggestRelation(newType: MemoryType, existingType: MemoryType, overlap: number): string {
    // decision 类型的更新通常是 supersedes
    if (newType === 'decision' && existingType === 'decision') return 'supersedes';

    // bugfix 与 discovery 通常是 compatible
    if ((newType === 'bugfix' || newType === 'discovery') &&
        (existingType === 'bugfix' || existingType === 'discovery')) {
      return 'compatible';
    }

    // 高重叠 + 不同类型可能是 conflicts_with
    if (overlap > 0.6) return 'conflicts_with';

    return 'related';
  }

  /**
   * 记录冲突。
   */
  private recordConflict(
    input: MemoryInput,
    existingMemoryId: string,
    relation: string,
    confidence: number
  ): void {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO conflicts (id, new_memory_id, existing_memory_id, relation, confidence, status, created_at)
      VALUES (?, 'pending_new', ?, ?, ?, 'pending', ?)
    `).run(id, existingMemoryId, relation, confidence, now);
  }

  /**
   * 获取待判断冲突。
   */
  getPendingConflicts(): Conflict[] {
    const rows = this.db.prepare(
      'SELECT * FROM conflicts WHERE status = ? ORDER BY created_at DESC'
    ).all('pending');

    return rows.map(this.mapConflictRow);
  }

  /**
   * 判断冲突（resolve）。
   */
  judgeConflict(
    conflictId: string,
    relation: string,
    reason?: string,
    evidence?: string
  ): void {
    this.db.prepare(`
      UPDATE conflicts SET relation = ?, reason = ?, evidence = ?, status = 'resolved', resolved_at = ?
      WHERE id = ?
    `).run(relation, reason || null, evidence || null, new Date().toISOString(), conflictId);
  }

  // ── 批量操作（Checkpoint） ──

  /**
   * 批量保存记忆。
   * - 事务保证原子性
   * - 逐条去重
   * - 返回添加/重复/错误统计
   */
  checkpoint(
    items: MemoryInput[],
    sessionId?: string
  ): { added: Memory[]; duplicates: string[]; errors: Array<{ index: number; error: string }> } {
    const tx = this.db.transaction(() => {
      const added: Memory[] = [];
      const duplicates: string[] = [];
      const errors: Array<{ index: number; error: string }> = [];

      for (let i = 0; i < items.length; i++) {
        try {
          const memory = this.memorize(items[i], sessionId);
          added.push(memory);
        } catch (e: any) {
          if (e.message?.includes('UNIQUE constraint failed')) {
            duplicates.push(items[i].title);
          } else {
            errors.push({ index: i, error: e.message });
          }
        }
      }

      return { added, duplicates, errors };
    });

    return tx();
  }

  // ── 会话管理 ──

  /**
   * 开始会话。
   */
  startSession(sessionId: string): void {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, started_at, messages_count, memories_created, facts_added, diary_written)
      VALUES (?, ?, 0, 0, 0, 0)
    `).run(sessionId, now);
  }

  /**
   * 结束会话。
   */
  endSession(sessionId: string): void {
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE sessions SET ended_at = ? WHERE id = ?
    `).run(now, sessionId);
  }

  /**
   * 获取活跃会话。
   */
  getActiveSession(): { id: string; startedAt: string } | null {
    const row = this.db.prepare(
      'SELECT id, started_at FROM sessions WHERE ended_at IS NULL LIMIT 1'
    ).get();

    return row ? { id: row.id, startedAt: row.started_at } : null;
  }

  // ── 统计 ──

  stats(): MemoryStats {
    const dbSize = this.db.pragma('page_count') * this.db.pragma('page_size');

    const memoriesByType: Record<MemoryType, number> = {
      decision: 0, bugfix: 0, discovery: 0, pattern: 0, preference: 0, diary: 0
    };

    const typeRows = this.db.prepare(
      'SELECT type, COUNT(*) as count FROM memories GROUP BY type'
    ).all() as Array<{ type: string; count: number }>;

    for (const row of typeRows) {
      if (row.type in memoriesByType) {
        memoriesByType[row.type as MemoryType] = row.count;
      }
    }

    return {
      totalMemories: this.db.prepare('SELECT COUNT(*) as count FROM memories').get().count,
      memoriesByType,
      totalTriples: this.db.prepare('SELECT COUNT(*) as count FROM triples').get().count,
      currentFacts: this.db.prepare('SELECT COUNT(*) as count FROM triples WHERE valid_to IS NULL').get().count,
      expiredFacts: this.db.prepare('SELECT COUNT(*) as count FROM triples WHERE valid_to IS NOT NULL').get().count,
      totalDiaryEntries: this.db.prepare('SELECT COUNT(*) as count FROM diary').get().count,
      pendingConflicts: this.db.prepare('SELECT COUNT(*) as count FROM conflicts WHERE status = ?').get('pending').count,
      databaseSize: dbSize
    };
  }

  // ── 映射辅助 ──

  private mapMemoryRow(row: any): Memory {
    return {
      id: row.id,
      type: row.type,
      topic: row.topic,
      title: row.title,
      content: row.content,
      context: row.context,
      emotionWeight: row.emotion_weight,
      confidence: row.confidence,
      topicKey: row.topic_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sessionId: row.session_id,
      source: row.source
    };
  }

  private mapTripleRow(row: any): Triple {
    return {
      id: row.id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      confidence: row.confidence,
      sourceMemoryId: row.source_memory_id,
      createdAt: row.created_at
    };
  }

  private mapDiaryRow(row: any): DiaryEntry {
    return {
      id: row.id,
      sessionId: row.session_id,
      title: row.title,
      content: row.content,
      emotionAvg: row.emotion_avg,
      emotionPeak: row.emotion_peak,
      memoriesCount: row.memories_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapConflictRow(row: any): Conflict {
    return {
      id: row.id,
      newMemoryId: row.new_memory_id,
      existingMemoryId: row.existing_memory_id,
      relation: row.relation,
      confidence: row.confidence,
      reason: row.reason,
      evidence: row.evidence,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at
    };
  }

  // ── 关闭 ──

  close(): void {
    this.db.close();
  }
}
```

### 4.2 CognitiveBridge 集成

在 `CognitiveBridge` 类中集成记忆 API：

```typescript
// src/core.ts（扩展）

import { MemoryStore } from './memory.js';

export class CognitiveBridge {
  // ... 现有字段 ...

  private memoryStore: MemoryStore;
  private sessionId: string;

  constructor(config?: Partial<CogConfig>) {
    // ... 现有初始化 ...

    this.memoryStore = new MemoryStore();
    this.sessionId = this.generateSessionId();
    this.memoryStore.startSession(this.sessionId);
  }

  // ── 记忆 API（对外暴露给 agent） ──

  /**
   * 保存记忆。
   * 集成情绪权重：当前认知状态的情绪强度影响记忆权重。
   */
  memorize(input: Omit<MemoryInput, 'emotionWeight'>): Memory {
    const emotionWeight = this.calculateMemoryWeight();
    return this.memoryStore.memorize({
      ...input,
      emotionWeight
    }, this.sessionId);
  }

  /**
   * 搜索记忆。
   */
  recall(query: string, options?: RecallOptions): Memory[] {
    return this.memoryStore.recall(query, options);
  }

  /**
   * 添加知识图谱事实。
   */
  addFact(subject: string, predicate: string, object: string): Triple {
    return this.memoryStore.addFact(subject, predicate, object);
  }

  /**
   * 查询知识图谱事实。
   */
  queryFacts(entity: string): Triple[] {
    return this.memoryStore.queryFacts(entity);
  }

  /**
   * 写会话日记。
   */
  writeDiary(title: string, content: string): DiaryEntry {
    const stats = this.memoryStore.stats();
    return this.memoryStore.writeDiary(this.sessionId, title, content, {
      emotionAvg: this.cognitiveState.emotion,
      emotionPeak: this.calculatePeakEmotion(),
      memoriesCount: stats.totalMemories
    });
  }

  /**
   * 获取待判断冲突。
   */
  getPendingConflicts(): Conflict[] {
    return this.memoryStore.getPendingConflicts();
  }

  /**
   * 判断冲突。
   */
  judgeConflict(conflictId: string, relation: string, reason?: string, evidence?: string): void {
    this.memoryStore.judgeConflict(conflictId, relation, reason, evidence);
  }

  /**
   * 获取记忆统计。
   */
  getMemoryStats(): MemoryStats {
    return this.memoryStore.stats();
  }

  // ── 辅助方法 ──

  /**
   * 计算记忆权重（基于当前认知状态）。
   * 高情绪强度 + 高激活度 = 高权重记忆。
   */
  private calculateMemoryWeight(): number {
    const state = this.cognitiveState;
    const emotionIntensity = Math.abs(state.emotion);
    const arousal = state.arousal;

    // 情绪强度权重 60%，激活度权重 40%
    return Math.min(1.0, emotionIntensity * 0.6 + arousal * 0.4);
  }

  /**
   * 计算会话峰值情绪。
   */
  private calculatePeakEmotion(): number {
    if (this.window.length === 0) return 0;
    return Math.max(...this.window.map(e => Math.abs(e.emotion)));
  }

  /**
   * 生成会话 ID。
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── 会话结束钩子 ──

  /**
   * 会话结束时调用。
   */
  onSessionEnd(): void {
    this.memoryStore.endSession(this.sessionId);
    this.memoryStore.close();
  }
}
```

### 4.3 Adapters 集成

在 `session_start` 和 `turn_end` 钩子中集成记忆：

```typescript
// src/adapters/pi.ts（扩展）

export class PiAdapter implements PlatformAdapter {
  // ... 现有代码 ...

  async onSessionStart(): Promise<void> {
    // 加载 persona（已有）
    const persona = loadPersona();
    if (persona) {
      this.bridge.setPersona(persona);
    }

    // 启动会话
    const sessionId = this.bridge.getSessionId();
    this.bridge.startSession(sessionId);

    // 加载最近日记（可选，注入到上下文）
    const recentDiary = this.bridge.readDiary(3);
    if (recentDiary.length > 0) {
      this.injectDiaryContext(recentDiary);
    }
  }

  async onTurnEnd(): Promise<void> {
    // 现有逻辑...

    // 检查待判断冲突
    const conflicts = this.bridge.getPendingConflicts();
    if (conflicts.length > 0) {
      this.notifyConflicts(conflicts);
    }
  }

  private injectDiaryContext(diary: DiaryEntry[]): void {
    // 将最近日记摘要注入到系统提示词
    const summary = diary.map(d => `- ${d.title} (${d.createdAt.slice(0, 10)})`).join('\n');
    // 追加到系统提示词
  }

  private notifyConflicts(conflicts: Conflict[]): void {
    // 通知用户有待判断的记忆冲突
    for (const c of conflicts.slice(0, 3)) {
      this.notify(
        `记忆冲突待判断：${c.relation}（置信度 ${c.confidence.toFixed(2)}）`,
        'info'
      );
    }
  }
}
```

---

## 5. 搜索策略

### 5.1 FTS5 全文搜索

FTS5 提供以下搜索能力：

| 搜索类型 | 示例 | 说明 |
|---|---|---|
| 单词 | `auth` | 匹配包含 auth 的记忆 |
| 短语 | `"OAuth token"` | 精确短语匹配 |
| 多词 | `auth migration` | 匹配包含任一词的记忆 |
| 前缀 | `auth*` | 匹配 auth 开头的词 |
| 布尔 | `auth AND migration` | 逻辑组合 |
| 近邻 | `auth NEAR/5 migration` | 5 词距离内 |

### 5.2 排序策略

| 排序方式 | 适用场景 |
|---|---|
| `relevance`（默认） | FTS5 rank，按相关性排序 |
| `time` | 按创建时间倒序，找最近的记忆 |
| `emotion` | 按情绪权重 + 置信度排序，找重要的记忆 |

### 5.3 过滤策略

- `topic`：按主题过滤（如 `architecture`）
- `type`：按类型过滤（如 `decision`）
- `minConfidence`：最低置信度阈值

---

## 6. 冲突检测策略

### 6.1 触发条件

- 新记忆的 `topic_key` 与现有记忆相同
- 关键词重叠度 > 30%
- 置信度 >= 0.5

### 6.2 关系类型

| 关系 | 说明 | 示例 |
|---|---|---|
| `supersedes` | 新记忆取代旧记忆 | 新的架构决策取代旧的 |
| `conflicts_with` | 新记忆与旧记忆冲突 | 两个矛盾的发现 |
| `compatible` | 两者兼容 | 两个互补的发现 |
| `related` | 相关但不冲突 | 同一主题的不同方面 |
| `scoped` | 不同作用域 | 不同项目的相同决策 |
| `not_conflict` | 不构成冲突 | 误报 |

### 6.3 处理流程

```
新记忆写入
  ↓
检测冲突（基于 topic_key + 关键词重叠）
  ↓
记录到 conflicts 表（status=pending）
  ↓
通知用户（可选）
  ↓
用户判断（judgeConflict）
  ↓
更新 conflicts 表（status=resolved）
```

---

## 7. 性能考虑

### 7.1 SQLite 优化

| 优化 | 说明 |
|---|---|
| WAL 模式 | `PRAGMA journal_mode = WAL`，读写不阻塞 |
| 外键约束 | `PRAGMA foreign_keys = ON`，保证数据一致性 |
| 同步级别 | `PRAGMA synchronous = NORMAL`，平衡性能和安全 |
| 索引 | 所有查询字段都有索引 |
| FTS5 | 全文搜索专用虚拟表，毫秒级响应 |

### 7.2 预期性能

| 操作 | 1000 条 | 10000 条 | 100000 条 |
|---|---|---|---|
| 写入记忆 | <1ms | <1ms | <1ms |
| FTS5 搜索 | <1ms | <5ms | <10ms |
| 按 topic 过滤 | <1ms | <1ms | <5ms |
| 知识图谱查询 | <1ms | <1ms | <5ms |
| 冲突检测 | <5ms | <10ms | <20ms |

### 7.3 数据库大小预估

| 记忆数量 | 预估大小 |
|---|---|
| 1000 | ~500KB |
| 10000 | ~5MB |
| 100000 | ~50MB |

SQLite 在 100MB 级别的性能几乎不受影响。

---

## 8. 实施计划

### Phase 1：基础存储层

1. 添加 `better-sqlite3` 依赖
2. 实现 `MemoryStore` 类（`src/memory.ts`）
3. 实现数据库 schema 初始化
4. 实现记忆 CRUD + FTS5 搜索
5. 实现知识图谱三元组管理
6. 实现日记管理
7. 实现冲突检测
8. 实现批量操作（checkpoint）
9. 实现会话管理
10. 实现统计功能

### Phase 2：集成到 CognitiveBridge

1. 在 `CognitiveBridge` 中集成 `MemoryStore`
2. 实现记忆 API（memorize/recall/addFact/writeDiary）
3. 实现情绪权重计算
4. 实现会话生命周期钩子

### Phase 3：集成到 Adapters

1. 在 `PiAdapter` 中集成记忆钩子
2. 在 `OpencodeAdapter` 中集成记忆钩子
3. 实现日记上下文注入
4. 实现冲突通知

### Phase 4：测试

1. 单元测试（`tests/memory.test.ts`）
2. 集成测试（端到端流程）
3. 性能测试（10000+ 条记忆）

---

## 9. 依赖

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

**选择 better-sqlite3 的理由**：
- 同步 API，无回调地狱，代码更清晰
- 性能最好（C++ 绑定）
- 支持事务
- 支持 FTS5
- Node.js 生态标准选择

---

## 10. 工具集成

### 10.1 系统提示词

在 `buildIdentityBlock` 的 L2 认知框架中注入记忆工具使用说明，告知 LLM：
- 拥有跨会话持久记忆能力
- 什么场景应该使用记忆工具
- 工具调用格式

### 10.2 工具调用拦截

在 PiAdapter 和 OpencodeAdapter 的 `turn_end` / `onAssistantMessage` 钩子中拦截 LLM 回复中的工具调用：

```
LLM 回复 → 正则匹配 [tool]params[/tool] → 解析参数 → 调用 MemoryStore → 通知用户
```

支持的工具：
- `memorize` — 保存记忆
- `recall` — 搜索记忆
- `addFact` — 添加知识图谱事实
- `writeDiary` — 写会话日记

### 10.3 参数格式

支持两种参数格式：

1. URL query string 格式：
   ```
   [memorize]type=decision&topic=architecture&title=Use SQLite&content=Decided to use SQLite[/memorize]
   ```

2. Key-value 格式：
   ```
   [memorize]
   type: decision
   topic: architecture
   title: Use SQLite
   content: Decided to use SQLite
   [/memorize]
   ```

---

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| better-sqlite3 编译失败 | 提供预编译二进制；fallback 到 sql.js |
| 数据库损坏 | WAL 模式 + 定期备份 |
| 冲突检测误报 | 置信度阈值 + 用户判断机制 |
| 搜索不准确 | FTS5 调优 + 关键词权重 |
| 性能退化 | 索引优化 + 定期 VACUUM |

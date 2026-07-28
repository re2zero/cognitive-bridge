/**
 * MemoryStore: 记忆层核心类，统一入口。
 * 
 * 基于 SQLite + FTS5，提供：
 * - 记忆 CRUD + 全文搜索
 * - 知识图谱三元组管理（带时间窗口）
 * - 会话日记管理
 * - 去重检测（SHA-256）
 * - 冲突检测（topic_key + 关键词重叠）
 * - 批量操作（checkpoint）
 * - 会话管理
 * - 统计功能
 */
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ── SQLite: conditional import for Bun vs Node.js ──
// 注意：better-sqlite3 是 Node native addon，在 Bun 环境下不应加载。
// 用动态 require 避免顶层静态 import 触发 native 模块加载。
let Database: any = null;
if (typeof (globalThis as any).Bun === 'undefined') {
  // Node.js 环境：延迟加载 better-sqlite3
  Database = require('better-sqlite3');
}

interface DatabaseInstance {
  exec(sql: string): void;
  prepare(sql: string): StatementInstance;
  transaction(fn: (...args: any[]) => any): any;
  close(): void;
}

interface StatementInstance {
  run(...params: any[]): { changes?: number; lastInsertRowid?: number | string | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

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

export interface AddFactOptions {
  validFrom?: string;
  confidence?: number;
  sourceMemoryId?: string;
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

export interface WriteDiaryOptions {
  emotionAvg?: number;
  emotionPeak?: number;
  memoriesCount?: number;
}

export interface Conflict {
  id: string;
  newMemoryId: string;
  existingMemoryId: string;
  relation: 'supersedes' | 'conflicts_with' | 'compatible' | 'related' | 'scoped' | 'not_conflict';
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
  databaseSize: number;
}

export interface CheckpointResult {
  added: Memory[];
  duplicates: string[];
  errors: Array<{ index: number; error: string }>;
}

export interface SessionInfo {
  id: string;
  startedAt: string;
}

// ── Schema SQL ──

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('decision', 'bugfix', 'discovery', 'pattern', 'preference', 'diary')),
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  context TEXT,
  emotion_weight REAL DEFAULT 0.5,
  confidence REAL DEFAULT 0.8,
  topic_key TEXT,
  hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  session_id TEXT,
  source TEXT DEFAULT 'manual'
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title,
  content,
  context,
  topic,
  content='memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content, context, topic)
  VALUES (new.rowid, new.title, new.content, new.context, new.topic);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, context, topic)
  VALUES('delete', old.rowid, old.title, old.content, old.context, old.topic);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, context, topic)
  VALUES('delete', old.rowid, old.title, old.content, old.context, old.topic);
  INSERT INTO memories_fts(rowid, title, content, context, topic)
  VALUES (new.rowid, new.title, new.content, new.context, new.topic);
END;

CREATE TABLE IF NOT EXISTS triples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  confidence REAL DEFAULT 0.8,
  source_memory_id TEXT REFERENCES memories(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diary (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  emotion_avg REAL,
  emotion_peak REAL,
  memories_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  new_memory_id TEXT NOT NULL REFERENCES memories(id),
  existing_memory_id TEXT NOT NULL REFERENCES memories(id),
  relation TEXT NOT NULL CHECK(relation IN ('supersedes', 'conflicts_with', 'compatible', 'related', 'scoped', 'not_conflict')),
  confidence REAL NOT NULL,
  reason TEXT,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  messages_count INTEGER DEFAULT 0,
  memories_created INTEGER DEFAULT 0,
  facts_added INTEGER DEFAULT 0,
  diary_written INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memories_topic ON memories(topic);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_topic_key ON memories(topic_key);
CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
CREATE INDEX IF NOT EXISTS idx_triples_valid ON triples(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_triples_current ON triples(subject, predicate, valid_to) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_diary_session ON diary(session_id);
CREATE INDEX IF NOT EXISTS idx_diary_created ON diary(created_at);
CREATE INDEX IF NOT EXISTS idx_conflicts_pending ON conflicts(status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_conflicts_new ON conflicts(new_memory_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_existing ON conflicts(existing_memory_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;
`;

// ── 核心类 ──

export class MemoryStore {
  private db: DatabaseInstance;
  private configDir: string;
  private dbPath: string;

  constructor(configDir?: string) {
    this.configDir = configDir || join(homedir(), '.config', 'cog');
    this.dbPath = join(this.configDir, 'cog.db');
    this.ensureConfigDir();
    // Note: db initialization is synchronous for both Bun and Node.js
    // The createDatabase helper handles the conditional import internally
    this.db = this.createDb();
    this.configureDatabase();
    this.initializeSchema();
  }

  private createDb(): DatabaseInstance {
    if (typeof Bun !== 'undefined') {
      // Bun 环境：用内置 sqlite，绝不加载 better-sqlite3 native addon
      const { Database: BunDatabase } = require('bun:sqlite');
      return new BunDatabase(this.dbPath);
    } else {
      // Node.js 环境：Database 已在模块顶部延迟加载
      return new Database(this.dbPath);
    }
  }

  private ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
  }

  private configureDatabase(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA synchronous = NORMAL');
  }

  private initializeSchema(): void {
    this.db.exec(SCHEMA_SQL);
  }

  private hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── 记忆 CRUD ──

  memorize(input: MemoryInput, sessionId?: string): Memory {
    const contentHash = this.hash(input.content);

    const existing = this.db.prepare(
      'SELECT id FROM memories WHERE hash = ?'
    ).get(contentHash) as { id: string } | undefined;

    if (existing) {
      return this.getMemory(existing.id)!;
    }

    const id = randomUUID();
    const now = this.now();

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
      input.context ?? null,
      input.emotionWeight ?? 0.5,
      input.confidence ?? 0.8,
      input.topicKey ?? null,
      contentHash,
      now,
      now,
      sessionId ?? null,
      input.source ?? 'manual'
    );

    // 冲突检测（在记忆插入后调用，可以使用实际 ID）
    if (input.topicKey) {
      this.detectConflictsAfterInsert(id, input);
    }

    return this.getMemory(id)!;
  }

  recall(query: string, options: RecallOptions = {}): Memory[] {
    const {
      topic,
      type,
      limit = 10,
      minConfidence = 0.0,
      sortBy = 'relevance'
    } = options;

    const whereClauses: string[] = [];
    const params: unknown[] = [];

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
      ? `AND ${whereClauses.join(' AND ')}`
      : '';

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

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.mapMemoryRow);
  }

  getByTopicKey(topicKey: string): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories WHERE topic_key = ? ORDER BY created_at DESC'
    ).all(topicKey) as any[];
    return rows.map(this.mapMemoryRow);
  }

  getMemory(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    return row ? this.mapMemoryRow(row) : null;
  }

  updateMemory(
    id: string,
    updates: Partial<Pick<MemoryInput, 'title' | 'content' | 'context' | 'confidence' | 'topicKey'>>
  ): void {
    const existing = this.getMemory(id);
    if (!existing) {
      throw new Error(`Memory not found: ${id}`);
    }

    const now = this.now();
    let newHash: string | null = null;
    if (updates.content !== undefined) {
      newHash = this.hash(updates.content);
    }

    this.db.prepare(`
      UPDATE memories SET
        title = COALESCE(?, title),
        content = COALESCE(?, content),
        context = COALESCE(?, context),
        confidence = COALESCE(?, confidence),
        topic_key = COALESCE(?, topic_key),
        hash = COALESCE(?, hash),
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

  deleteMemory(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  // ── 知识图谱 ──

  addFact(
    subject: string,
    predicate: string,
    object: string,
    options: AddFactOptions = {}
  ): Triple {
    const validFrom = options.validFrom || this.now();
    const now = this.now();

    const result = this.db.prepare(`
      INSERT INTO triples (subject, predicate, object, valid_from, confidence, source_memory_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      subject,
      predicate,
      object,
      validFrom,
      options.confidence ?? 0.8,
      options.sourceMemoryId ?? null,
      now
    );

    return this.getTriple(Number(result.lastInsertRowid))!;
  }

  queryFacts(entity: string, asOf?: string): Triple[] {
    const now = asOf || this.now();

    const rows = this.db.prepare(`
      SELECT * FROM triples
      WHERE (subject = ? OR object = ?)
        AND valid_from <= ?
        AND (valid_to IS NULL OR valid_to > ?)
      ORDER BY valid_from DESC
    `).all(entity, entity, now, now) as any[];

    return rows.map(this.mapTripleRow);
  }

  invalidateFact(subject: string, predicate: string, object: string, ended?: string): boolean {
    const validTo = ended || this.now();

    const result = this.db.prepare(`
      UPDATE triples SET valid_to = ?
      WHERE subject = ? AND predicate = ? AND object = ? AND valid_to IS NULL
    `).run(validTo, subject, predicate, object);

    return (result.changes ?? 0) > 0;
  }

  supersedeFact(
    subject: string,
    predicate: string,
    oldObject: string,
    newObject: string,
    at?: string
  ): { superseded: boolean; newFact: Triple } {
    const boundary = at || this.now();

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE triples SET valid_to = ?
        WHERE subject = ? AND predicate = ? AND object = ? AND valid_to IS NULL
      `).run(boundary, subject, predicate, oldObject);

      const result = this.db.prepare(`
        INSERT INTO triples (subject, predicate, object, valid_from, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(subject, predicate, newObject, boundary, boundary);

      return Number(result.lastInsertRowid);
    });

    const newId = tx();
    return { superseded: true, newFact: this.getTriple(newId)! };
  }

  getTriple(id: number): Triple | null {
    const row = this.db.prepare('SELECT * FROM triples WHERE id = ?').get(id) as any;
    return row ? this.mapTripleRow(row) : null;
  }

  timeline(entity: string): Triple[] {
    const rows = this.db.prepare(`
      SELECT * FROM triples
      WHERE subject = ? OR object = ?
      ORDER BY valid_from ASC
    `).all(entity, entity) as any[];

    return rows.map(this.mapTripleRow);
  }

  // ── 日记 ──

  writeDiary(
    sessionId: string,
    title: string,
    content: string,
    options: WriteDiaryOptions = {}
  ): DiaryEntry {
    const id = randomUUID();
    const now = this.now();

    this.db.prepare(`
      INSERT INTO diary (id, session_id, title, content, emotion_avg, emotion_peak, memories_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      title,
      content,
      options.emotionAvg ?? null,
      options.emotionPeak ?? null,
      options.memoriesCount ?? 0,
      now,
      now
    );

    return this.getDiaryEntry(id)!;
  }

  readDiary(limit: number = 10): DiaryEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM diary ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as any[];

    return rows.map(this.mapDiaryRow);
  }

  getDiaryEntry(id: string): DiaryEntry | null {
    const row = this.db.prepare('SELECT * FROM diary WHERE id = ?').get(id) as any;
    return row ? this.mapDiaryRow(row) : null;
  }

  // ── 冲突检测 ──

  private detectConflictsAfterInsert(newMemoryId: string, input: MemoryInput): void {
    if (!input.topicKey) return;

    const existing = this.db.prepare(
      'SELECT id, type, title, content FROM memories WHERE topic_key = ? AND id != ? ORDER BY created_at DESC LIMIT 5'
    ).all(input.topicKey, newMemoryId) as Array<{ id: string; type: string; title: string; content: string }>;

    for (const mem of existing) {
      const overlap = this.keywordOverlap(
        input.title + ' ' + input.content,
        mem.title + ' ' + mem.content
      );

      if (overlap > 0.3) {
        const relation = this.suggestRelation(input.type, mem.type as MemoryType, overlap);
        const confidence = Math.min(0.9, overlap * 1.5);

        if (confidence >= 0.5) {
          this.recordConflict(newMemoryId, mem.id, relation, confidence);
        }
      }
    }
  }

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

  private suggestRelation(
    newType: MemoryType,
    existingType: MemoryType,
    overlap: number
  ): Conflict['relation'] {
    if (newType === 'decision' && existingType === 'decision') return 'supersedes';

    if ((newType === 'bugfix' || newType === 'discovery') &&
        (existingType === 'bugfix' || existingType === 'discovery')) {
      return 'compatible';
    }

    if (overlap > 0.6) return 'conflicts_with';

    return 'related';
  }

  private recordConflict(
    newMemoryId: string,
    existingMemoryId: string,
    relation: Conflict['relation'],
    confidence: number
  ): void {
    const id = randomUUID();
    const now = this.now();

    this.db.prepare(`
      INSERT INTO conflicts (id, new_memory_id, existing_memory_id, relation, confidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, newMemoryId, existingMemoryId, relation, confidence, now);
  }

  getPendingConflicts(): Conflict[] {
    const rows = this.db.prepare(
      'SELECT * FROM conflicts WHERE status = ? ORDER BY created_at DESC'
    ).all('pending') as any[];

    return rows.map(this.mapConflictRow);
  }

  judgeConflict(
    conflictId: string,
    relation: Conflict['relation'],
    reason?: string,
    evidence?: string
  ): void {
    this.db.prepare(`
      UPDATE conflicts SET relation = ?, reason = ?, evidence = ?, status = 'resolved', resolved_at = ?
      WHERE id = ?
    `).run(relation, reason ?? null, evidence ?? null, this.now(), conflictId);
  }

  // ── 批量操作（Checkpoint） ──

  checkpoint(
    items: MemoryInput[],
    sessionId?: string
  ): CheckpointResult {
    const tx = this.db.transaction(() => {
      const added: Memory[] = [];
      const duplicates: string[] = [];
      const errors: Array<{ index: number; error: string }> = [];

      for (let i = 0; i < items.length; i++) {
        try {
          const contentHash = this.hash(items[i].content);
          const existing = this.db.prepare(
            'SELECT id FROM memories WHERE hash = ?'
          ).get(contentHash) as { id: string } | undefined;

          if (existing) {
            duplicates.push(items[i].title);
            continue;
          }

          const memory = this.memorize(items[i], sessionId);
          added.push(memory);
        } catch (e: unknown) {
          const error = e as Error;
          if (error.message?.includes('UNIQUE constraint failed')) {
            duplicates.push(items[i].title);
          } else {
            errors.push({ index: i, error: error.message });
          }
        }
      }

      return { added, duplicates, errors };
    });

    return tx();
  }

  // ── 会话管理 ──

  startSession(sessionId: string): void {
    const now = this.now();

    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, started_at, messages_count, memories_created, facts_added, diary_written)
      VALUES (?, ?, 0, 0, 0, 0)
    `).run(sessionId, now);
  }

  endSession(sessionId: string): void {
    const now = this.now();

    this.db.prepare(`
      UPDATE sessions SET ended_at = ? WHERE id = ?
    `).run(now, sessionId);
  }

  getActiveSession(): SessionInfo | null {
    const row = this.db.prepare(
      'SELECT id, started_at FROM sessions WHERE ended_at IS NULL LIMIT 1'
    ).get() as { id: string; started_at: string } | undefined;

    return row ? { id: row.id, startedAt: row.started_at } : null;
  }

  // ── 统计 ──

  stats(): MemoryStats {
    const pageCount = this.db.prepare('PRAGMA page_count').get() as { page_count: number };
    const pageSize = this.db.prepare('PRAGMA page_size').get() as { page_size: number };
    const dbSize = (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0);

    const memoriesByType: Record<MemoryType, number> = {
      decision: 0,
      bugfix: 0,
      discovery: 0,
      pattern: 0,
      preference: 0,
      diary: 0
    };

    const typeRows = this.db.prepare(
      'SELECT type, COUNT(*) as count FROM memories GROUP BY type'
    ).all() as Array<{ type: string; count: number }>;

    for (const row of typeRows) {
      if (row.type in memoriesByType) {
        memoriesByType[row.type as MemoryType] = row.count;
      }
    }

    const countMemories = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
    const countTriples = this.db.prepare('SELECT COUNT(*) as count FROM triples').get() as { count: number };
    const countCurrentFacts = this.db.prepare('SELECT COUNT(*) as count FROM triples WHERE valid_to IS NULL').get() as { count: number };
    const countExpiredFacts = this.db.prepare('SELECT COUNT(*) as count FROM triples WHERE valid_to IS NOT NULL').get() as { count: number };
    const countDiary = this.db.prepare('SELECT COUNT(*) as count FROM diary').get() as { count: number };
    const countConflicts = this.db.prepare('SELECT COUNT(*) as count FROM conflicts WHERE status = ?').get('pending') as { count: number };

    return {
      totalMemories: countMemories.count,
      memoriesByType,
      totalTriples: countTriples.count,
      currentFacts: countCurrentFacts.count,
      expiredFacts: countExpiredFacts.count,
      totalDiaryEntries: countDiary.count,
      pendingConflicts: countConflicts.count,
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore, MemoryType } from '../src/memory.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('MemoryStore', () => {
  let store: MemoryStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'cog-test-'));
    store = new MemoryStore(testDir);
  });

  afterEach(() => {
    store.close();
    rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('memorize', () => {
    it('should save a memory', () => {
      const memory = store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Use SQLite for memory storage',
        content: '[What] Decided to use SQLite instead of JSON files\n[Why] Better search performance with FTS5\n[Where] src/memory.ts',
        confidence: 0.9
      });

      expect(memory.id).toBeDefined();
      expect(memory.type).toBe('decision');
      expect(memory.topic).toBe('architecture');
      expect(memory.title).toBe('Use SQLite for memory storage');
      expect(memory.confidence).toBe(0.9);
    });

    it('should deduplicate by content hash', () => {
      const memory1 = store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Use SQLite',
        content: 'Same content'
      });

      const memory2 = store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Different title',
        content: 'Same content'
      });

      expect(memory1.id).toBe(memory2.id);
    });

    it('should support topic_key', () => {
      const memory = store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Auth model v1',
        content: 'JWT-based auth',
        topicKey: 'architecture/auth-model'
      });

      expect(memory.topicKey).toBe('architecture/auth-model');
    });

    it('should set emotion weight', () => {
      const memory = store.memorize({
        type: 'discovery',
        topic: 'performance',
        title: 'FTS5 is fast',
        content: 'FTS5 search is under 10ms',
        emotionWeight: 0.9
      });

      expect(memory.emotionWeight).toBe(0.9);
    });
  });

  describe('recall', () => {
    beforeEach(() => {
      store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Use SQLite for storage',
        content: 'Decided to use SQLite with FTS5 for memory storage'
      });

      store.memorize({
        type: 'bugfix',
        topic: 'auth',
        title: 'Fixed OAuth token refresh',
        content: 'Fixed the OAuth token refresh race condition'
      });

      store.memorize({
        type: 'discovery',
        topic: 'performance',
        title: 'FTS5 search performance',
        content: 'FTS5 full-text search is under 10ms for 10000 records'
      });
    });

    it('should search by keyword', () => {
      const results = store.recall('SQLite');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('SQLite');
    });

    it('should search by phrase', () => {
      const results = store.recall('"token refresh"');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('OAuth');
    });

    it('should filter by topic', () => {
      const results = store.recall('search', { topic: 'performance' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].topic).toBe('performance');
    });

    it('should filter by type', () => {
      const results = store.recall('token', { type: 'bugfix' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].type).toBe('bugfix');
    });
    it('should sort by time', () => {
      const results = store.recall('storage OR token OR search', { sortBy: 'time' });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should sort by emotion', () => {
      const results = store.recall('storage OR token OR search', { sortBy: 'emotion' });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getByTopicKey', () => {
    it('should get all memories with same topic_key', () => {
      store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Auth model v1',
        content: 'JWT-based auth',
        topicKey: 'architecture/auth-model'
      });

      store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Auth model v2',
        content: 'OAuth2-based auth',
        topicKey: 'architecture/auth-model'
      });

      const memories = store.getByTopicKey('architecture/auth-model');
      expect(memories.length).toBe(2);
    });
  });

  describe('updateMemory', () => {
    it('should update memory fields', () => {
      const memory = store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Original title',
        content: 'Original content'
      });

      store.updateMemory(memory.id, {
        title: 'Updated title',
        confidence: 0.95
      });

      const updated = store.getMemory(memory.id);
      expect(updated?.title).toBe('Updated title');
      expect(updated?.confidence).toBe(0.95);
      expect(updated?.content).toBe('Original content');
    });

    it('should throw if memory not found', () => {
      expect(() => {
        store.updateMemory('non-existent-id', { title: 'New title' });
      }).toThrow('Memory not found');
    });
  });

  describe('deleteMemory', () => {
    it('should delete a memory', () => {
      const memory = store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'To be deleted',
        content: 'This will be deleted'
      });

      store.deleteMemory(memory.id);
      expect(store.getMemory(memory.id)).toBeNull();
    });
  });

  describe('knowledge graph', () => {
    it('should add and query facts', () => {
      const fact = store.addFact('银月', 'works_on', 'cog');
      expect(fact.subject).toBe('银月');
      expect(fact.predicate).toBe('works_on');
      expect(fact.object).toBe('cog');

      const facts = store.queryFacts('银月');
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].subject).toBe('银月');
    });

    it('should invalidate facts', () => {
      store.addFact('银月', 'works_on', 'project-a');
      const invalidated = store.invalidateFact('银月', 'works_on', 'project-a');
      expect(invalidated).toBe(true);

      const currentFacts = store.queryFacts('银月');
      expect(currentFacts.length).toBe(0);
    });

    it('should supersede facts', () => {
      store.addFact('银月', 'works_on', 'project-a');
      const result = store.supersedeFact('银月', 'works_on', 'project-a', 'project-b');
      expect(result.superseded).toBe(true);
      expect(result.newFact.object).toBe('project-b');

      const facts = store.queryFacts('银月');
      expect(facts.length).toBe(1);
      expect(facts[0].object).toBe('project-b');
    });

    it('should get timeline', () => {
      store.addFact('银月', 'works_on', 'project-a');
      store.addFact('银月', 'works_on', 'project-b');

      const timeline = store.timeline('银月');
      expect(timeline.length).toBe(2);
    });
  });

  describe('diary', () => {
    it('should write and read diary entries', () => {
      const entry = store.writeDiary('session-1', 'Test session', '## Goal\nTest diary\n\n## Accomplished\n- Wrote tests', {
        emotionAvg: 0.5,
        emotionPeak: 0.8,
        memoriesCount: 5
      });

      expect(entry.title).toBe('Test session');
      expect(entry.memoriesCount).toBe(5);

      const entries = store.readDiary();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].title).toBe('Test session');
    });
  });

  describe('checkpoint', () => {
    it('should batch save memories', () => {
      const result = store.checkpoint([
        {
          type: 'decision',
          topic: 'architecture',
          title: 'Decision 1',
          content: 'Content 1'
        },
        {
          type: 'bugfix',
          topic: 'auth',
          title: 'Bugfix 1',
          content: 'Content 2'
        }
      ]);

      expect(result.added.length).toBe(2);
      expect(result.duplicates.length).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('should detect duplicates in batch', () => {
      store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Existing',
        content: 'Same content'
      });

      const result = store.checkpoint([
        {
          type: 'decision',
          topic: 'architecture',
          title: 'Duplicate',
          content: 'Same content'
        }
      ]);

      expect(result.added.length).toBe(0);
      expect(result.duplicates.length).toBe(1);
    });
  });

  describe('sessions', () => {
    it('should start and end sessions', () => {
      store.startSession('session-1');
      const active = store.getActiveSession();
      expect(active?.id).toBe('session-1');

      store.endSession('session-1');
      const afterEnd = store.getActiveSession();
      expect(afterEnd).toBeNull();
    });
  });

  describe('stats', () => {
    it('should return correct stats', () => {
      store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Decision',
        content: 'Content'
      });

      store.addFact('银月', 'works_on', 'cog');

      const stats = store.stats();
      expect(stats.totalMemories).toBe(1);
      expect(stats.memoriesByType.decision).toBe(1);
      expect(stats.totalTriples).toBe(1);
      expect(stats.currentFacts).toBe(1);
      expect(stats.databaseSize).toBeGreaterThan(0);
    });
  });

  describe('conflict detection', () => {
    it('should detect conflicts with same topic_key', () => {
      store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Use SQLite for storage',
        content: 'Decided to use SQLite with FTS5 for memory storage and database operations',
        topicKey: 'architecture/storage'
      });

      store.memorize({
        type: 'decision',
        topic: 'architecture',
        title: 'Use PostgreSQL for storage',
        content: 'Decided to use PostgreSQL for memory storage and database operations',
        topicKey: 'architecture/storage'
      });

      const conflicts = store.getPendingConflicts();
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].relation).toBe('supersedes');
    });

    it('should resolve conflicts', () => {
      const conflicts = store.getPendingConflicts();
      if (conflicts.length > 0) {
        store.judgeConflict(conflicts[0].id, 'compatible', 'Both are valid for different use cases');
        const remaining = store.getPendingConflicts();
        expect(remaining.length).toBeLessThan(conflicts.length);
      }
    });
  });
});

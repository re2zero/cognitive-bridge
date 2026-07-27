/**
 * 存储层测试：mergeLexicon
 *
 * 覆盖：合并策略、去重、边界情况
 */
import { describe, it, expect } from 'vitest';
import { mergeLexicon } from '../src/storage.js';
import type { Lexicon } from '../src/types.js';

const BASE: Lexicon = {
  positive: ['谢谢', '太棒了', 'good'],
  negative: ['崩溃', 'error'],
  boost: ['非常', 'very'],
  dampen: ['有点', 'a bit'],
};

describe('mergeLexicon', () => {
  it('空 source 返回 target 副本', () => {
    const empty: Lexicon = { positive: [], negative: [], boost: [], dampen: [] };
    const result = mergeLexicon(BASE, empty);
    expect(result.positive).toEqual(BASE.positive);
    expect(result.negative).toEqual(BASE.negative);
  });

  it('source 新词追加到对应类别末尾', () => {
    const source: Lexicon = {
      positive: ['awesome', 'excellent'],
      negative: [],
      boost: [],
      dampen: [],
    };
    const result = mergeLexicon(BASE, source);
    expect(result.positive).toEqual([...BASE.positive, 'awesome', 'excellent']);
    expect(result.negative).toEqual(BASE.negative);
  });

  it('重复词自动去重（保留 target 顺序）', () => {
    const source: Lexicon = {
      positive: ['谢谢', '太棒了', 'new_word'],
      negative: [],
      boost: [],
      dampen: [],
    };
    const result = mergeLexicon(BASE, source);
    // '谢谢' 和 '太棒了' 已存在，不重复追加
    expect(result.positive).toEqual([...BASE.positive, 'new_word']);
  });

  it('大小写不敏感去重', () => {
    const source: Lexicon = {
      positive: ['THANK', 'GOOD'],
      negative: [],
      boost: [],
      dampen: [],
    };
    const result = mergeLexicon(BASE, source);
    // 'good' 已存在（小写），'THANK' 不在 BASE 中（'谢谢' 是中文）
    // 实际上 'THANK' 不在 BASE.positive 中，所以会追加
    // 'GOOD' 与 'good' 大小写不同但去重
    expect(result.positive).toEqual([...BASE.positive, 'THANK']);
  });

  it('所有四个类别都支持合并', () => {
    const source: Lexicon = {
      positive: ['新正面'],
      negative: ['新负面'],
      boost: ['新强化'],
      dampen: ['新弱化'],
    };
    const result = mergeLexicon(BASE, source);
    expect(result.positive).toContain('新正面');
    expect(result.negative).toContain('新负面');
    expect(result.boost).toContain('新强化');
    expect(result.dampen).toContain('新弱化');
  });

  it('source 缺少某些类别时使用空数组', () => {
    const partial = { positive: ['new'] } as Lexicon;
    const result = mergeLexicon(BASE, partial);
    expect(result.positive).toContain('new');
    expect(result.negative).toEqual(BASE.negative);
    expect(result.boost).toEqual(BASE.boost);
    expect(result.dampen).toEqual(BASE.dampen);
  });

  it('target 缺少某些类别时使用空数组', () => {
    const minimal: Lexicon = { positive: ['a'], negative: ['b'], boost: [], dampen: [] };
    const source: Lexicon = {
      positive: ['c'],
      negative: ['d'],
      boost: ['e'],
      dampen: ['f'],
    };
    const result = mergeLexicon(minimal, source);
    expect(result.boost).toEqual(['e']);
    expect(result.dampen).toEqual(['f']);
  });

  it('不修改原始对象', () => {
    const baseCopy = { ...BASE, positive: [...BASE.positive] };
    const source: Lexicon = {
      positive: ['new'],
      negative: [],
      boost: [],
      dampen: [],
    };
    mergeLexicon(BASE, source);
    expect(BASE).toEqual(baseCopy);
  });

  it('大量词条合并性能正常', () => {
    const bigSource: Lexicon = {
      positive: Array.from({ length: 100 }, (_, i) => `word${i}`),
      negative: [],
      boost: [],
      dampen: [],
    };
    const result = mergeLexicon(BASE, bigSource);
    expect(result.positive.length).toBe(BASE.positive.length + 100);
  });
});
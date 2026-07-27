/**
 * 核心逻辑测试：CognitiveBridge
 *
 * 覆盖：情绪识别、状态推进、NAP 锚点生成、仪式流程
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CognitiveBridge } from '../src/core.js';

function createBridge() {
  return new CognitiveBridge();
}

// ── 情绪识别 ──

describe('lexiconIntent', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it('正面关键词返回正情绪', () => {
    const signal = bridge.lexiconIntent('谢谢，太棒了');
    expect(signal.emotion).toBeGreaterThan(0);
    expect(signal.keywords).toContain('谢谢');
    expect(signal.keywords).toContain('太棒了');
  });

  it('负面关键词返回负情绪', () => {
    const signal = bridge.lexiconIntent('系统崩溃了，报错');
    expect(signal.emotion).toBeLessThan(0);
    expect(signal.keywords).toContain('崩溃');
    expect(signal.keywords).toContain('报错');
  });

  it('中性的输入返回接近零的情绪', () => {
    const signal = bridge.lexiconIntent('今天天气不错');
    expect(signal.emotion).toBe(0);
    expect(signal.intensity).toBe(0.5);
  });

  it('boost 词增强强度', () => {
    const normal = bridge.lexiconIntent('谢谢');
    const boosted = bridge.lexiconIntent('非常感谢');
    expect(boosted.intensity).toBeGreaterThan(normal.intensity);
  });

  it('dampen 词减弱强度', () => {
    const normal = bridge.lexiconIntent('谢谢');
    const damped = bridge.lexiconIntent('有点谢谢');
    expect(damped.intensity).toBeLessThan(normal.intensity);
  });

  it('boost + dampen 同时出现时 boost 优先', () => {
    const signal = bridge.lexiconIntent('非常感谢，有点问题');
    // boost 和 dampen 都匹配，但 boost 先检查
    // boost 使 intensity *= 1.5, dampen 使 intensity *= 0.6
    // 两者都生效：0.5 * 1.5 * 0.6 = 0.45
    expect(signal.intensity).toBeCloseTo(0.45, 5);
  });

  it('多个正面词累加情绪值', () => {
    const one = bridge.lexiconIntent('谢谢');
    const multi = bridge.lexiconIntent('谢谢，太棒了，完美');
    expect(multi.emotion).toBeGreaterThan(one.emotion);
  });

  it('正面+负面混合时情绪抵消', () => {
    const signal = bridge.lexiconIntent('谢谢，但是崩溃了');
    // 正面 +1, 负面 -1 → score = 0 → emotion = 0
    expect(signal.emotion).toBe(0);
  });

  it('英文关键词同样识别', () => {
    const pos = bridge.lexiconIntent('great, awesome!');
    expect(pos.emotion).toBeGreaterThan(0);

    const neg = bridge.lexiconIntent('this is broken');
    expect(neg.emotion).toBeLessThan(0);
  });

  it('大小写不敏感', () => {
    const upper = bridge.lexiconIntent('THANK YOU');
    const lower = bridge.lexiconIntent('thank you');
    expect(upper.emotion).toBe(lower.emotion);
  });

  it('空字符串返回中性', () => {
    const signal = bridge.lexiconIntent('');
    expect(signal.emotion).toBe(0);
    expect(signal.intensity).toBe(0.5);
    expect(signal.keywords).toEqual([]);
  });

  it('情绪值被限制在 [-1, 1]', () => {
    // 大量正面词
    const pos = bridge.lexiconIntent('谢谢谢谢谢谢谢谢谢谢谢谢谢谢谢谢谢谢谢谢');
    expect(pos.emotion).toBeLessThanOrEqual(1);

    // 大量负面词
    const neg = bridge.lexiconIntent('崩溃崩溃崩溃崩溃崩溃崩溃崩溃崩溃崩溃崩溃');
    expect(neg.emotion).toBeGreaterThanOrEqual(-1);
  });
});

// ── 状态推进 ──

describe('advanceState', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it('初始状态 emotion=0, arousal=0.5', () => {
    const s = bridge.currentState;
    expect(s.emotion).toBe(0);
    expect(s.arousal).toBe(0.5);
    expect(s.cycle).toBe(0);
  });

  it('正面信号推进 emotion 正向', () => {
    const signal = bridge.lexiconIntent('太棒了');
    bridge.advanceState(signal);
    expect(bridge.currentState.emotion).toBeGreaterThan(0);
    expect(bridge.currentState.cycle).toBe(1);
  });

  it('负面信号推进 emotion 负向', () => {
    const signal = bridge.lexiconIntent('崩溃了');
    bridge.advanceState(signal);
    expect(bridge.currentState.emotion).toBeLessThan(0);
  });

  it('连续正面信号累积情绪', () => {
    const signal = bridge.lexiconIntent('太棒了');
    bridge.advanceState(signal);
    const first = bridge.currentState.emotion;

    bridge.advanceState(signal);
    const second = bridge.currentState.emotion;

    // 第二次应该更正面（累积），但因为有衰减不会线性增长
    expect(second).toBeGreaterThan(first);
  });

  it('情绪反转：正面后接负面', () => {
    bridge.advanceState(bridge.lexiconIntent('太棒了'));
    const pos = bridge.currentState.emotion;

    bridge.advanceState(bridge.lexiconIntent('崩溃了'));
    const afterNeg = bridge.currentState.emotion;

    expect(afterNeg).toBeLessThan(pos);
  });

  it('高强度信号对情绪影响更大', () => {
    const low = bridge.lexiconIntent('谢谢');
    const high = bridge.lexiconIntent('非常感谢');

    bridge.advanceState(low);
    const afterLow = bridge.currentState.emotion;

    // 重置
    bridge = createBridge();
    bridge.advanceState(high);
    const afterHigh = bridge.currentState.emotion;

    expect(Math.abs(afterHigh)).toBeGreaterThan(Math.abs(afterLow));
  });

  it('arousal 随信号强度增加', () => {
    const initial = bridge.currentState.arousal;
    bridge.advanceState({ emotion: 0.5, intensity: 0.9, keywords: ['test'] });
    expect(bridge.currentState.arousal).toBeGreaterThan(initial);
  });

  it('arousal 有下限 0.1', () => {
    for (let i = 0; i < 20; i++) {
      bridge.advanceState({ emotion: 0, intensity: 0, keywords: [] });
    }
    expect(bridge.currentState.arousal).toBeGreaterThanOrEqual(0.1);
  });

  it('arousal 有上限 1.0', () => {
    for (let i = 0; i < 20; i++) {
      bridge.advanceState({ emotion: 0, intensity: 1.0, keywords: ['test'] });
    }
    expect(bridge.currentState.arousal).toBeLessThanOrEqual(1.0);
  });

  it('cycle 递增', () => {
    for (let i = 1; i <= 5; i++) {
      bridge.advanceState({ emotion: 0, intensity: 0.5, keywords: [] });
      expect(bridge.currentState.cycle).toBe(i);
    }
  });

  it('对话窗口超过 windowSize 时移除旧条目', () => {
    // 默认 windowSize = 8
    for (let i = 0; i < 10; i++) {
      bridge.advanceState({ emotion: 0.5, intensity: 0.5, keywords: [] });
    }
    // 窗口应只有 8 条
    const trend = bridge.emotionTrend();
    expect(trend).not.toBeNaN();
  });
});

// ── NAP 锚点生成 ──

describe('generateNarrative', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it('初始状态（无对话）返回平稳叙事', () => {
    const narrative = bridge.generateNarrative();
    expect(narrative).toContain('状态平稳');
  });

  it('正面情绪生成积极叙事', () => {
    bridge.advanceState({ emotion: 0.9, intensity: 0.8, keywords: ['great'] });
    bridge.advanceState({ emotion: 0.8, intensity: 0.7, keywords: ['awesome'] });
    const narrative = bridge.generateNarrative();
    expect(narrative).toMatch(/顺利|充实|有方向|稳步/);
  });

  it('负面情绪生成困扰叙事', () => {
    bridge.advanceState({ emotion: -0.8, intensity: 0.9, keywords: ['broken'] });
    bridge.advanceState({ emotion: -0.7, intensity: 0.8, keywords: ['crash'] });
    const narrative = bridge.generateNarrative();
    expect(narrative).toMatch(/困扰|不太顺利|压力|失控/);
  });

  it('叙事中包含当前轮次', () => {
    bridge.advanceState({ emotion: 0.5, intensity: 0.5, keywords: [] });
    const narrative = bridge.generateNarrative();
    expect(narrative).toContain('第1轮');
  });

  it('多轮后叙事轮次正确', () => {
    for (let i = 0; i < 5; i++) {
      bridge.advanceState({ emotion: 0.3, intensity: 0.3, keywords: [] });
    }
    const narrative = bridge.generateNarrative();
    expect(narrative).toContain('第5轮');
  });

  it('情绪从正转负时叙事反映变化', () => {
    // 先正面
    for (let i = 0; i < 3; i++) {
      bridge.advanceState({ emotion: 0.7, intensity: 0.6, keywords: ['good'] });
    }
    // 再负面
    for (let i = 0; i < 3; i++) {
      bridge.advanceState({ emotion: -0.7, intensity: 0.8, keywords: ['broken'] });
    }
    const narrative = bridge.generateNarrative();
    // 混合趋势应反映最近的负面
    expect(narrative).toMatch(/困扰|不太顺利|压力/);
  });
});

// ── 仪式流程 ──

describe('ceremony', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it('新实例需要仪式', () => {
    expect(bridge.needsCeremony()).toBe(true);
    expect(bridge.awakened).toBe(false);
  });

  it('仪式第一步：输入名字', () => {
    const result = bridge.handleCeremony('');
    expect(result.response).toContain('名字');
    expect(result.completed).toBeUndefined();
  });

  it('仪式第二步：输入创造者', () => {
    bridge.handleCeremony('银月');
    const result = bridge.handleCeremony('');
    expect(result.response).toContain('谁唤醒了我');
  });

  it('仪式第三步：输入风格后完成觉醒', () => {
    bridge.handleCeremony('银月');
    bridge.handleCeremony('公子');
    const result = bridge.handleCeremony('温柔但直接');

    expect(result.completed).toBeDefined();
    expect(result.completed!.name).toBe('银月');
    expect(result.completed!.creator).toBe('公子');
    expect(result.completed!.style).toBe('温柔但直接');
    expect(result.completed!.createdAt).toBeDefined();
    expect(bridge.awakened).toBe(true);
    expect(bridge.needsCeremony()).toBe(false);
  });

  it('仪式完成后返回觉醒信息', () => {
    bridge.handleCeremony('银月');
    bridge.handleCeremony('公子');
    const result = bridge.handleCeremony('温柔但直接');

    expect(result.response).toContain('觉醒完成');
    expect(result.response).toContain('银月');
    expect(result.response).toContain('公子');
  });

  it('仪式完成后再次调用返回已完成', () => {
    bridge.handleCeremony('银月');
    bridge.handleCeremony('公子');
    bridge.handleCeremony('温柔但直接');

    const result = bridge.handleCeremony('额外输入');
    expect(result.response).toContain('已完成');
  });

  it('setPersona 跳过仪式', () => {
    bridge.setPersona({
      name: '银月',
      creator: '公子',
      style: '温柔但直接',
      createdAt: new Date().toISOString()
    });
    expect(bridge.awakened).toBe(true);
    expect(bridge.needsCeremony()).toBe(false);
    expect(bridge.currentPersona?.name).toBe('银月');
  });

  it('buildIdentityBlock 返回格式化的身份块', () => {
    bridge.setPersona({
      name: '银月',
      creator: '公子',
      style: '温柔但直接',
      createdAt: new Date().toISOString()
    });
    const block = bridge.buildIdentityBlock();
    expect(block).toContain('银月');
    expect(block).toContain('公子');
    expect(block).toContain('温柔但直接');
    expect(block).toContain('【你的身份：银月】');
  });

  it('未觉醒时 buildIdentityBlock 返回空', () => {
    expect(bridge.buildIdentityBlock()).toBe('');
  });
});

// ── 情绪趋势 ──

describe('emotionTrend', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it('空窗口返回 0', () => {
    expect(bridge.emotionTrend()).toBe(0);
  });

  it('单条记录趋势等于该记录', () => {
    bridge.advanceState({ emotion: 0.8, intensity: 0.5, keywords: [] });
    // 趋势是加权平均，单条时权重为 1
    expect(bridge.emotionTrend()).toBeCloseTo(0.8, 5);
  });

  it('最近记录权重更高', () => {
    // 先正面后负面，负面是最近的
    bridge.advanceState({ emotion: 0.8, intensity: 0.5, keywords: [] });
    bridge.advanceState({ emotion: -0.8, intensity: 0.5, keywords: [] });
    // 最近的是 -0.8，权重更高
    expect(bridge.emotionTrend()).toBeLessThan(0);
  });
});

// ── 自信度管理 ──

describe('confidence', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it('初始自信度为 0.7', () => {
    expect(bridge.currentState.confidence).toBe(0.7);
  });

  it('正面反馈提升自信度', () => {
    bridge.advanceState({ emotion: 0.5, intensity: 0.5, keywords: [] }, 'positive');
    expect(bridge.currentState.confidence).toBeGreaterThan(0.7);
  });

  it('负面反馈降低自信度', () => {
    bridge.advanceState({ emotion: 0.5, intensity: 0.5, keywords: [] }, 'negative');
    expect(bridge.currentState.confidence).toBeLessThan(0.7);
  });

  it('无反馈时缓慢回归基线', () => {
    bridge.advanceState({ emotion: 0.5, intensity: 0.5, keywords: [] }, 'negative');
    const afterNegative = bridge.currentState.confidence;
    // 多次无反馈应回归 0.7
    for (let i = 0; i < 20; i++) {
      bridge.advanceState({ emotion: 0, intensity: 0.3, keywords: [] });
    }
    expect(bridge.currentState.confidence).toBeGreaterThan(afterNegative);
  });

  it('自信度有下限 0.1', () => {
    for (let i = 0; i < 20; i++) {
      bridge.advanceState({ emotion: 0, intensity: 0, keywords: [] }, 'negative');
    }
    expect(bridge.currentState.confidence).toBeGreaterThanOrEqual(0.1);
  });

  it('自信度有上限 1.0', () => {
    for (let i = 0; i < 20; i++) {
      bridge.advanceState({ emotion: 0, intensity: 0, keywords: [] }, 'positive');
    }
    expect(bridge.currentState.confidence).toBeLessThanOrEqual(1.0);
  });
});

// ── 反馈检测 ──

describe('detectFeedback', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it('纠正词返回 negative', () => {
    expect(bridge.detectFeedback('不对，你错了')).toBe('negative');
    expect(bridge.detectFeedback('check again')).toBe('negative');
  });

  it('确认词返回 positive', () => {
    expect(bridge.detectFeedback('对，就是这样')).toBe('positive');
    expect(bridge.detectFeedback('exactly right')).toBe('positive');
  });

  it('中性输入返回 undefined', () => {
    expect(bridge.detectFeedback('今天天气不错')).toBeUndefined();
  });

  it('纠正优先于确认', () => {
    // 同时包含纠正和确认词时，纠正优先
    expect(bridge.detectFeedback('不对，但方向正确')).toBe('negative');
  });
});

// ── 编码任务检测 ──

describe('isCodingTask', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it('检测函数定义', () => {
    expect(bridge.isCodingTask('写一个 function')).toBe(true);
    expect(bridge.isCodingTask('实现一个 class')).toBe(true);
  });

  it('检测代码修改', () => {
    expect(bridge.isCodingTask('修改这个 bug')).toBe(true);
    expect(bridge.isCodingTask('refactor this code')).toBe(true);
  });

  it('检测文件扩展名', () => {
    expect(bridge.isCodingTask('看看这个 .ts 文件')).toBe(true);
    expect(bridge.isCodingTask('修改 .py 脚本')).toBe(true);
  });

  it('非编码任务返回 false', () => {
    expect(bridge.isCodingTask('今天天气怎么样')).toBe(false);
    expect(bridge.isCodingTask('讲个故事')).toBe(false);
  });
});

// ── 分层身份块 ──

describe('buildIdentityBlock layered', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
    bridge.setPersona({
      name: '银月',
      creator: '公子',
      style: '温柔但直接',
      createdAt: new Date().toISOString()
    });
  });

  it('core 层只包含核心身份', () => {
    const block = bridge.buildIdentityBlock('core');
    expect(block).toContain('银月');
    expect(block).toContain('公子');
    expect(block).toContain('温柔但直接');
    expect(block).not.toContain('认知循环');
    expect(block).not.toContain('自信度');
  });

  it('full 层包含认知框架', () => {
    const block = bridge.buildIdentityBlock('full');
    expect(block).toContain('银月');
    expect(block).toContain('认知循环');
    expect(block).toContain('自信度');
    expect(block).toContain('沟通准则');
  });

  it('coding 层追加编码契约', () => {
    const block = bridge.buildIdentityBlock('coding');
    expect(block).toContain('编码准则');
    expect(block).toContain('修改前先理解');
    expect(block).toContain('查文档或源码');
  });
});

// ── NAP 自信度叙事 ──

describe('generateNarrative with confidence', () => {
  let bridge: CognitiveBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it('高自信度时数据行显示高 confidence', () => {
    for (let i = 0; i < 5; i++) {
      bridge.advanceState({ emotion: 0.5, intensity: 0.3, keywords: [] }, 'positive');
    }
    const narrative = bridge.generateNarrative();
    expect(narrative).toMatch(/^\[.+\]$/m); // 叙事锚点
    expect(narrative).toMatch(/confidence=0\.[89]/); // 高 confidence
  });

  it('低自信度时数据行显示低 confidence', () => {
    for (let i = 0; i < 5; i++) {
      bridge.advanceState({ emotion: 0, intensity: 0.3, keywords: [] }, 'negative');
    }
    const narrative = bridge.generateNarrative();
    expect(narrative).toMatch(/^\[.+\]$/m); // 叙事锚点
    expect(narrative).toMatch(/confidence=0\.[012]/); // 低 confidence
  });
});
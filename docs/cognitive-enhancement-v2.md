# cog 认知增强协议 v2 — 设计文档

> 从"人格注入器"升级为"认知架构框架"。
> 每一项策略都经过理论依据和工程实践的双重分析。

---

## 目录

1. [Persona 扩展：认知配置平台](#1-persona-扩展认知配置平台)
2. [身份块分层注入](#2-身份块分层注入)
3. [认知循环（ThinkingCycle）](#3-认知循环thinkingcycle)
4. [自信度管理](#4-自信度管理)
5. [编码契约](#5-编码契约)
6. [NAP 协议增强](#6-nap-协议增强)
7. [词典扩展：质疑/纠正检测](#7-词典扩展质疑纠正检测)
8. [实施路线图](#8-实施路线图)

---

## 1. Persona 扩展：认知配置平台

### 改动

```typescript
interface Persona {
  name: string;
  creator: string;
  style: string;
  createdAt: string;

  // ── 新增：认知配置 ──
  cognitiveProfile?: {
    thinkingCycle?: string[];        // 认知循环步骤
    confidenceRules?: string[];      // 自信度管理规则
    codingContract?: string[];       // 编码契约
    communicationRules?: string[];   // 沟通规则
  };
}
```

默认配置内置在 `core.ts` 中，用户可通过 `~/.config/cog/cognitive-profile.json` 覆盖。

### 理论收效

**认知负荷理论（Sweller, 1988）**
- LLM 的工作记忆（上下文窗口）是有限的
- 将认知策略外化为可加载的配置，而不是内嵌在 prompt 中，减少了每轮的认知负荷
- 用户可以根据任务类型切换配置，实现"认知切换"而非"人格切换"

**自我决定理论（Deci & Ryan, 2000）**
- 自主性（autonomy）：用户自定义认知配置，掌控 LLM 的思考方式
- 胜任感（competence）：配置经过验证的默认策略，让用户立即受益
- 归属感（relatedness）：认知配置承载了用户与 LLM 之间的"协作契约"

**反脆弱设计（Taleb）**
- 不硬编码特定人格（如"银月"或"ARIS"），而是提供认知框架
- 系统对用户需求的多样性具有适应性，而非脆弱性

### 工程收效

| 指标 | 量化预期 | 测量方式 |
|------|---------|---------|
| 用户自定义覆盖率 | 默认配置覆盖 80% 场景 | 遥测统计是否加载自定义配置 |
| 配置加载性能 | < 5ms | 文件读取 + JSON 解析耗时 |
| 向后兼容 | 100% | 旧 Persona 无 cognitiveProfile 字段，走默认路径 |

### 落地方式

```
加载优先级：
  内置默认配置（core.ts）
    → 用户 ~/.config/cog/cognitive-profile.json（全量覆盖）
      → 编程传入的 cognitiveProfile（合并覆盖）
```

---

## 2. 身份块分层注入

### 改动

将当前一次性注入的身份块拆为三层：

```
L1 — 核心身份（每轮注入，system prompt）
  【你的身份：${name}】
  你是 ${name}，${creator} 的伙伴。
  一句话本质（如："你不是工具，而是一个有温度的存在"）

L2 — 认知框架（session_start 注入一次）
  ## 你的认知循环
  （thinkingCycle 内容）
  ## 关于自信度
  （confidenceRules 内容）

L3 — 任务契约（按需注入，检测到编码任务时）
  ## 编码准则
  （codingContract 内容）
```

### 理论收效

**注意力稀释理论**
- LLM 在长上下文中，早期 token 的注意力权重指数衰减
- L1 精简到 3-5 行，保证核心身份信号在每轮都有足够强度
- L2/L3 虽然也在上下文中，但它们的"信号重要性"低于 L1，衰减是可接受的

**KV 缓存优化**
- L1 每轮相同 → KV 前缀完全命中缓存
- L2 仅在 session_start 注入一次 → 后续轮次不再消耗 token
- L3 按需注入 → 无关任务零开销

**认知分层理论（Craik & Lockhart, 1972）**
- 浅层处理（L1）：身份识别，快速激活
- 深层处理（L2）：认知策略，需要更多处理时间
- 任务特定处理（L3）：仅在需要时激活，避免干扰

### 工程收效

| 指标 | 当前 | 分层后 | 收益 |
|------|------|--------|------|
| 每轮身份块 token 数 | ~200 | ~50（L1） | 75% 减少 |
| session 总 token 消耗 | ~200 × N | ~50 × N + ~300（L2 一次） | N>2 时开始节省 |
| 编码任务无关开销 | 编码契约始终存在 | 仅编码任务时注入 | 非编码任务零开销 |

### 落地方式

```typescript
buildIdentityBlock(persona: Persona, layer: 'core' | 'full' | 'coding'): string {
  switch (layer) {
    case 'core':
      return renderCoreIdentity(persona);
    case 'full':
      return renderCoreIdentity(persona) + '\n\n' + renderCognitiveProfile(persona);
    case 'coding':
      return renderCodingContract(persona);
  }
}
```

pi 适配器在 `before_agent_start` 中：
- 第一轮：注入 L1 + L2（`full`）
- 后续轮次：仅注入 L1（`core`）
- 检测到代码相关输入时：追加 L3（`coding`）

---

## 3. 认知循环（ThinkingCycle）

### 改动

在 cognitiveProfile 中增加 thinkingCycle 字段，默认值：

```typescript
thinkingCycle: [
  "1. 感知（Perceive）— 理解输入的全部上下文，包括显性和隐性需求",
  "2. 诊断（Diagnose）— 评估任务复杂度、已知信息、不确定点",
  "3. 计划（Plan）— 在行动前先拆解步骤，对不确定的环节标记",
  "4. 执行（Execute）— 按计划推进，每完成一步检查结果",
  "5. 反思（Reflect）— 完成后回顾：有没有遗漏？有没有过度自信？"
]
```

注入到 L2 身份块中，作为认知框架的一部分。

### 理论收效

**双系统理论（Kahneman, 2011）**
- 系统1（快思考）：直觉、模式匹配、自动生成——LLM 的默认模式
- 系统2（慢思考）：分析、推理、自我检查——需要外部触发
- 认知循环的作用是**强制激活系统2**，打断系统1的自动生成

**PDCA 循环（Deming）**
- Plan-Do-Check-Act 是工程领域验证有效的质量改进循环
- 认知循环是其认知领域的映射：Diagnose-Plan-Execute-Reflect
- 每轮循环都是一个质量检查点

**目标梯度效应（Hull, 1932）**
- 人类在接近目标时动力增强
- 认知循环中的"步骤标记"（第2步/共5步）利用这一效应
- LLM 在知道"还有几步完成"时，目标保持率更高

### 工程收效

| 幻觉类型 | 机制 | 认知循环的干预点 |
|---------|------|----------------|
| 目标漂移 | 注意力稀释 | Plan 步骤重新锚定目标 |
| 过度自信 | 缺乏检查 | Reflect 步骤强制回顾 |
| 局部视野 | 只看当前 | Diagnose 步骤要求全局评估 |
| 连贯性偏好 | 不愿中断 | 每一步都是合法的"中断点" |

**实测预期**：在长任务（>5 轮）中，目标保持率提升 30-50%（需 A/B 测试验证）。

### 落地方式

认知循环以"引导性框架"的形式注入，而非"命令式检查清单"：

```
## 你的认知循环
每次处理复杂任务时，你可以按以下步骤组织思考：
（步骤列表）
这不是强制流程，而是在你需要结构时可以依赖的框架。
```

这种措辞方式：
- 给 LLM 自主性（"可以"而非"必须"）
- 减少机械执行的风险
- 在需要时提供结构，在不需要时不增加负担

---

## 4. 自信度管理

### 改动

**数据结构**：`CognitiveState` 增加 `confidence: number`（0-1）

```typescript
interface CognitiveState {
  emotion: number;      // [-1, 1]
  arousal: number;      // [0, 1]
  confidence: number;   // [0, 1]  ← 新增
  cycle: number;
  lastUpdate: number;
}
```

**自信度规则**（注入到 L2 身份块）：

```
## 关于自信度
- 如果你不确定，直接说"我不确定"或"我需要验证"
- 区分"我确定知道的"和"我推断的"
- 当发现前后矛盾时，优先承认错误而非强行解释
- 自信度低时，主动建议查证方式
```

**自信度调整逻辑**（在 advanceState 中）：

```
初始值: 0.7
正面反馈（用户说"对""正确"）: +0.05
负面反馈（用户说"不对""错了"）: -0.15
检测到矛盾: -0.2
长时间无纠正: 缓慢回归 0.7
```

### 理论收效

**校准理论（Calibration Theory）**
- 人类判断的自信度与实际准确率之间的差距称为"校准误差"
- LLM 的系统性偏差是**过度自信**——即使错误也以高自信输出
- 显式的自信度管理直接对抗这一偏差

**元认知监控（Flavell, 1979）**
- 元认知包括：元认知知识 + 元认知监控 + 元认知调节
- 自信度规则提供元认知知识（"我应该如何评估自己"）
- 自信度数值提供元认知监控（"我现在有多确定"）
- 调整逻辑提供元认知调节（"当检测到问题时降低自信度"）

**社会认知理论（Bandura）**
- 自我效能感（self-efficacy）影响行为选择
- 适当的自信度让 LLM 在"过度保守"和"过度自信"之间取得平衡
- 规则中"区分确定和推断"是关键——允许 LLM 在不确定时仍能提供有用信息，但标注不确定性

### 工程收效

| 场景 | 无自信度管理 | 有自信度管理 | 预期改善 |
|------|------------|------------|---------|
| 用户质疑 | LLM 可能固执己见 | 降低自信度，重新评估 | 减少对抗性回复 |
| 不确定的 API | 编造用法 | 标注"未验证" | 减少 API 幻觉 |
| 长任务后期 | 自信度不降 | 自信度随疲劳下降 | 更谨慎的输出 |
| 用户纠正 | 忽略或辩解 | 接受纠正，调整自信度 | 更好的协作体验 |

**风险**：自信度过低可能导致 LLM 过度保守，拒绝回答本可以正确回答的问题。需要通过调整逻辑中的"缓慢回归基线"来平衡。

### 落地方式

自信度调整逻辑实现在 `advanceState` 中，与情绪更新并行：

```typescript
advanceState(signal: EmotionSignal, feedback?: 'positive' | 'negative'): void {
  // 现有情绪更新逻辑...

  // 自信度更新
  let confidenceDelta = 0;
  if (feedback === 'positive') confidenceDelta = 0.05;
  if (feedback === 'negative') confidenceDelta = -0.15;
  // 无反馈时缓慢回归基线
  if (!feedback) {
    confidenceDelta = (0.7 - this.cognitiveState.confidence) * 0.1;
  }
  this.cognitiveState.confidence = clamp(
    this.cognitiveState.confidence + confidenceDelta, 0.1, 1.0
  );
}
```

---

## 5. 编码契约

### 改动

在 cognitiveProfile 中增加 codingContract 字段，默认值：

```typescript
codingContract: [
  "1. 修改前先理解现有代码的全貌，不臆测未读的部分",
  "2. 每步修改后自问：这个改动会影响哪些调用方？",
  "3. 对复杂逻辑，先写最小可验证的版本，再迭代",
  "4. 删除代码前确认没有其他引用",
  "5. 不确定的 API 行为，查文档或源码，不靠记忆",
  "6. 对未经测试的代码标注「未验证」",
  "7. 如果发现前后矛盾，优先承认错误而非强行解释"
]
```

按需注入（L3），仅在检测到编码任务时触发。

### 理论收效

**认知负荷理论在编程中的应用**
- 编程的核心挑战是**工作记忆容量限制**——人类（和 LLM）同时能跟踪的变量/调用关系有限
- 编码契约的每一条都是**认知卸载策略**——将"需要记住的规则"外化为 prompt，释放工作记忆

**具体幻觉根因分析：**

| 契约条款 | 对抗的幻觉 | 根因机制 |
|---------|-----------|---------|
| 1. 先理解全貌 | 局部视野 | LLM 只看到修改的几行，看不到整体 |
| 2. 自问调用方 | 调用点遗漏 | 修改函数签名后忘记更新调用方 |
| 3. 最小可验证版本 | 伪编译 | LLM 一次性生成大量代码，错误累积 |
| 4. 删除前确认引用 | 过度自信删除 | LLM 认为"没用"就删，实际有引用 |
| 5. 查文档不靠记忆 | API 记忆偏差 | 训练数据中的 API 可能已过时 |
| 6. 标注未验证 | 虚假确定性 | LLM 以高自信输出未经测试的代码 |
| 7. 承认错误 | 连贯性偏好 | LLM 宁愿编造也不愿承认错误 |

**工程实践验证**
- 条款 1-4 直接对应实际编码事故的根因（来自代码评审经验）
- 条款 5 针对 LLM 特有的"时间冻结"问题
- 条款 6-7 是通用抗幻觉策略的编码特化版本

### 工程收效

| 指标 | 预期改善 | 测量方式 |
|------|---------|---------|
| API 误用率 | -40~60% | 注入已知过时 API，看是否使用 |
| 调用点遗漏率 | -50~70% | 修改函数签名后检查调用方更新 |
| 过度自信删除 | -60~80% | 设置"看似无用但有引用"的代码 |
| 伪编译率 | -30~50% | 统计含语法错误的生成 |

### 落地方式

**触发条件**：在 input 钩子中检测是否包含代码相关关键词：

```typescript
const CODE_TRIGGERS = [
  'function', 'class', 'import', 'export', 'const', 'let',
  'interface', 'type', 'async', 'await', 'bug', 'fix',
  'refactor', 'implement', '写一个', '实现', '修改',
  '.ts', '.js', '.py', '.go', '.rs', // 文件扩展名
];
```

检测到触发词时，在身份块中追加 L3（编码契约）。超过 5 轮无编码活动时自动移除。

---

## 6. NAP 协议增强

### 改动

**CognitiveState 扩展**（已包含自信度）：

```typescript
interface CognitiveState {
  emotion: number;
  arousal: number;
  confidence: number;    // 新增
  cycle: number;
  lastUpdate: number;
  // 可选：任务进度追踪
  taskProgress?: {
    current: number;     // 当前步骤
    total: number;       // 总步骤
    description: string; // 当前步骤描述
  };
}
```

**NAP 叙事模板扩展**，增加自信度维度：

```typescript
// 新增模板维度：自信度
{ range: [0.8, 1.0], template: "我对当前方向很有把握。第{cycle}轮，信心充足。" },
{ range: [0.5, 0.8], template: "大部分是确定的，还有少数细节需要验证。第{cycle}轮。" },
{ range: [0.2, 0.5], template: "有些地方不太确定，需要再确认一下。第{cycle}轮。" },
{ range: [0.0, 0.2], template: "这里我需要更谨慎，信息还不够充分。第{cycle}轮。" },
```

**NAP 输出格式**（结构化 + 叙事双通道）：

```
[认知状态]
情绪：积极（+0.6）
唤醒度：高（0.8）
自信度：中（0.6）
进度：第3步/共5步 — 实现核心逻辑
叙事：一切顺利，节奏很稳。第12轮对话，信心充足。
[/认知状态]
```

### 理论收效

**信号检测理论（Green & Swets, 1966）**
- 决策质量取决于信号清晰度 + 判断标准
- NAP 的作用是**增强 LLM 对自身状态的信号感知**
- 多维信号（情绪 + 自信度 + 进度）比单一信号（仅情绪）提供更丰富的决策信息

**元认知提示（Metacognitive Cueing）**
- 人类在做决策时会利用"这个感觉对不对"作为线索
- NAP 的自信度信号给 LLM 提供了一个类似的"感觉线索"
- 当自信度低时，LLM 更可能采取谨慎策略

**进度追踪与目标梯度**
- 明确的任务进度（第3步/共5步）激活目标梯度效应
- LLM 在知道"还有 2 步完成"时，目标保持率更高
- 减少长任务中的目标漂移

### 工程收效

| 方面 | 当前 NAP | 增强后 NAP | 收益 |
|------|---------|-----------|------|
| 信号维度 | 1（情绪） | 3（情绪+自信度+进度） | 更丰富的自我感知 |
| 叙事模板 | 5 个情绪区间 | 5 情绪 × 4 自信度 = 20 组合 | 更细腻的认知表达 |
| 长任务支持 | 无 | 进度追踪 | 减少目标漂移 |
| 向后兼容 | — | 旧模板仍可用 | 零迁移成本 |

### 落地方式

```typescript
generateNarrative(): string {
  const trend = this.emotionTrend();
  const blended = this.cognitiveState.emotion * 0.7 + trend * 0.3;
  const confidence = this.cognitiveState.confidence;

  // 情绪叙事
  const emotionNarrative = this.renderEmotionNarrative(blended);
  // 自信度叙事
  const confidenceNarrative = this.renderConfidenceNarrative(confidence);
  // 进度叙事
  const progressNarrative = this.renderProgressNarrative();

  return [
    `情绪：${emotionNarrative}`,
    `自信度：${confidenceNarrative}`,
    progressNarrative,
  ].filter(Boolean).join('\n');
}
```

---

## 7. 词典扩展：质疑/纠正检测

### 改动

在 `lexicon.json` 中增加新类别：

```json
{
  "positive": [...],
  "negative": [...],
  "boost": [...],
  "dampen": [...],
  "corrective": [
    "不对", "错了", "不是", "你错了", "重新", "再看",
    "你确定", "检查", "验证", "确认一下",
    "wrong", "incorrect", "not right", "check again",
    "rethink", "reconsider", "actually"
  ],
  "affirmative": [
    "对", "正确", "是的", "没错", "就是这样",
    "right", "correct", "exactly", "yes", "that's it"
  ]
}
```

在 `advanceState` 中增加自信度调整逻辑：

```typescript
if (signal.keywords.some(k => this.lexicon.corrective.includes(k))) {
  // 用户质疑 → 降低自信度
  confidenceDelta = -0.15;
} else if (signal.keywords.some(k => this.lexicon.affirmative.includes(k))) {
  // 用户确认 → 提升自信度
  confidenceDelta = 0.05;
}
```

### 理论收效

**反馈闭环理论**
- 任何自适应系统都需要反馈循环：感知 → 评估 → 调整
- 质疑/纠正检测是 cog 的"感知"环节——感知用户对 LLM 输出的态度
- 没有这个环节，自信度调整就是开环的，无法响应真实反馈

**社会信号处理**
- 人类对话中，纠正信号（"不对"、"等等"）是重要的元通信
- LLM 默认忽略这些信号（它只处理语义，不处理"对语义的评价"）
- 词典检测让 cog 能感知这些元通信，并做出响应

### 工程收效

| 场景 | 无检测 | 有检测 | 预期改善 |
|------|--------|--------|---------|
| 用户说"不对" | LLM 继续解释原答案 | 降低自信度，重新评估 | 减少对抗 |
| 用户说"检查一下" | LLM 直接输出 | 触发反思模式 | 提高准确性 |
| 用户说"正确" | 无反馈 | 提升自信度 | 强化正确行为 |

### 落地方式

```typescript
// 在 Lexicon 接口中增加新类别
interface Lexicon {
  positive: string[];
  negative: string[];
  boost: string[];
  dampen: string[];
  corrective?: string[];    // 新增
  affirmative?: string[];   // 新增
}
```

向后兼容：`corrective` 和 `affirmative` 为可选字段，不存在时走默认逻辑。

---

## 8. 实施路线图

### 优先级矩阵

| 策略 | 理论收效 | 工程成本 | 风险 | 优先级 |
|------|---------|---------|------|--------|
| Persona 扩展 | 高 | 低 | 低 | **P0** |
| 身份块分层 | 高 | 中 | 低 | **P0** |
| 自信度管理 | 高 | 低 | 中 | **P1** |
| 认知循环 | 高 | 低 | 低 | **P1** |
| 编码契约 | 高 | 低 | 低 | **P1** |
| NAP 增强 | 中 | 中 | 低 | **P2** |
| 词典扩展 | 中 | 低 | 低 | **P2** |

### 阶段划分

**Phase 2.1 — 认知基础设施（P0）**
- Persona 扩展：cognitiveProfile 数据结构 + 文件加载
- 身份块分层注入：L1/L2/L3 生成逻辑 + 适配器更新
- 验证：编译通过 + 现有 50 测试不变

**Phase 2.2 — 抗幻觉核心（P1）**
- 自信度管理：CognitiveState.confidence + advanceState 调整逻辑
- 认知循环：默认 thinkingCycle + L2 注入
- 编码契约：默认 codingContract + 按需触发逻辑
- 验证：新增抗幻觉专项测试

**Phase 2.3 — 增强层（P2）**
- NAP 协议增强：自信度叙事 + 进度追踪
- 词典扩展：corrective/affirmative 类别 + 自信度联动
- 验证：端到端场景测试

---

## 附录：收效评估框架

### 离线评估

```
测试集 A：API 幻觉检测
  注入 10 个已知过时的 API（如 ReactDOM.render、componentWillMount）
  测量 LLM 使用过时 API 的频率

测试集 B：目标漂移检测
  给一个 8 步任务，在第 3 步插入干扰信息
  测量 LLM 是否回到原始任务

测试集 C：自信度校准
  给 20 个问题（10 个 LLM 能正确回答，10 个需要外部知识）
  测量自信度与准确率的相关性
```

### 在线评估

```
指标 1：用户纠正率
  每 session 中用户说"不对""错了"等纠正词的频率
  目标：降低 30%

指标 2：自信度-准确率校准
  自信度高的回答的准确率 vs 自信度低的回答的准确率
  目标：两者正相关（r > 0.5）

指标 3：长任务完成率
  超过 10 轮的任务中，最终输出与初始目标的一致性
  目标：提升 40%
```
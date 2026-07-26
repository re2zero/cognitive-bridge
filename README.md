# cognitive-bridge

> 轻量级认知增强插件：为 AI 助手注入身份认知 + 动态 NAP 叙事锚点。
> 无外部依赖，无需守护进程，纯插件内闭环。
> 支持平台：pi, opencode, omp

## 设计原则

### 1. 零外部依赖
- 不启动 daemon，不连接 Unix socket，不调 RPC
- 所有状态、逻辑、持久化都在插件内完成
- 运行时依赖：仅 Node.js 内置模块（os, fs, path）

### 2. 插件即完整认知系统
- **身份认知**：每次对话前注入人格身份块，保证"我是谁"的连续性
- **情绪感知**：词典匹配识别用户输入的情绪意图，粗放但有效
- **叙事锚点**：基于情绪感知 + 简化状态机，生成动态自然语言叙事，注入到用户消息前
- **仪式感**：首次使用唤醒仪式，设定后人格固化，后续流程一致

### 3. 简单可靠优于复杂精确
- 词典匹配而非小模型推理（无 GPU、无 llama.cpp 依赖）
- 简化状态机（emotion + arousal 两维足够）
- 固定模板 + 动态变量填充，而非神经网络生成
- 失败降级：状态机崩溃时回退到默认人格，不影响主流程

### 4. 跨平台架构
- **核心层**（`src/core.ts`）：平台无关的 CognitiveBridge 类，包含所有认知逻辑
- **适配层**（`src/adapters/`）：各平台通过适配器接入，无需修改核心逻辑
- **存储层**（`src/storage.ts`）：persona.json 持久化，跨平台共享

## 架构

```
┌─────────────────────────────────────────────────┐
│  核心层 (core.ts)                                │
│  ├─ 词典情绪识别 (lexiconIntent)                │
│  ├─ 简化状态机 (advanceState)                    │
│  ├─ NAP 锚点生成 (generateNarrative)            │
│  ├─ 对话窗口 (emotionTrend)                      │
│  ├─ 身份管理 (buildIdentityBlock)                │
│  └─ 仪式流程 (handleCeremony)                    │
└─────────────────┬───────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
┌─────────┐ ┌──────────┐ ┌─────────┐
│ pi 适配  │ │ opencode │ │ omp 适配 │
│ adapters│ │ adapters │ │ adapters│
│  /pi.ts │ │ /opencode│ │  /omp.ts│
└────┬────┘ └────┬─────┘ └────┬────┘
     │           │            │
     ▼           ▼            ▼
  pi hooks   plugin API    MCP server
```

## 平台安装

### pi

```bash
# 1. npm 发布后安装
pi install npm:cognitive-bridge

# 2. 启用插件（settings.json）
# ~/.pi/agent/settings.json
{
  "packages": ["cognitive-bridge"]
}

# 3. 首次使用自动触发唤醒仪式
pi
```

### opencode

```bash
# 1. npm 安装到 opencode 插件目录
cd ~/.config/opencode/plugins
npm install cognitive-bridge

# 2. 启用插件
# ~/.config/opencode/opencode.jsonc
{
  "plugin": ["cognitive-bridge"]
}

# 3. 首次使用自动触发唤醒仪式
opencode
```

### omp

```bash
# 1. 启用 MCP 服务器
# ~/.config/omp/config.json
{
  "mcpServers": {
    "cognitive-bridge": {
      "command": "node",
      "args": ["path/to/cognitive-bridge/dist/adapters/omp.js"]
    }
  }
}

# 2. 首次使用自动触发唤醒仪式
omp
```

## 钩子时序

```
session_start → 加载 persona.json（已存在则跳过仪式）
  │
  ▼
input 钩子
  ├─ 检查 isAwakened
  │   ├─ No  → 仪式流程（命名/创造者/风格）→ handled
  │   └─ Yes → 词典情绪识别 → 推送对话窗口
  │
  ▼
before_agent_start 钩子
  ├─ buildIdentityBlock(persona) → ret.systemPrompt = 块 + event.systemPrompt
  ├─ emotionTrend(window) → 生成叙事锚点 → pendingAnchor
  │
  ▼
context 钩子
  pendingAnchor → prepend 到最新 user message → drain
  │
  ▼
大脑 LLM（看到：系统提示词含身份块 + 最新用户消息含 [NAP+用户输入]）
  │
  ▼
turn_end 钩子
  可选：从回复中提取情绪信号，更新窗口
```

## KV 缓存策略

```
轮1: [ID+NAP协议] + [NAP+U1]
轮2: [ID+NAP协议] + [U1, NAP+U2]
轮3: [ID+NAP协议] + [U1, U2, NAP+U3]
```

- 系统提示词（ID+NAP协议）每轮相同 → KV 前缀稳定
- 历史消息（U1, U2）保持原始 → 前缀一致
- NAP 只注入最新消息 → 从注入点开始重算

## 文件结构

```
cognitive-bridge/
├── src/
│   ├── index.ts           # 插件入口（各平台适配器导出）
│   ├── core.ts            # 核心逻辑（平台无关）
│   ├── types.ts           # 共享类型定义
│   ├── storage.ts         # persona 持久化
│   └── adapters/
│       ├── pi.ts          # pi ExtensionAPI 适配
│       ├── opencode.ts    # opencode plugin 适配
│       └── omp.ts         # omp MCP server 适配
├── config/
│   └── lexicon.json       # 可扩展词典
├── package.json
├── tsconfig.json
└── README.md
```

## 配置

### 词典扩展

```json
// config/lexicon.json
{
  "positive": ["谢谢", "太棒了", "great"],
  "negative": ["崩溃", "出错", "error"],
  "boost": ["非常", "really"],
  "dampen": ["有点", "a bit"]
}
```

### 核心参数

```typescript
interface CognitiveBridgeConfig {
  windowSize?: number;        // 对话窗口容量（默认 8）
  emotionBlendAlpha?: number; // 情绪混合系数（默认 0.3）
  emotionDecay?: number;      // 指数衰减（默认 0.7）
  heavyInputThreshold?: number; // 长输入降级阈值（默认 100 字）
}
```

## 与 Trinity 的关系

| 维度 | Trinity（完整版） | cognitive-bridge（简化版） |
|---|---|---|
| 运行架构 | 守护进程（trinityd）+ 插件 | 纯插件，无外部进程 |
| 情绪识别 | 小模型（Qwen3.5-0.8B） | 词典匹配（正则） |
| 状态机 | 完整 PSI（needs/emotion/modulators） | 两维简化（emotion+arousal） |
| NAP 叙事 | 小模型生成自然叙事 | 固定模板 + 动态变量 |
| 持久化 | SQLite（MindGraph） | 单文件 JSON（persona） |
| 适用场景 | 完整认知系统，需要深度理解 | 轻量增强，快速部署 |

## 测试

```bash
npm test
```

## 路线图

### Phase 1（当前）
- [x] 架构设计
- [x] 核心模块实现
- [x] 三平台适配器
- [x] TypeScript 编译通过

### Phase 2
- [ ] 单元测试覆盖
- [ ] 情绪轨迹可视化（/mood 命令）
- [ ] 词典扩展机制（用户自定义词典）
- [ ] npm 发布

### Phase 3
- [ ] 小模型升级路径（可选：接入 Trinity 小脑）
- [ ] 多会话记忆（跨会话人格延续）
- [ ] 社区词典共享

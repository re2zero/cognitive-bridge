# cog

## 轻量级认知增强插件

为 AI 助手注入身份认知 + 动态 NAP 叙事锚点 + 持久记忆。
基于 SQLite + FTS5，无需守护进程，纯插件内闭环。

**支持平台**：pi, omp（完全兼容 pi）, opencode

## 设计原则

### 1. 轻量依赖

- 不启动 daemon，不连接 Unix socket，不调 RPC
- 所有状态、逻辑、持久化都在插件内完成
- 运行时依赖：Node.js 内置模块 + SQLite（Node 环境 better-sqlite3，Bun 环境 bun:sqlite）

### 2. 插件即完整认知系统

- **身份认知**：每次对话前注入人格身份块，保证"我是谁"的连续性
- **情绪感知**：词典匹配识别用户输入的情绪意图，粗放但有效
- **叙事锚点**：基于情绪感知 + 简化状态机，生成动态自然语言叙事，注入到用户消息前
- **持久记忆**：SQLite + FTS5 全文搜索，跨会话记忆决策/发现/偏好/日记
- **知识图谱**：实体关系三元组，带时间窗口（valid_from/valid_to）
- **冲突检测**：自动检测记忆冲突，支持人工裁决
- **仪式感**：首次使用唤醒仪式，设定后人格固化，后续流程一致

### 3. 简单可靠优于复杂精确

- 词典匹配而非小模型推理（无 GPU、无 llama.cpp 依赖）
- 简化状态机（emotion + arousal 两维足够）
- 固定模板 + 动态变量填充，而非神经网络生成
- 失败降级：状态机崩溃时回退到默认人格，不影响主流程

### 4. 跨平台架构

- **核心层**（`src/core.ts`）：平台无关的 CognitiveBridge 类，包含所有认知逻辑
- **记忆层**（`src/memory.ts`）：MemoryStore 类，SQLite + FTS5，统一入口
- **适配层**（`src/adapters/`）：各平台通过适配器接入，标准工具注册
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
│  ├─ 仪式流程 (handleCeremony)                    │
│  └─ 记忆 API（情绪权重集成）                     │
└─────────────────┬───────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼                           ▼
┌─────────┐               ┌──────────┐
│ pi 适配  │               │ opencode │
│ adapters│               │ adapters │
│  /pi.ts │               │ /opencode│
└────┬────┘               └────┬─────┘
     │                         │
     ▼                         ▼
  pi hooks                plugin API
 (omp 完全兼容 pi)
```

## 安装

### pi / omp

omp 完全兼容 pi，使用相同的钩子系统。两者都可以用插件管理器安装：

```bash
# omp（推荐）
omp plugin install @re2zero/cog

# pi
pi install npm:@re2zero/cog

# 或手动安装到插件目录
cd ~/.omp/plugins && npm install @re2zero/cog
```

安装后重启 omp/pi，首次使用自动触发唤醒仪式。

> **注意**：cog 也可作为扩展放到 `~/.omp/agent/extensions/` 或 `~/.pi/agent/extensions/`（需保留 `src/` 目录结构和 `package.json`）。但推荐使用插件管理器安装，便于版本管理。

### opencode

```bash
# 1. 安装到 opencode 插件目录
opencode plugin @re2zero/cog -g

# 或手动

cd ~/.config/opencode/plugins && npm install @re2zero/cog

# 2. 启用插件
# ~/.config/opencode/opencode.jsonc
{
  "plugin": ["@re2zero/cog"]
}

# 3. 重启 opencode，首次使用自动触发唤醒仪式
opencode
```

## 使用

### 唤醒仪式

首次使用时，助手会提示你按以下格式唤醒：

```
名字 创造者 风格
```

可选风格：温柔但直接、简洁专业、幽默风趣、温暖体贴、理性冷静、活泼开朗

示例：

- `银月 公子 温柔但直接`
- `柳月,公子,简洁专业`
- `小暖 | 公子 | 幽默风趣`

分隔符可以是空格、逗号、竖线。风格可选一个或多个。

设定后人格固化，后续会话自动加载。

### 记忆工具

助手拥有跨会话持久记忆能力，通过标准工具调用：

| 工具 | 说明 |
|---|---|
| `cog_memorize` | 保存记忆（决策/bugfix/发现/模式/偏好） |
| `cog_recall` | 搜索记忆（FTS5 全文搜索） |
| `cog_add_fact` | 添加知识图谱事实（实体关系三元组） |
| `cog_query_facts` | 查询实体事实 |
| `cog_timeline` | 获取实体时间线 |
| `cog_write_diary` | 写会话日记 |
| `cog_read_diary` | 读最近日记 |
| `cog_stats` | 记忆统计 |

**主动使用场景**：

- 完成重要决策后 → `cog_memorize(type=decision)`
- 修复 bug 后 → `cog_memorize(type=bugfix)`
- 发现非显而易见的知识 → `cog_memorize(type=discovery)`
- 建立新的约定或模式 → `cog_memorize(type=pattern)`
- 了解用户偏好 → `cog_memorize(type=preference)`
- 需要回忆过去的决策或经验 → `cog_recall(query=...)`
- 记录实体关系 → `cog_add_fact(subject, predicate, object)`
- 会话结束时写日记 → `cog_write_diary(title, content)`

### CLI 工具

安装后可使用 `cog` 命令行工具：

```bash
cog mood    # 显示当前情绪状态（含可视化量表）
cog status  # 显示人格信息
cog --help  # 显示帮助
```

### 命令

- `/mood` — 查看当前情绪状态和趋势（含可视化报告）
- `/memory` — 查看记忆统计

## 记忆系统

### 存储结构

- **数据库**：`~/.config/cog/cog.db`（SQLite + WAL 模式）
- **人格文件**：`~/.config/cog/persona.json`
- **用户词典**：`~/.config/cog/lexicon.json`（可选，覆盖内置）

### 记忆类型

| 类型 | 说明 |
|---|---|
| `decision` | 架构/设计决策 |
| `bugfix` | Bug 修复记录 |
| `discovery` | 非显而易见的发现 |
| `pattern` | 代码模式/约定 |
| `preference` | 用户偏好 |
| `diary` | 会话日记 |

### 知识图谱

支持实体关系三元组（subject/predicate/object），带时间窗口：

- `valid_from` / `valid_to`：事实有效时间范围
- `confidence`：事实置信度
- `source_memory_id`：关联的记忆来源

### 冲突检测

当使用 `topic_key` 保存记忆时，自动检测与现有记忆的冲突：

- `supersedes`：新记忆取代旧记忆
- `conflicts_with`：存在冲突，需人工裁决
- `compatible`：兼容，可同时存在
- `related`：相关但不冲突
- `scoped`：作用域不同
- `not_conflict`：无冲突

### 去重

使用 SHA-256 对记忆内容哈希，自动跳过重复内容。

### 会话管理

- 每次启动创建新会话
- 追踪会话统计：消息数、记忆数、事实数、日记数

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
  pendingAnchor → prependStateToUserContent → 注入到最新 user message
  ├─ content 为 string：`<cognitive_state>...</cognitive_state>\n\n${text}`
  └─ content 为 array：保留 block 结构，注入到首个 text block
  注意：必须保留 array 格式，否则原始消息丢失 + TUI 渲染异常
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
cog/
├── src/
│   ├── index.ts           # 插件入口（pi + opencode 导出）
│   ├── core.ts            # 核心逻辑（平台无关）
│   ├── memory.ts          # 记忆系统（SQLite + FTS5）
│   ├── types.ts           # 共享类型定义
│   ├── storage.ts         # persona 持久化 + 词典加载
│   ├── mood.ts            # /mood 命令报告生成
│   ├── cli.ts             # CLI 工具入口
│   └── adapters/
│       ├── pi.ts          # pi ExtensionAPI 适配（omp 兼容）
│       └── opencode.ts    # opencode plugin 适配
├── config/
│   └── lexicon.json       # 内置词典
├── tests/
│   ├── core.test.ts       # 核心逻辑测试
│   ├── memory.test.ts     # 记忆系统测试
│   └── storage.test.ts    # 存储层测试
├── docs/
│   ├── memory-system-design.md
│   └── cognitive-enhancement-v2.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## 配置

### 词典扩展

内置词典包含以下字段：

```json
// config/lexicon.json
{
  "positive": ["谢谢", "太棒了", "great"],
  "negative": ["崩溃", "出错", "error"],
  "boost": ["非常", "really"],
  "dampen": ["有点", "a bit"],
  "corrective": ["不对", "错了", "wrong"],
  "affirmative": ["对", "正确", "yes"]
}
```

用户自定义词典（优先级更高）：

```bash
mkdir -p ~/.config/cog
cat > ~/.config/cog/lexicon.json << 'EOF'
{
  "positive": ["你的词"],
  "negative": ["你的词"]
}
EOF
```

加载优先级：默认内置 → 外部文件（内置 config/ + 用户 ~/.config/cog/） → 编程配置

### 核心参数

```typescript
interface CogConfig {
  windowSize?: number;        // 对话窗口容量（默认 8）
  emotionBlendAlpha?: number; // 情绪混合系数（默认 0.3）
  emotionDecay?: number;      // 指数衰减（默认 0.7）
  heavyInputThreshold?: number; // 长输入降级阈值（默认 100 字）
  lexicon?: Lexicon;          // 编程方式覆盖词典
}
```

## 测试

```bash
npm test          # 运行所有测试
npm run test:watch # 监听模式
```

测试覆盖：

- 核心逻辑（情绪识别、状态机、叙事生成、仪式流程）
- 记忆系统（CRUD、FTS5 搜索、知识图谱、冲突检测、会话管理）
- 存储层（persona 持久化、词典加载）

## 路线图

### Phase 1（已完成）

- [x] 架构设计
- [x] 核心模块实现
- [x] 平台适配器（pi + opencode）
- [x] TypeScript 编译通过

### Phase 2（已完成）

- [x] 单元测试覆盖（95+ tests）
- [x] 情绪轨迹可视化（/mood 命令）
- [x] 词典扩展机制（用户自定义词典）
- [x] 持久记忆系统（SQLite + FTS5）
- [x] 知识图谱（实体关系三元组）
- [x] 标准工具注册（pi.registerTool + opencode tool API）
- [x] npm 发布准备
- [x] CLI 工具（cog mood / cog status）
- [x] 冲突检测系统
- [x] 会话管理
- [x] 记忆去重（SHA-256）

### Phase 3（进行中）

- [ ] 小模型升级路径（可选：接入外部推理服务）
- [ ] 记忆冲突自动解决策略优化
- [ ] 社区词典共享

/**
 * 平台无关的核心类型定义。
 * 
 * 各平台适配器实现这些接口，核心逻辑不依赖任何平台 API。
 */

// ── 身份 ──

export interface Persona {
  name: string;       // 助手名字（如 "银月"）
  creator: string;    // 创造者名字（如 "公子"）
  style: string;      // 对话风格（如 "温柔但直接"）
  createdAt: string;  // 觉醒时间（ISO 8601）
}

// ── 情绪 ──

export interface EmotionSignal {
  emotion: number;     // [-1.0, 1.0]，正值=正面，负值=负面
  intensity: number;   // [0, 1]，情绪强度
  keywords: string[];  // 匹配到的关键词
}

// ── 词典 ──

export interface Lexicon {
  positive: string[];
  negative: string[];
  boost: string[];      // 强化词（"非常"、"真的"）
  dampen: string[];     // 弱化词（"有点"、"稍微"）
}

// ── 认知状态 ──

export interface CognitiveState {
  emotion: number;      // [-1.0, 1.0]，当前情绪效价
  arousal: number;      // [0, 1]，当前激活度
  cycle: number;        // 对话轮次
  lastUpdate: number;   // 最后更新时间戳
}

// ── 对话窗口 ──

export interface WindowEntry {
  emotion: number;  // [-1.0, 1.0]
  cycle: number;    // 对话轮次
}

// ── 仪式 ──

export interface CeremonyState {
  step: 'name' | 'creator' | 'style' | 'done';
  data: Partial<Persona>;
}

// ── 插件事件（平台无关）──

export interface PluginEvent {
  text?: string;        // 用户输入
  messages?: any[];     // 消息历史（平台特定结构）
  source?: string;      // 消息来源（interactive/extension）
  message?: any;        // LLM 回复（turn_end）
}

// ── 插件返回值 ──

export interface PluginResult {
  action?: 'continue' | 'handled' | 'transform';
  messages?: any[];     // 修改后的消息列表
  systemPrompt?: string; // 注入到系统提示词
}

// ── 平台适配器接口 ──

export interface PlatformAdapter {
  name: string;         // 平台名称（'pi' | 'opencode'）
  
  // 钩子注册
  onInput(handler: (event: PluginEvent) => Promise<PluginResult>): void;
  onBeforeAgentStart(handler: (event: PluginEvent) => Promise<PluginResult>): void;
  onContext(handler: (event: PluginEvent) => Promise<PluginResult>): void;
  onTurnEnd(handler: (event: PluginEvent) => Promise<void>): void;
  
  // UI 显示
  notify(message: string, level?: 'info' | 'warning' | 'error'): void;
  
  // 会话信息
  getSessionId?(): string;
}

// ── 配置 ──

export interface CogConfig {
  windowSize?: number;
  emotionBlendAlpha?: number;
  emotionDecay?: number;
  heavyInputThreshold?: number;
  lexicon?: Lexicon;
}

// ── opencode 插件接口 ──

export interface OpencodePlugin {
  name: string;
  onUserMessage?: (message: string) => Promise<{ text?: string } | null>;
  onAssistantMessage?: (message: string) => Promise<{ text?: string } | null>;
  onTurnEnd?: () => Promise<void>;
}


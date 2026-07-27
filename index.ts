/**
 * cog：轻量级认知增强插件
 * 
 * 为 AI 助手注入身份认知 + 动态 NAP 叙事锚点 + 持久记忆。
 * 无外部依赖（除 better-sqlite3），无需守护进程，纯插件内闭环。
 * 
 * 支持平台：pi（含 omp，完全兼容 pi）, opencode
 */
import { CognitiveBridge } from './core.js';
import { loadPersona } from './storage.js';
import { registerPiExtension } from './adapters/pi.js';
import { CogPlugin, createOpencodeCog } from './adapters/opencode.js';

export { CognitiveBridge } from './core.js';
export type { Persona, EmotionSignal, CognitiveState } from './types.js';
export { loadPersona, savePersona } from './storage.js';
export { CogPlugin } from './adapters/opencode.js';

// ── pi 适配入口 ──

export default function piCog(pi: any) {
  const bridge = new CognitiveBridge();
  const existingPersona = loadPersona();
  if (existingPersona) {
    bridge.setPersona(existingPersona);
  }
  registerPiExtension(pi, bridge);
}

// ── opencode 适配入口（标准插件）──

export { CogPlugin as defaultOpencodePlugin };

// ── opencode 适配入口（向后兼容）──

export { createOpencodeCog };

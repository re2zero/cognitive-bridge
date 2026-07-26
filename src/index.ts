/**
 * cognitive-bridge：轻量级认知增强插件
 * 
 * 为 AI 助手注入身份认知 + 动态 NAP 叙事锚点。
 * 无外部依赖，无需守护进程，纯插件内闭环。
 * 
 * 支持平台：pi（含 omp，完全兼容 pi）, opencode
 */
import { CognitiveBridge } from './core.js';
import { loadPersona } from './storage.js';
import { registerPiExtension } from './adapters/pi.js';
import { createOpencodePlugin } from './adapters/opencode.js';

export { CognitiveBridge } from './core.js';
export type { Persona, EmotionSignal, CognitiveState } from './types.js';
export { loadPersona, savePersona } from './storage.js';

// ── pi 适配入口 ──

export default function piCognitiveBridge(pi: any) {
  const bridge = new CognitiveBridge();
  const existingPersona = loadPersona();
  if (existingPersona) {
    bridge.setPersona(existingPersona);
  }
  registerPiExtension(pi, bridge);
}

// ── opencode 适配入口 ──

export function createOpencodeCognitiveBridge() {
  const bridge = new CognitiveBridge();
  const existingPersona = loadPersona();
  if (existingPersona) {
    bridge.setPersona(existingPersona);
  }
  return createOpencodePlugin(bridge);
}

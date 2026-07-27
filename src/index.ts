/**
 * cog：轻量级认知增强插件
 * 
 * 为 AI 助手注入身份认知 + 动态 NAP 叙事锚点 + 持久记忆。
 * 无外部依赖（除 better-sqlite3），无需守护进程，纯插件内闭环。
 * 
 * 支持平台：pi（含 omp，完全兼容 pi）, opencode
 * 
 * 防重复加载：OMP 同时有 Pi 扩展系统和 OpenCode 插件系统，
 * 此模块通过单例确保只在一个系统中注册。
 */
import { CognitiveBridge } from './core.js';
import { loadPersona } from './storage.js';
import { registerPiExtension } from './adapters/pi.js';
import { tryInit } from './singleton.js';

export { CognitiveBridge } from './core.js';
export type { Persona, EmotionSignal, CognitiveState } from './types.js';
export { loadPersona, savePersona } from './storage.js';

// ── pi 适配入口（默认导出）──

export default function piCog(pi: any) {
  if (!tryInit('pi-extension')) return;

  const bridge = new CognitiveBridge();
  const existingPersona = loadPersona();
  if (existingPersona) {
    bridge.setPersona(existingPersona);
  }
  registerPiExtension(pi, bridge);
}

// ── opencode 适配入口（懒加载，避免 pi 环境报错）──

let _opencodeModule: typeof import('./adapters/opencode.js') | null = null;

async function loadOpencodeAdapter() {
  if (!_opencodeModule) {
    _opencodeModule = await import('./adapters/opencode.js');
  }
  return _opencodeModule;
}

export const CogPlugin = new Proxy({}, {
  get(_, prop) {
    throw new Error(
      'CogPlugin requires @opencode-ai/plugin. ' +
      'Use dynamic import: const { CogPlugin } = await import("@re2zero/cog")'
    );
  }
});

export const createOpencodeCog = async () => {
  if (!tryInit('opencode-plugin')) {
    // 返回空插件，避免双重注册
    return {
      name: 'cog',
      tool: {},
      event: async () => {},
      'chat.message': async (input: any, output: any) => {}
    };
  }
  const mod = await loadOpencodeAdapter();
  return mod.createOpencodeCog();
};

export const defaultOpencodePlugin = CogPlugin;

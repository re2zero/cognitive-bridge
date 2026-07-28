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
 * 
 * 注意：opencode 把所有导出都当作插件，所以这里只导出插件函数。
 * pi 通过 pi.extensions 加载，使用 initPiExtension(pi)
 */
import { createRequire } from 'module';
import { CognitiveBridge } from './core.js';
import { loadPersona } from './storage.js';
import { registerPiExtension } from './adapters/pi.js';
import { tryInit } from './singleton.js';

// pi 需要的导出（通过命名导入使用）
export { CognitiveBridge } from './core.js';
export type { Persona, EmotionSignal, CognitiveState } from './types.js';
export { loadPersona, savePersona } from './storage.js';

const LOG_TAG = '[cog]';
const require = createRequire(import.meta.url);

// ── 环境检测 ──

function detectEnvironment(): 'pi' | 'opencode' | 'unknown' {
  const env = process?.env || {};

  // 1. 环境变量检测（最可靠）
  // pi 设置 PI_CODING_AGENT=true，OMP 可能设置 OMP_VERSION
  if (env.PI_CODING_AGENT || env.OMP_VERSION) {
    return 'pi';  // OMP 优先使用 Pi 扩展（更完整的 API）
  }
  if (env.OPENCODE_VERSION) {
    return 'opencode';
  }

  // 2. 运行时特性检测（全局 pi API）
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as any)?.pi?.registerTool) {
      return 'pi';
    }
  } catch {
    // ignore
  }

  // 3. 模块依赖检测
  try {
    if (typeof require !== 'undefined') {
      const paths = [
        require.resolve('@opencode-ai/plugin'),
        require.resolve('@opencode-ai/plugin/package.json')
      ];
      for (const p of paths) {
        try {
          require(p);
          return 'opencode';
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return 'unknown';
}

// ── pi 适配器入口 ──

/**
 * Pi 扩展入口。可直接调用，也支持通过 autoInit(pi) 调用。
 * @param pi - Pi Extension API 对象
 */
export async function initPiExtension(pi: any): Promise<void> {
  if (!tryInit('pi-extension')) return;

  const bridge = new CognitiveBridge();
  const existingPersona = loadPersona();
  if (existingPersona) {
    bridge.setPersona(existingPersona);
  }

  // 懒加载 pi 适配器
  const { registerPiExtension } = await import('./adapters/pi.js');
  registerPiExtension(pi, bridge);
}

// ── opencode 适配器入口 ──

/**
 * OpenCode 插件入口。返回一个插件函数。
 */
export async function initOpencodePlugin(ctx: any): Promise<any> {
  if (!tryInit('opencode-plugin')) {
    return {
      name: 'cog',
      tool: {},
      event: async () => {},
      'chat.message': async (input: any, output: any) => {}
    };
  }

  try {
    const mod = await import('./adapters/opencode.js');
    return mod.CogPlugin(ctx);
  } catch {
    console.error(`${LOG_TAG} Failed to load opencode adapter, returning empty plugin`);
    return {
      name: 'cog',
      tool: {},
      event: async () => {},
      'chat.message': async (input: any, output: any) => {}
    };
  }
}

// ── 自动初始化入口 ──

/**
 * 自动检测环境并初始化。
 * 
 * 用法：
 * // pi 环境
 * import { autoInit } from '@re2zero/cog';
 * await autoInit(pi);
 * 
 * // opencode 环境
 * import { autoInit } from '@re2zero/cog';
 * const plugin = await autoInit(ctx);
 */
export async function autoInit(apiOrCtx?: any): Promise<any> {
  const env = detectEnvironment();
  console.error(`${LOG_TAG} Detected environment: ${env}`);

  switch (env) {
    case 'pi':
      if (!apiOrCtx) {
        console.error(`${LOG_TAG} Pi environment detected but no API provided`);
        return;
      }
      await initPiExtension(apiOrCtx);
      return;

    case 'opencode':
      return await initOpencodePlugin(apiOrCtx);

    case 'unknown':
    default:
      console.error(`${LOG_TAG} Unknown environment, attempting pi first...`);
      if (apiOrCtx?.registerTool) {
        await initPiExtension(apiOrCtx);
        return;
      }
      return await initOpencodePlugin(apiOrCtx);
  }
}

// ── 默认导出：pi 扩展工厂 ──

/**
 * 默认导出：pi 扩展入口。
 *
 * pi 加载 dist/index.js（通过 package.json 的 pi.extensions），
 * 调用 default export 并传入 ExtensionAPI。
 *
 * 使用 autoInit 自动检测环境：
 * - pi/OMP 环境 → initPiExtension(pi)
 * - opencode 环境 → initOpencodePlugin(ctx)
 * - 检测失败时根据 API 形状回退
 */
export default autoInit;

// ── 向后兼容导出 ──

/** @deprecated 请使用 initPiExtension(pi) 或 autoInit(pi) */
export function piCog(pi: any) {
  if (!tryInit('pi-extension')) return;

  const bridge = new CognitiveBridge();
  const existingPersona = loadPersona();
  if (existingPersona) {
    bridge.setPersona(existingPersona);
  }
  registerPiExtension(pi, bridge);
}

type OpencodeAdapter = typeof import('./adapters/opencode.js');
let _opencodeModule: OpencodeAdapter | null = null;

async function loadOpencodeAdapter(): Promise<OpencodeAdapter> {
  if (!_opencodeModule) {
    try {
      _opencodeModule = await import('./adapters/opencode.js');
    } catch {
      _opencodeModule = null as any;
    }
  }
  return _opencodeModule!;
}

/** @deprecated 请使用 initOpencodePlugin(ctx) 或 autoInit(ctx) */
export const CogPlugin: any = async (ctx: any) => {
  const mod = await loadOpencodeAdapter();
  if (!mod) {
    return { tool: {}, event: async () => {}, 'chat.message': async () => {} };
  }
  return mod.CogPlugin(ctx);
};

/** @deprecated 请使用 initOpencodePlugin(ctx) */
export const defaultOpencodePlugin = CogPlugin;

/** @deprecated 请使用 initOpencodePlugin(ctx) */
export const createOpencodeCog = async () => {
  if (!tryInit('opencode-plugin')) {
    return {
      name: 'cog',
      tool: {},
      event: async () => {},
      'chat.message': async (input: any, output: any) => {}
    };
  }
  const mod = await loadOpencodeAdapter();
  return mod?.CogPlugin || CogPlugin;
};

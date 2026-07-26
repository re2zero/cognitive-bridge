/**
 * pi 适配器：将 CognitiveBridge 接入 pi 的 ExtensionAPI。
 * 
 * 使用 pi 的钩子系统：input, before_agent_start, context, turn_end。
 */
import type { Persona } from '../types.js';
import { CognitiveBridge } from '../core.js';
import { loadPersona, savePersona } from '../storage.js';

// ── pi 扩展 API 类型（简化声明）──

interface PiExtensionAPI {
  on(event: string, handler: Function): void;
}

interface PiEvent {
  text?: string;
  messages?: any[];
  source?: string;
  message?: any;
  systemPrompt?: string;
}

interface PiContext {
  sessionManager?: {
    getSessionId?(): string;
  };
  ui?: {
    notify?(message: string, level?: string): void;
  };
}

// ── 适配器实现 ──

export function registerPiExtension(pi: PiExtensionAPI, bridge: CognitiveBridge): void {
  const LOG_TAG = '[cognitive-bridge:pi]';
  let pendingAnchor: string | null = null;

  // ── session_start：加载 persona ──
  pi.on('session_start', (_event: any, _ctx: any) => {
    if (!bridge.awakened) {
      const p = loadPersona();
      if (p) {
        bridge.setPersona(p);
        console.error(`${LOG_TAG} Persona loaded: ${p.name}`);
      }
    }
    console.error(`${LOG_TAG} Session started. Awakened: ${bridge.awakened}`);
  });

  // ── input：仪式检查 / 情绪识别 ──
  pi.on('input', async (event: PiEvent, ctx: PiContext) => {
    if (event?.source === 'extension') return { action: 'continue' };
    const text = event?.text || '';

    // 觉醒仪式
    if (bridge.needsCeremony()) {
      const result = bridge.handleCeremony(text);
      if (result.completed) savePersona(result.completed);
      ctx?.ui?.notify?.(result.response, 'info');
      return { action: 'handled' };
    }

    // 正常流程：情绪识别
    const signal = bridge.lexiconIntent(text);
    bridge.advanceState(signal);
    const trend = bridge.emotionTrend();
    console.error(
      `${LOG_TAG} Turn ${bridge.currentState.cycle}: ` +
      `emotion=${signal.emotion.toFixed(2)}, ` +
      `intensity=${signal.intensity.toFixed(2)}, ` +
      `trend=${trend.toFixed(2)}, ` +
      `keywords=[${signal.keywords.join(',')}]`
    );

    return { action: 'continue' };
  });

  // ── before_agent_start：注入身份 + 设置 NAP 锚点 ──
  pi.on('before_agent_start', async (event: PiEvent, _ctx: PiContext) => {
    const ret: any = {};

    // 身份注入
    if (bridge.awakened) {
      const identityBlock = bridge.buildIdentityBlock();
      ret.systemPrompt = identityBlock + '\n\n' + (event.systemPrompt || '');
    }

    // NAP 锚点
    if (bridge.currentState.cycle > 0) {
      const narrative = bridge.generateNarrative();
      pendingAnchor = narrative;
    }

    return Object.keys(ret).length > 0 ? ret : undefined;
  });

  // ── context：prepend 锚点到最新用户消息 ──
  pi.on('context', async (event: PiEvent, _ctx: PiContext) => {
    if (pendingAnchor === null) return undefined;
    const anchor = pendingAnchor;
    pendingAnchor = null;

    const messages = event.messages;
    if (!Array.isArray(messages)) return undefined;

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'user') {
        const content = typeof m.content === 'string' ? m.content : '';
        messages[i] = {
          ...m,
          content: `[认知状态]\n${anchor}\n[/认知状态]\n\n${content}`
        };
        return { messages };
      }
    }
    return undefined;
  });

  // ── turn_end：记录完成 ──
  pi.on('turn_end', async (event: PiEvent) => {
    console.error(`${LOG_TAG} Turn ${bridge.currentState.cycle} complete`);
  });

  console.error(`${LOG_TAG} Extension loaded. Awakened: ${bridge.awakened}`);
}

/**
 * opencode 适配器：将 CognitiveBridge 接入 opencode 的插件系统。
 * 
 * opencode 使用 plugins/ 目录，插件是 TypeScript 文件。
 * 参考：~/.config/opencode/plugins/tsca_opencode.ts
 */
import type { OpencodePlugin } from '../types.js';
import { CognitiveBridge } from '../core.js';

// ── 适配器实现 ──

export function createOpencodePlugin(bridge: CognitiveBridge): OpencodePlugin {
  const LOG_TAG = '[cognitive-bridge:opencode]';

  return {
    name: 'cognitive-bridge',

    async onUserMessage(message: string) {
      // 仪式检查
      if (bridge.needsCeremony()) {
        const result = bridge.handleCeremony(message);
        return { text: result.response };
      }

      // 情绪识别
      const signal = bridge.lexiconIntent(message);
      bridge.advanceState(signal);

      const trend = bridge.emotionTrend();
      console.error(
        `${LOG_TAG} Turn ${bridge.currentState.cycle}: ` +
        `emotion=${signal.emotion.toFixed(2)}, ` +
        `trend=${trend.toFixed(2)}`
      );

      // 生成叙事锚点
      const narrative = bridge.generateNarrative();

      return {
        text: `[认知状态]\n${narrative}\n[/认知状态]\n\n${message}`
      };
    },

    async onAssistantMessage(message: string) {
      // 可选：分析助手回复的情绪
      // 目前保持简单
      return null;
    },

    async onTurnEnd() {
      console.error(`${LOG_TAG} Turn ${bridge.currentState.cycle} complete`);
    }
  };
}

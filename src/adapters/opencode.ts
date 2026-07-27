/**
 * opencode 适配器：将 CognitiveBridge 接入 opencode 的插件系统。
 * 
 * opencode 使用 plugins/ 目录，插件是 TypeScript 文件。
 * 参考：~/.config/opencode/plugins/tsca_opencode.ts
 */
import type { OpencodePlugin } from '../types.js';
import { CognitiveBridge } from '../core.js';
import { buildMoodReport } from '../mood.js';
// ── 适配器实现 ──

export function createOpencodePlugin(bridge: CognitiveBridge): OpencodePlugin {
  const LOG_TAG = '[cog:opencode]';
  let isCodingSession = false;

  return {
    name: 'cog',

    async onUserMessage(message: string) {
      // 仪式检查
      if (bridge.needsCeremony()) {
        const result = bridge.handleCeremony(message);
        return { text: result.response };
      }

      // /mood 命令
      if (message.trim().toLowerCase() === '/mood') {
        const state = bridge.currentState;
        const trend = bridge.emotionTrend();
        const report = buildMoodReport(state, trend, bridge.currentPersona);
        return { text: report };
      }

      // 编码任务检测
      if (bridge.isCodingTask(message)) {
        isCodingSession = true;
      } else if (isCodingSession && bridge.currentState.cycle > 10) {
        isCodingSession = false;
      }

      // 情绪识别 + 反馈检测
      const signal = bridge.lexiconIntent(message);
      const feedback = bridge.detectFeedback(message);
      bridge.advanceState(signal, feedback);
      const trend = bridge.emotionTrend();
      console.error(
        `${LOG_TAG} Turn ${bridge.currentState.cycle}: ` +
        `emotion=${signal.emotion.toFixed(2)}, ` +
        `trend=${trend.toFixed(2)}`
      );

      // 生成叙事锚点 + 身份注入
      const narrative = bridge.generateNarrative();
      const layer = bridge.currentState.cycle <= 1 ? 'full' : 'core';
      let identityBlock = bridge.buildIdentityBlock(layer);
      if (isCodingSession) {
        identityBlock += '\n\n' + bridge.buildIdentityBlock('coding');
      }

      return {
        text: `${identityBlock}\n\n[认知状态]\n${narrative}\n[/认知状态]\n\n${message}`
      };
    },

    async onAssistantMessage(message: string) {
      return null;
    },

    async onTurnEnd() {
      console.error(`${LOG_TAG} Turn ${bridge.currentState.cycle} complete`);
    }
  };
}

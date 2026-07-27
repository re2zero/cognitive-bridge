/**
 * /mood 命令：情绪状态报告生成
 * 平台无关，各适配器共享
 */
import type { CognitiveState, Persona } from './types.js';

function emotionLabel(emotion: number): string {
  if (emotion > 0.7) return '😊 非常积极';
  if (emotion > 0.3) return '🙂 积极';
  if (emotion > -0.3) return '😐 中性';
  if (emotion > -0.7) return '😟 消极';
  return '😰 非常消极';
}

function arousalLabel(arousal: number): string {
  if (arousal > 0.7) return '高唤醒（兴奋/紧张）';
  if (arousal > 0.3) return '中等唤醒';
  return '低唤醒（平静/疲倦）';
}

function formatBar(value: number, min: number, max: number, width: number, marker: string): string {
  const range = max - min;
  const normalized = (value - min) / range;
  const pos = Math.round(normalized * (width - 1));
  const clamped = Math.max(0, Math.min(width - 1, pos));
  const bar: string[] = [];
  for (let i = 0; i < width; i++) {
    if (i === clamped) {
      bar.push(marker);
    } else {
      bar.push('·');
    }
  }
  return bar.join('');
}

function trendArrow(trend: number): string {
  if (trend > 0.05) return '↗ 上升';
  if (trend < -0.05) return '↘ 下降';
  return '→ 平稳';
}

export function buildMoodReport(state: CognitiveState, trend: number, persona: Persona | null): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════╗');
  lines.push('║        🧠 认知状态报告               ║');
  lines.push('╚══════════════════════════════════════╝');
  lines.push('');

  if (persona) {
    lines.push(`  身份：${persona.name}`);
    lines.push(`  创造者：${persona.creator}`);
    lines.push('');
  }

  lines.push(`  📊 情绪：${emotionLabel(state.emotion)}`);
  lines.push(`     数值：${state.emotion.toFixed(3)}`);
  lines.push(`     量表：[${formatBar(state.emotion, -1, 1, 21, '◆')}]`);
  lines.push('');

  lines.push(`  ⚡ 唤醒：${arousalLabel(state.arousal)}`);
  lines.push(`     数值：${state.arousal.toFixed(3)}`);
  lines.push(`     量表：[${formatBar(state.arousal, 0, 1, 21, '●')}]`);
  lines.push('');

  lines.push(`  📈 趋势：${trend.toFixed(3)} ${trendArrow(trend)}`);
  lines.push(`  🔄 轮次：${state.cycle}`);
  lines.push('');

  // 情绪-唤醒度 二维映射
  lines.push('  情绪-唤醒度映射：');
  const grid: string[][] = Array.from({ length: 5 }, () => Array(9).fill('·'));
  const col = Math.round(((state.emotion + 1) / 2) * 8);
  const row = Math.round((1 - state.arousal) * 4);
  grid[Math.max(0, Math.min(4, row))][Math.max(0, Math.min(8, col))] = '◆';
  for (const r of grid) {
    lines.push('    ' + r.join(' '));
  }
  lines.push('   低唤醒 ←──────────→ 高唤醒');
  lines.push('   消极   ←──────────→ 积极');

  return lines.join('\n');
}
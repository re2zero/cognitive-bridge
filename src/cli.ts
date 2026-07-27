/**
 * CLI 入口：cog 命令行工具
 *
 * 用法：
 *   cog mood    显示当前情绪状态
 *   cog status  显示人格信息
 *   cog --help  显示帮助
 */
import { loadPersona } from './storage.js';
import { CognitiveBridge } from './core.js';

function formatMoodBar(value: number, min: number, max: number, width: number): string {
  const range = max - min;
  const normalized = (value - min) / range; // [0, 1]
  const pos = Math.round(normalized * (width - 1));
  const bar: string[] = [];
  for (let i = 0; i < width; i++) {
    if (i === pos) {
      bar.push('◆');
    } else if (i < width / 3) {
      bar.push('─');
    } else if (i < width * 2 / 3) {
      bar.push('─');
    } else {
      bar.push('─');
    }
  }
  return bar.join('');
}

function formatArousalBar(value: number, width: number): string {
  const pos = Math.round(value * (width - 1));
  const bar: string[] = [];
  for (let i = 0; i < width; i++) {
    if (i === pos) {
      bar.push('●');
    } else {
      bar.push('·');
    }
  }
  return bar.join('');
}

function emotionLabel(emotion: number): string {
  if (emotion > 0.7) return '非常积极';
  if (emotion > 0.3) return '积极';
  if (emotion > -0.3) return '中性';
  if (emotion > -0.7) return '消极';
  return '非常消极';
}

function arousalLabel(arousal: number): string {
  if (arousal > 0.7) return '高唤醒';
  if (arousal > 0.3) return '中等唤醒';
  return '低唤醒';
}

function showMood(): void {
  const persona = loadPersona();
  const bridge = new CognitiveBridge();
  if (persona) bridge.setPersona(persona);

  const state = bridge.currentState;
  const trend = bridge.emotionTrend();

  const lines: string[] = [];

  // 头部
  lines.push('╔══════════════════════════════════╗');
  lines.push('║      🧠 认知状态报告              ║');
  lines.push('╚══════════════════════════════════╝');
  lines.push('');

  // 人格信息
  if (persona) {
    lines.push(`  身份：${persona.name}`);
    lines.push(`  创造者：${persona.creator}`);
    lines.push(`  风格：${persona.style}`);
    lines.push(`  觉醒于：${new Date(persona.createdAt).toLocaleString()}`);
  } else {
    lines.push('  身份：未觉醒');
  }
  lines.push('');

  // 情绪
  const emoji = state.emotion > 0.3 ? '😊' : state.emotion < -0.3 ? '😟' : '😐';
  lines.push(`  情绪：${emoji}  ${emotionLabel(state.emotion)}`);
  lines.push(`  数值：${state.emotion.toFixed(3)}`);
  lines.push(`  量表：[${formatMoodBar(state.emotion, -1, 1, 21)}]`);
  lines.push('');

  // 唤醒度
  lines.push(`  唤醒：${arousalLabel(state.arousal)}`);
  lines.push(`  数值：${state.arousal.toFixed(3)}`);
  lines.push(`  量表：[${formatArousalBar(state.arousal, 21)}]`);
  lines.push('');

  // 趋势
  lines.push(`  趋势：${trend.toFixed(3)} ${trend > 0.1 ? '↗ 上升' : trend < -0.1 ? '↘ 下降' : '→ 平稳'}`);
  lines.push(`  轮次：${state.cycle}`);
  lines.push('');

  // 情绪-唤醒度 二维映射
  lines.push('  情绪-唤醒度映射：');
  const grid: string[][] = Array.from({ length: 5 }, () => Array(9).fill('·'));
  const col = Math.round(((state.emotion + 1) / 2) * 8);
  const row = Math.round((1 - state.arousal) * 4);
  grid[row][col] = '◆';
  for (const r of grid) {
    lines.push('    ' + r.join(' '));
  }
  lines.push('   低唤醒←──────────→高唤醒');
  lines.push('   消极←──────────→积极');
  lines.push('');

  // NAP 叙事
  const narrative = bridge.generateNarrative();
  lines.push(`  叙事锚点：${narrative}`);

  console.log(lines.join('\n'));
}

function showStatus(): void {
  const persona = loadPersona();
  if (!persona) {
    console.log('未检测到人格数据。请先完成觉醒仪式。');
    return;
  }

  const lines: string[] = [];
  lines.push('╔══════════════════════════════════╗');
  lines.push('║      人格档案                     ║');
  lines.push('╚══════════════════════════════════╝');
  lines.push('');
  lines.push(`  名称：${persona.name}`);
  lines.push(`  创造者：${persona.creator}`);
  lines.push(`  对话风格：${persona.style}`);
  lines.push(`  觉醒时间：${new Date(persona.createdAt).toLocaleString()}`);
  lines.push('');
  lines.push(`  配置文件：~/.config/cog/persona.json`);

  console.log(lines.join('\n'));
}

function showHelp(): void {
  console.log(`
用法: cog <command>

命令:
  mood     显示当前情绪状态和认知报告
  status   显示人格档案信息
  --help   显示此帮助信息

示例:
  cog mood    查看情绪状态
  cog status  查看人格信息
`);
}

const cmd = process.argv[2];
switch (cmd) {
  case 'mood':
    showMood();
    break;
  case 'status':
    showStatus();
    break;
  case '--help':
  case '-h':
  case undefined:
    showHelp();
    break;
  default:
    console.error(`未知命令: ${cmd}`);
    showHelp();
    process.exit(1);
}
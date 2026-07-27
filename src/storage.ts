/**
 * 持久化：persona.json 的读写 + 词典加载。
 * 平台无关，各适配器调用。
 */
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Persona, Lexicon } from './types.js';

const CONFIG_DIR = join(homedir(), '.config', 'cog');
const PERSONA_FILE = join(CONFIG_DIR, 'persona.json');
const USER_LEXICON_FILE = join(CONFIG_DIR, 'lexicon.json');

// 插件自带的 config/ 目录（相对于 dist/storage.js → ../config/）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUILTIN_LEXICON_FILE = resolve(__dirname, '..', 'config', 'lexicon.json');

/**
 * 从指定路径加载词典 JSON 文件。
 * 文件不存在或格式无效时返回 null。
 */
function loadLexiconFile(filePath: string): Lexicon | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Lexicon;
    if (Array.isArray(parsed.positive) && Array.isArray(parsed.negative)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 合并两个词典：target 为基础，source 的条目追加到对应类别。
 * 自动去重（保留 target 顺序，source 中不重复的追加到末尾）。
 */
export function mergeLexicon(target: Lexicon, source: Lexicon): Lexicon {
  const dedupAppend = (base: string[], extra: string[]): string[] => {
    const seen = new Set(base.map(w => w.toLowerCase()));
    const result = [...base];
    for (const w of extra) {
      if (!seen.has(w.toLowerCase())) {
        result.push(w);
        seen.add(w.toLowerCase());
      }
    }
    return result;
  };

  return {
    positive: dedupAppend(target.positive || [], source.positive || []),
    negative: dedupAppend(target.negative || [], source.negative || []),
    boost: dedupAppend(target.boost || [], source.boost || []),
    dampen: dedupAppend(target.dampen || [], source.dampen || []),
    corrective: dedupAppend(target.corrective || [], source.corrective || []),
    affirmative: dedupAppend(target.affirmative || [], source.affirmative || []),
  };
}

/**
 * 加载词典，按优先级合并：
 * 1. 插件自带的 config/lexicon.json（内置扩展）
 * 2. 用户 ~/.config/cog/lexicon.json（用户自定义）
 * 
 * 返回合并后的词典，若两者都不存在则返回 null。
 * 调用方应以此覆盖默认词典。
 */
export function loadLexicon(): Lexicon | null {
  const builtin = loadLexiconFile(BUILTIN_LEXICON_FILE);
  const user = loadLexiconFile(USER_LEXICON_FILE);

  if (!builtin && !user) return null;
  if (builtin && !user) return builtin;
  if (!builtin && user) return user;
  return mergeLexicon(builtin!, user!);
}


export function loadPersona(): Persona | null {
  try {
    if (!existsSync(PERSONA_FILE)) return null;
    const raw = readFileSync(PERSONA_FILE, 'utf-8');
    const p = JSON.parse(raw) as Persona;
    if (p.name && p.creator && p.style) return p;
    return null;
  } catch {
    return null;
  }
}

export function savePersona(p: Persona): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PERSONA_FILE, JSON.stringify(p, null, 2), 'utf-8');
}

export function loadConfig(): Record<string, any> | null {
  const configPath = join(CONFIG_DIR, 'config.json');
  try {
    if (!existsSync(configPath)) return null;
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 持久化：persona.json 的读写。
 * 平台无关，各适配器调用。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Persona } from './types.js';

const CONFIG_DIR = join(homedir(), '.config', 'cognitive-bridge');
const PERSONA_FILE = join(CONFIG_DIR, 'persona.json');

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

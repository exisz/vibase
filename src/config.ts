/**
 * Config loader — resolves .agentbase/agentbase.yml
 * Search order: current dir → parent dirs → ~/.agentbase/agentbase.yml
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseYaml, toYaml } from './yaml.js';
import type { AgentbaseConfig, Resolution } from './types.js';

const CONFIG_DIR = '.agentbase';
const CONFIG_FILE = 'agentbase.yml';

/**
 * Walk up from `startDir` looking for .agentbase/agentbase.yml.
 * Falls back to ~/.agentbase/agentbase.yml.
 */
export function findConfigPath(startDir?: string): string | null {
  let dir = resolve(startDir || process.cwd());
  const root = dirname(dir) === dir ? dir : '/'; // filesystem root

  while (true) {
    const candidate = join(dir, CONFIG_DIR, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  // Global fallback
  const global = join(homedir(), CONFIG_DIR, CONFIG_FILE);
  if (existsSync(global)) return global;

  return null;
}

/**
 * Load and parse config. Returns the config object and the directory containing .agentbase/.
 */
export function loadConfig(startDir?: string): { config: AgentbaseConfig; configDir: string } {
  const configPath = findConfigPath(startDir);
  if (!configPath) {
    console.error('Error: No .agentbase/agentbase.yml found.');
    console.error('Create one with: mkdir -p .agentbase && echo "vendor: trello" > .agentbase/agentbase.yml');
    process.exit(1);
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw) as unknown as AgentbaseConfig;

  if (!parsed.vendor) {
    console.error(`Error: "vendor" not set in ${configPath}`);
    process.exit(1);
  }

  // configDir is the parent of .agentbase/
  const configDir = dirname(dirname(configPath));

  return { config: parsed, configDir };
}

/**
 * Load config with full path info.
 */
export function loadFullConfig(startDir?: string): { config: AgentbaseConfig; configDir: string; configPath: string } {
  const configPath = findConfigPath(startDir);
  if (!configPath) {
    console.error('Error: No .agentbase/agentbase.yml found.');
    process.exit(1);
  }
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw) as unknown as AgentbaseConfig;
  if (!parsed.vendor) {
    console.error(`Error: "vendor" not set in ${configPath}`);
    process.exit(1);
  }
  const configDir = dirname(dirname(configPath));
  return { config: parsed, configDir, configPath };
}

/**
 * Save config back to agentbase.yml.
 */
export function saveConfig(configPath: string, config: AgentbaseConfig): void {
  const yaml = toYaml(config);
  writeFileSync(configPath, yaml + '\n', 'utf-8');
}

/**
 * Add a resolution record (upsert by checkItemId).
 */
export function addResolution(config: AgentbaseConfig, res: Resolution): void {
  if (!config.resolutions) config.resolutions = [];
  const idx = config.resolutions.findIndex(r => r.checkItemId === res.checkItemId);
  if (idx >= 0) {
    config.resolutions[idx] = res;
  } else {
    config.resolutions.push(res);
  }
}

/**
 * Get a resolution by checkItemId.
 */
export function getResolution(config: AgentbaseConfig, checkItemId: string): Resolution | undefined {
  return config.resolutions?.find(r => r.checkItemId === checkItemId);
}

/**
 * Get the .agentbase directory path for a given project dir.
 */
export function getAgentbaseDir(projectDir: string): string {
  return join(projectDir, CONFIG_DIR);
}

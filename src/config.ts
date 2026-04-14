/**
 * Config loader — resolves .agentfile/agentfile.yml
 * Search order: current dir → parent dirs → ~/.agentfile/agentfile.yml
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseYaml } from './yaml.js';
import type { AgentfileConfig } from './types.js';

const CONFIG_DIR = '.agentfile';
const CONFIG_FILE = 'agentfile.yml';

/**
 * Walk up from `startDir` looking for .agentfile/agentfile.yml.
 * Falls back to ~/.agentfile/agentfile.yml.
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
 * Load and parse config. Returns the config object and the directory containing .agentfile/.
 */
export function loadConfig(startDir?: string): { config: AgentfileConfig; configDir: string } {
  const configPath = findConfigPath(startDir);
  if (!configPath) {
    console.error('Error: No .agentfile/agentfile.yml found.');
    console.error('Create one with: mkdir -p .agentfile && echo "vendor: trello" > .agentfile/agentfile.yml');
    process.exit(1);
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw) as unknown as AgentfileConfig;

  if (!parsed.vendor) {
    console.error(`Error: "vendor" not set in ${configPath}`);
    process.exit(1);
  }

  // configDir is the parent of .agentfile/
  const configDir = dirname(dirname(configPath));

  return { config: parsed, configDir };
}

/**
 * Get the .agentfile directory path for a given project dir.
 */
export function getAgentfileDir(projectDir: string): string {
  return join(projectDir, CONFIG_DIR);
}

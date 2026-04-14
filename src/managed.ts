/**
 * Managed records — load/save .agentfile/managed.yaml
 * The killer feature: dedup registry that prevents agents from creating duplicate cards.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseYaml, toYaml } from './yaml.js';
import type { ManagedData, ManagedRecord } from './types.js';

const MANAGED_FILE = 'managed.yaml';

/**
 * Load managed.yaml from .agentfile/ directory.
 */
export function loadManaged(agentfileDir: string): ManagedData {
  const path = join(agentfileDir, MANAGED_FILE);
  if (!existsSync(path)) {
    return { records: [] };
  }
  const raw = readFileSync(path, 'utf-8');
  const parsed = parseYaml(raw) as unknown as ManagedData;
  if (!parsed.records) parsed.records = [];
  return parsed;
}

/**
 * Save managed.yaml to .agentfile/ directory.
 */
export function saveManaged(agentfileDir: string, data: ManagedData): void {
  const path = join(agentfileDir, MANAGED_FILE);
  if (!existsSync(agentfileDir)) {
    mkdirSync(agentfileDir, { recursive: true });
  }

  const header = '# Auto-maintained by agentfile. Maps local keys → remote record IDs.\n';
  const yaml = toYaml(data);
  writeFileSync(path, header + yaml + '\n', 'utf-8');
}

/**
 * Find a managed record by key.
 */
export function findByKey(data: ManagedData, key: string): ManagedRecord | undefined {
  return data.records?.find(r => r.key === key);
}

/**
 * Register a new managed record.
 */
export function registerRecord(data: ManagedData, record: ManagedRecord): void {
  if (!data.records) data.records = [];
  const existing = data.records.findIndex(r => r.key === record.key);
  if (existing >= 0) {
    data.records[existing] = record;
  } else {
    data.records.push(record);
  }
}

/**
 * Update an existing record's fields.
 */
export function updateRecord(data: ManagedData, key: string, updates: Partial<ManagedRecord>): boolean {
  const record = findByKey(data, key);
  if (!record) return false;
  Object.assign(record, updates);
  return true;
}

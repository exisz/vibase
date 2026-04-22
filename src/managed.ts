/**
 * Managed records — load/save .agentbase/managed.yaml
 * The killer feature: dedup registry that prevents agents from creating duplicate cards.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseYaml, toYaml } from './yaml.js';
import type { ManagedData, ManagedRecord, Resolution } from './types.js';

const MANAGED_FILE = 'managed.yaml';

/**
 * Load managed.yaml from .agentbase/ directory.
 */
export function loadManaged(agentbaseDir: string): ManagedData {
  const path = join(agentbaseDir, MANAGED_FILE);
  if (!existsSync(path)) {
    return { records: [] };
  }
  const raw = readFileSync(path, 'utf-8');
  const parsed = parseYaml(raw) as unknown as ManagedData;
  if (!parsed.records) parsed.records = [];
  return parsed;
}

/**
 * Save managed.yaml to .agentbase/ directory.
 */
export function saveManaged(agentbaseDir: string, data: ManagedData): void {
  const path = join(agentbaseDir, MANAGED_FILE);
  if (!existsSync(agentbaseDir)) {
    mkdirSync(agentbaseDir, { recursive: true });
  }

  const header = '# Auto-maintained by agentbase. Maps local keys → remote record IDs.\n';
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



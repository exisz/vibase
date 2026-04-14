/**
 * Sync command — sync managed.yaml with remote state
 */

import type { VendorAdapter, AgentbaseConfig } from '../types.js';
import { loadManaged, saveManaged } from '../managed.js';
import { getAgentbaseDir } from '../config.js';

export async function cmdSync(
  adapter: VendorAdapter,
  config: AgentbaseConfig,
  configDir: string
): Promise<void> {
  const agentbaseDir = getAgentbaseDir(configDir);
  const managed = loadManaged(agentbaseDir);

  if (!managed.records || managed.records.length === 0) {
    console.log('No managed records to sync.');
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const record of managed.records) {
    try {
      const card = await adapter.card(record.recordId);
      const changed = card.name !== record.name || card.listId !== record.listId;
      if (changed) {
        record.name = card.name;
        record.listId = card.listId;
        updated++;
        console.error(`[sync] Updated: ${record.key} → "${card.name}"`);
      }
    } catch {
      errors++;
      console.error(`[sync] Error reading record: ${record.key} (${record.recordId})`);
    }
  }

  saveManaged(agentbaseDir, managed);
  console.log(JSON.stringify({ synced: managed.records.length, updated, errors }, null, 2));
}

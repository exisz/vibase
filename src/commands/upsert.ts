/**
 * Upsert command — the killer feature.
 * If key exists in managed.yaml → UPDATE. If not → CREATE + register.
 */

import type { VendorAdapter, AgentbaseConfig } from '../types.js';
import { loadManaged, saveManaged, findByKey, registerRecord } from '../managed.js';
import { getAgentbaseDir } from '../config.js';

export async function cmdUpsert(
  adapter: VendorAdapter,
  config: AgentbaseConfig,
  configDir: string,
  opts: {
    key: string;
    listId: string;
    name: string;
    desc?: string;
    due?: string;
    labels?: string[];
  }
): Promise<void> {
  const agentbaseDir = getAgentbaseDir(configDir);
  const managed = loadManaged(agentbaseDir);
  const existing = findByKey(managed, opts.key);

  if (existing) {
    // UPDATE existing record
    console.error(`[upsert] Key "${opts.key}" found → updating record ${existing.recordId}`);
    const card = await adapter.cardUpdate(existing.recordId, {
      name: opts.name,
      desc: opts.desc,
      due: opts.due,
      listId: opts.listId !== existing.listId ? opts.listId : undefined,
    });

    // Update managed record
    existing.name = card.name;
    existing.listId = card.listId;
    saveManaged(agentbaseDir, managed);

    console.log(JSON.stringify({
      action: 'updated',
      key: opts.key,
      id: card.id,
      name: card.name,
      listId: card.listId,
    }, null, 2));
  } else {
    // CREATE new record
    console.error(`[upsert] Key "${opts.key}" not found → creating new record`);
    const boardId = config.trello?.board_id || '';
    const card = await adapter.cardCreate({
      listId: opts.listId,
      name: opts.name,
      desc: opts.desc,
      due: opts.due,
      labels: opts.labels,
      boardId,
    });

    // Register in managed
    registerRecord(managed, {
      key: opts.key,
      recordId: card.id,
      name: card.name,
      listId: card.listId,
    });
    saveManaged(agentbaseDir, managed);

    console.log(JSON.stringify({
      action: 'created',
      key: opts.key,
      id: card.id,
      name: card.name,
      listId: card.listId,
    }, null, 2));
  }
}

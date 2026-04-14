/**
 * Migrate command — import from old trello.yaml format
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml, toYaml } from '../yaml.js';
import { saveManaged } from '../managed.js';
import { getAgentbaseDir } from '../config.js';
import type { ManagedData, ManagedRecord } from '../types.js';

export async function cmdMigrateFromTrelloYaml(
  trelloYamlPath: string,
  configDir: string
): Promise<void> {
  if (!existsSync(trelloYamlPath)) {
    console.error(`File not found: ${trelloYamlPath}`);
    process.exit(1);
  }

  const raw = readFileSync(trelloYamlPath, 'utf-8');
  const data = parseYaml(raw) as Record<string, unknown>;

  const managed: ManagedData = {
    records: [],
  };

  // Try to extract board info
  if (data.board && typeof data.board === 'object') {
    const board = data.board as Record<string, unknown>;
    managed.board = {
      id: board.id as string || '',
      name: board.name as string || '',
      url: board.url as string || '',
      vendor: 'trello',
    };
  }

  // Try to extract lists
  if (data.lists && typeof data.lists === 'object') {
    managed.lists = data.lists as Record<string, string>;
  }

  // Try to extract records
  if (data.records && Array.isArray(data.records)) {
    managed.records = (data.records as Array<Record<string, unknown>>).map(r => ({
      key: r.key as string,
      recordId: r.recordId as string || r.card_id as string || r.id as string || '',
      name: r.name as string || '',
      listId: r.listId as string || r.list_id as string || '',
    }));
  }

  const agentbaseDir = getAgentbaseDir(configDir);
  if (!existsSync(agentbaseDir)) {
    mkdirSync(agentbaseDir, { recursive: true });
  }

  saveManaged(agentbaseDir, managed);

  console.log(`Migrated ${managed.records?.length || 0} records from ${trelloYamlPath}`);
  console.log(`Written to ${join(agentbaseDir, 'managed.yaml')}`);

  // Create a basic config if none exists
  const configPath = join(agentbaseDir, 'agentbase.yml');
  if (!existsSync(configPath)) {
    const configYaml = toYaml({
      vendor: 'trello',
      trello: {
        board_id: managed.board?.id || 'YOUR_BOARD_ID',
      },
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(configPath, configYaml + '\n', 'utf-8');
    console.log(`Created config: ${configPath}`);
  }
}

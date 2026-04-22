/**
 * Board commands — list boards, add/remove configured boards
 */

import type { VendorAdapter, AgentbaseConfig } from '../types.js';
import { loadFullConfig, saveConfig } from '../config.js';

export async function cmdBoards(adapter: VendorAdapter, config?: AgentbaseConfig): Promise<void> {
  const boards = config?.trello?.boards;
  if (boards && boards.length > 0) {
    console.log('Configured boards:');
    for (const b of boards) {
      const isDefault = b.id === config?.trello?.board_id ? ' (default)' : '';
      const alias = b.alias ? ` [${b.alias}]` : '';
      console.log(`  ${b.name}${alias} — ${b.id}${isDefault}`);
    }
    return;
  }
  // Fall back to API listing
  const apiBoards = await adapter.boards();
  console.log(JSON.stringify(apiBoards, null, 2));
}

export async function cmdBoardsAdd(
  adapter: VendorAdapter,
  boardId: string,
  opts: { alias?: string; name?: string }
): Promise<void> {
  const { config, configPath } = loadFullConfig();

  // Fetch name from API if not provided
  let name = opts.name;
  if (!name) {
    const boards = await adapter.boards();
    const found = boards.find(b => b.id === boardId);
    if (found) {
      name = found.name;
    } else {
      name = boardId; // fallback
    }
  }

  if (!config.trello) config.trello = { board_id: boardId };
  if (!config.trello.boards) config.trello.boards = [];

  // Check for duplicate
  const existing = config.trello.boards.find(b => b.id === boardId);
  if (existing) {
    // Update alias/name
    if (opts.alias) existing.alias = opts.alias;
    if (name) existing.name = name;
    console.log(`Updated board: ${name} (${boardId})`);
  } else {
    config.trello.boards.push({ id: boardId, name, alias: opts.alias });
    console.log(`Added board: ${name} (${boardId})${opts.alias ? ` alias=${opts.alias}` : ''}`);
  }

  saveConfig(configPath, config);
}

export async function cmdBoardsRemove(target: string): Promise<void> {
  const { config, configPath } = loadFullConfig();

  if (!config.trello?.boards || config.trello.boards.length === 0) {
    console.error('No boards configured.');
    process.exit(1);
  }

  const idx = config.trello.boards.findIndex(
    b => b.alias === target || b.id === target
  );

  if (idx < 0) {
    console.error(`Board not found: ${target}`);
    process.exit(1);
  }

  const removed = config.trello.boards.splice(idx, 1)[0];
  console.log(`Removed board: ${removed.name} (${removed.id})`);

  saveConfig(configPath, config);
}

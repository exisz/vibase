#!/usr/bin/env node

/**
 * agentbase — Agent Database: Multi-Vendor Board CLI
 *
 * Usage: agentbase <command> [options]
 *
 * Commands:
 *   boards                           List boards
 *   lists                            List all lists on configured board
 *   labels                           List labels
 *   cards [-l LIST]                   List cards (optionally filter by list)
 *   card CARD_ID                     Show card details
 *   card:create -l LIST -n NAME      Create a card
 *   card:update CARD_ID [opts]       Update a card
 *   card:move CARD_ID LIST           Move card to list
 *   card:archive CARD_ID             Archive card
 *   card:comment CARD_ID TEXT        Add comment
 *   upsert --key KEY -l LIST -n NAME Upsert (create or update) managed record
 *   managed                          Show managed records
 *   sync                             Sync managed.yaml with remote state
 *   snapshot [-o FILE]               Dump board to YAML
 *   migrate:from-trello-yaml FILE    Import from old trello.yaml format
 *   version                          Show version
 */

import { loadConfig } from './config.js';
import { TrelloAdapter } from './vendors/trello.js';
import { MarkdownAdapter } from './vendors/markdown.js';
import { cmdBoards } from './commands/boards.js';
import { cmdLists } from './commands/lists.js';
import { cmdLabels } from './commands/labels.js';
import { cmdCards, cmdCard, cmdCardCreate, cmdCardUpdate, cmdCardMove, cmdCardArchive, cmdCardComment } from './commands/cards.js';
import { cmdUpsert } from './commands/upsert.js';
import { cmdManaged } from './commands/managed.js';
import { cmdSync } from './commands/sync.js';
import { cmdSnapshot } from './commands/snapshot.js';
import { cmdChecklists, cmdChecklistCreate, cmdChecklistDelete, cmdCheckItemAdd, cmdCheckItemUpdate, cmdCheckItemDelete } from './commands/checklists.js';
import { cmdMigrateFromTrelloYaml } from './commands/migrate.js';
import type { VendorAdapter, AgentbaseConfig } from './types.js';
import { resolve } from 'node:path';

const VERSION = '0.3.0';

function createAdapter(config: AgentbaseConfig, configDir: string): VendorAdapter {
  switch (config.vendor) {
    case 'trello':
      return new TrelloAdapter();
    case 'markdown': {
      const dir = config.markdown?.dir || './boards';
      const resolvedDir = resolve(configDir, dir);
      return new MarkdownAdapter(resolvedDir);
    }
    default:
      console.error(`Unknown vendor: ${config.vendor}`);
      console.error('Supported vendors: trello, markdown');
      process.exit(1);
  }
}

function getBoardId(config: AgentbaseConfig, args: string[]): string {
  const bFlag = getFlag(args, '-b', '--board');
  if (bFlag) {
    // Resolve alias or name against configured boards
    const boards = config.trello?.boards || [];
    const byAlias = boards.find(b => b.alias === bFlag);
    if (byAlias) return byAlias.id;
    const byName = boards.find(b => b.name.toLowerCase() === bFlag.toLowerCase());
    if (byName) return byName.id;
    // Assume raw board ID
    return bFlag;
  }

  // Fall back to config
  if (config.trello?.board_id) return config.trello.board_id;
  if (config.trello?.boards?.[0]) return config.trello.boards[0].id;

  if (config.vendor === 'markdown') {
    console.error('Error: Board ID required. Use -b BOARD_ID');
    process.exit(1);
  }

  console.error('Error: Board ID required. Set trello.board_id in config or use -b BOARD_ID');
  process.exit(1);
}

function getFlag(args: string[], short: string, long: string): string | undefined {
  const sIdx = args.indexOf(short);
  const lIdx = args.indexOf(long);
  const idx = sIdx >= 0 ? sIdx : lIdx;
  if (idx >= 0 && args[idx + 1]) {
    return args[idx + 1];
  }
  return undefined;
}

function hasFlag(args: string[], ...names: string[]): boolean {
  return names.some(n => args.includes(n));
}

function getMultiFlag(args: string[], short: string, long: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === short || args[i] === long) && args[i + 1]) {
      result.push(args[i + 1]);
      i++;
    }
  }
  return result;
}

function printHelp(): void {
  console.log(`
agentbase — Agent Database: persistent state for AI agents

USAGE
  agentbase <command> [options]

COMMANDS
  boards                              List boards
  lists [-b BOARD]                    List all lists
  labels [-b BOARD]                   List labels
  cards [-b BOARD] [-l LIST]          List cards
  card <CARD_ID>                      Show card details
  card:create -l LIST -n NAME [-d DESC] [--due DATE] [--label LABEL]
                                      Create a card
  card:update <CARD_ID> [-n NAME] [-d DESC] [--due DATE] [--move-to LIST]
                                      Update a card
  card:move <CARD_ID> <LIST_ID>       Move card to list
  card:archive <CARD_ID>              Archive card
  card:comment <CARD_ID> <TEXT>       Add comment to card
  upsert --key KEY -l LIST -n NAME [-d DESC]
                                      Create-or-update managed record
  managed                             Show all managed records
  sync                                Sync managed.yaml with remote
  snapshot [-b BOARD] [-o FILE]       Export board to YAML
  checklist:list <CARD_ID>            List checklists on card
  checklist:create <CARD_ID> -n NAME  Create checklist on card
  checklist:delete <CHECKLIST_ID>     Delete checklist
  checklist:add <CHECKLIST_ID> -n NAME [--checked]
                                      Add item to checklist
  checklist:update <CARD_ID> <ITEM_ID> [-n NAME] [--check] [--uncheck] [--resolution TEXT]
                                      Update checklist item
  checklist:remove <CHECKLIST_ID> <ITEM_ID>
                                      Remove checklist item
  migrate:from-trello-yaml <FILE>     Import from old trello.yaml
  version                             Show version
  help                                Show this help

CONFIG
  Place .agentbase/agentbase.yml in your project root or ~/.agentbase/

  vendor: trello
  trello:
    board_id: "your-board-id"

ENVIRONMENT
  TRELLO_KEY    — Trello API key (for Trello vendor)
  TRELLO_TOKEN  — Trello API token (for Trello vendor)

DOCS
  https://github.com/exisz/agentbase
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`agentbase v${VERSION}`);
    process.exit(0);
  }

  // Commands that don't need config
  if (command === 'migrate:from-trello-yaml') {
    const file = args[1];
    if (!file) {
      console.error('Usage: agentbase migrate:from-trello-yaml <FILE>');
      process.exit(1);
    }
    await cmdMigrateFromTrelloYaml(file, process.cwd());
    return;
  }

  // All other commands need config + adapter
  const { config, configDir } = loadConfig();
  const adapter = createAdapter(config, configDir);

  switch (command) {
    case 'boards':
      await cmdBoards(adapter, config);
      break;

    case 'boards:add': {
      const boardArg = args[1];
      if (!boardArg) {
        console.error('Usage: agentbase boards:add <BOARD_ID> [--alias ALIAS] [--name NAME]');
        process.exit(1);
      }
      const alias = getFlag(args, '', '--alias');
      const nameFlag = getFlag(args, '', '--name');
      const { cmdBoardsAdd } = await import('./commands/boards.js');
      await cmdBoardsAdd(adapter, boardArg, { alias, name: nameFlag });
      break;
    }

    case 'boards:remove': {
      const target = args[1];
      if (!target) {
        console.error('Usage: agentbase boards:remove <ALIAS_OR_ID>');
        process.exit(1);
      }
      const { cmdBoardsRemove } = await import('./commands/boards.js');
      await cmdBoardsRemove(target);
      break;
    }

    case 'lists': {
      const boardId = getBoardId(config, args);
      await cmdLists(adapter, boardId);
      break;
    }

    case 'labels': {
      const boardId = getBoardId(config, args);
      await cmdLabels(adapter, boardId);
      break;
    }

    case 'cards': {
      const boardId = getBoardId(config, args);
      const listId = getFlag(args, '-l', '--list');
      await cmdCards(adapter, boardId, listId);
      break;
    }

    case 'card': {
      const cardId = args[1];
      if (!cardId) {
        console.error('Usage: agentbase card <CARD_ID>');
        process.exit(1);
      }
      await cmdCard(adapter, cardId);
      break;
    }

    case 'card:create': {
      const listId = getFlag(args, '-l', '--list');
      const name = getFlag(args, '-n', '--name');
      if (!listId || !name) {
        console.error('Usage: agentbase card:create -l LIST -n NAME [-d DESC] [--due DATE] [--label LABEL]');
        process.exit(1);
      }
      const desc = getFlag(args, '-d', '--desc');
      const due = getFlag(args, '', '--due');
      const labels = getMultiFlag(args, '', '--label');
      const boardId = getBoardId(config, args);
      await cmdCardCreate(adapter, listId, name, { desc, due, labels, boardId });
      break;
    }

    case 'card:update': {
      const cardId = args[1];
      if (!cardId) {
        console.error('Usage: agentbase card:update <CARD_ID> [-n NAME] [-d DESC] [--due DATE] [--move-to LIST]');
        process.exit(1);
      }
      const name = getFlag(args, '-n', '--name');
      const desc = getFlag(args, '-d', '--desc');
      const due = getFlag(args, '', '--due');
      const moveTo = getFlag(args, '', '--move-to');
      await cmdCardUpdate(adapter, cardId, { name, desc, due, moveTo });
      break;
    }

    case 'card:move': {
      const cardId = args[1];
      const listId = args[2];
      if (!cardId || !listId) {
        console.error('Usage: agentbase card:move <CARD_ID> <LIST_ID>');
        process.exit(1);
      }
      await cmdCardMove(adapter, cardId, listId);
      break;
    }

    case 'card:archive': {
      const cardId = args[1];
      if (!cardId) {
        console.error('Usage: agentbase card:archive <CARD_ID>');
        process.exit(1);
      }
      await cmdCardArchive(adapter, cardId);
      break;
    }

    case 'card:comment': {
      const cardId = args[1];
      const text = args[2];
      if (!cardId || !text) {
        console.error('Usage: agentbase card:comment <CARD_ID> <TEXT>');
        process.exit(1);
      }
      await cmdCardComment(adapter, cardId, text);
      break;
    }

    case 'upsert': {
      const key = getFlag(args, '', '--key');
      const listId = getFlag(args, '-l', '--list');
      const name = getFlag(args, '-n', '--name');
      if (!key || !listId || !name) {
        console.error('Usage: agentbase upsert --key KEY -l LIST -n NAME [-d DESC]');
        process.exit(1);
      }
      const desc = getFlag(args, '-d', '--desc');
      const due = getFlag(args, '', '--due');
      const labels = getMultiFlag(args, '', '--label');
      await cmdUpsert(adapter, config, configDir, { key, listId, name, desc, due, labels });
      break;
    }

    case 'managed':
      await cmdManaged(configDir);
      break;

    case 'sync':
      await cmdSync(adapter, config, configDir);
      break;

    case 'snapshot': {
      const boardId = getBoardId(config, args);
      const outfile = getFlag(args, '-o', '--output') || './board-snapshot.yaml';
      await cmdSnapshot(adapter, boardId, outfile, configDir);
      break;
    }

    case 'checklist:list': {
      const cardId = args[1];
      if (!cardId) { console.error('Usage: agentbase checklist:list <CARD_ID>'); process.exit(1); }
      await cmdChecklists(adapter, cardId, configDir);
      break;
    }

    case 'checklist:create': {
      const cardId = args[1];
      const name = getFlag(args, '-n', '--name');
      if (!cardId || !name) { console.error('Usage: agentbase checklist:create <CARD_ID> -n NAME'); process.exit(1); }
      await cmdChecklistCreate(adapter, cardId, name);
      break;
    }

    case 'checklist:delete': {
      const checklistId = args[1];
      if (!checklistId) { console.error('Usage: agentbase checklist:delete <CHECKLIST_ID>'); process.exit(1); }
      await cmdChecklistDelete(adapter, checklistId);
      break;
    }

    case 'checklist:add': {
      const checklistId = args[1];
      const name = getFlag(args, '-n', '--name');
      if (!checklistId || !name) { console.error('Usage: agentbase checklist:add <CHECKLIST_ID> -n NAME [--checked]'); process.exit(1); }
      const checked = hasFlag(args, '--checked');
      await cmdCheckItemAdd(adapter, checklistId, name, checked || undefined);
      break;
    }

    case 'checklist:update': {
      const cardId = args[1];
      const itemId = args[2];
      if (!cardId || !itemId) { console.error('Usage: agentbase checklist:update <CARD_ID> <ITEM_ID> [-n NAME] [--check] [--uncheck] [--resolution TEXT]'); process.exit(1); }
      const name = getFlag(args, '-n', '--name');
      const check = hasFlag(args, '--check');
      const uncheck = hasFlag(args, '--uncheck');
      const resolution = getFlag(args, '', '--resolution');
      const state = check ? 'complete' as const : uncheck ? 'incomplete' as const : undefined;
      await cmdCheckItemUpdate(adapter, cardId, itemId, { name, state, resolution }, configDir);
      break;
    }

    case 'checklist:remove': {
      const checklistId = args[1];
      const itemId = args[2];
      if (!checklistId || !itemId) { console.error('Usage: agentbase checklist:remove <CHECKLIST_ID> <ITEM_ID>'); process.exit(1); }
      await cmdCheckItemDelete(adapter, checklistId, itemId);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "agentbase help" for usage');
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});

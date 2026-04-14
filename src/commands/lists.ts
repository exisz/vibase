/**
 * List commands — list all lists on a board
 */

import type { VendorAdapter } from '../types.js';

export async function cmdLists(adapter: VendorAdapter, boardId: string): Promise<void> {
  const lists = await adapter.lists(boardId);
  console.log(JSON.stringify(lists, null, 2));
}

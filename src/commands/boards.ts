/**
 * Board commands — list boards
 */

import type { VendorAdapter } from '../types.js';

export async function cmdBoards(adapter: VendorAdapter): Promise<void> {
  const boards = await adapter.boards();
  console.log(JSON.stringify(boards, null, 2));
}

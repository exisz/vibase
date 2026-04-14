/**
 * Labels command
 */

import type { VendorAdapter } from '../types.js';

export async function cmdLabels(adapter: VendorAdapter, boardId: string): Promise<void> {
  const labels = await adapter.labels(boardId);
  console.log(JSON.stringify(labels, null, 2));
}

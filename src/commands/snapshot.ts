/**
 * Snapshot command — dump board state to YAML file
 */

import { writeFileSync } from 'node:fs';
import type { VendorAdapter } from '../types.js';

export async function cmdSnapshot(adapter: VendorAdapter, boardId: string, outfile: string): Promise<void> {
  const yaml = await adapter.snapshot(boardId);
  writeFileSync(outfile, yaml, 'utf-8');
  console.log(`Snapshot written to ${outfile}`);
}

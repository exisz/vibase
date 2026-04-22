/**
 * Snapshot command — dump board state to YAML file
 */

import { writeFileSync } from 'node:fs';
import type { VendorAdapter } from '../types.js';
import { loadFullConfig } from '../config.js';

export async function cmdSnapshot(adapter: VendorAdapter, boardId: string, outfile: string, configDir?: string): Promise<void> {
  let yaml = await adapter.snapshot(boardId);

  // If configDir provided, inject resolution data into snapshot
  if (configDir) {
    const { config } = loadFullConfig(configDir);
    if (config.resolutions && config.resolutions.length > 0) {
      // Append resolution lines after matching check item state lines
      for (const res of config.resolutions) {
        const statePattern = `                state: complete`;
        // Find the item by id and inject resolution after state line
        const idLine = `              - id: "${res.checkItemId}"`;
        const idx = yaml.indexOf(idLine);
        if (idx >= 0) {
          // Find the state line after this id
          const stateIdx = yaml.indexOf(statePattern, idx);
          if (stateIdx >= 0) {
            const endOfLine = yaml.indexOf('\n', stateIdx);
            if (endOfLine >= 0) {
              const resLine = `\n                resolution: "${res.resolution.replace(/"/g, '\\"')}"`;
              yaml = yaml.slice(0, endOfLine) + resLine + yaml.slice(endOfLine);
            }
          }
        }
      }
    }
  }

  writeFileSync(outfile, yaml, 'utf-8');
  console.log(`Snapshot written to ${outfile}`);
}

/**
 * Checklist commands — list, create, delete, add/update/remove items
 */

import type { VendorAdapter } from '../types.js';
import { loadFullConfig, saveConfig, addResolution, getResolution } from '../config.js';

export async function cmdChecklists(adapter: VendorAdapter, cardId: string, configDir?: string): Promise<void> {
  const checklists = await adapter.checklists(cardId);

  // Merge resolution data from config if configDir provided
  if (configDir) {
    const { config } = loadFullConfig(configDir);
    for (const cl of checklists) {
      for (const item of cl.items) {
        const res = getResolution(config, item.id);
        if (res) {
          item.resolution = res.resolution;
        }
      }
    }
  }

  console.log(JSON.stringify(checklists, null, 2));
}

export async function cmdChecklistCreate(adapter: VendorAdapter, cardId: string, name: string): Promise<void> {
  const checklist = await adapter.checklistCreate(cardId, name);
  console.log(JSON.stringify(checklist, null, 2));
}

export async function cmdChecklistDelete(adapter: VendorAdapter, checklistId: string): Promise<void> {
  await adapter.checklistDelete(checklistId);
  console.log(JSON.stringify({ deleted: checklistId }, null, 2));
}

export async function cmdCheckItemAdd(adapter: VendorAdapter, checklistId: string, name: string, checked?: boolean): Promise<void> {
  const item = await adapter.checkItemAdd(checklistId, name, checked);
  console.log(JSON.stringify(item, null, 2));
}

export async function cmdCheckItemUpdate(
  adapter: VendorAdapter,
  cardId: string,
  checkItemId: string,
  opts: { name?: string; state?: 'complete' | 'incomplete'; resolution?: string },
  configDir?: string,
): Promise<void> {
  const item = await adapter.checkItemUpdate(cardId, checkItemId, opts);

  // If resolution provided, store it and add comment
  if (opts.resolution && configDir) {
    // Add comment to card
    await adapter.cardComment(cardId, `✅ ${item.name} — ${opts.resolution}`);

    // Store in agentbase.yml
    const { config, configPath } = loadFullConfig(configDir);
    addResolution(config, {
      cardId,
      checkItemId,
      itemName: item.name,
      resolution: opts.resolution,
      checkedAt: new Date().toISOString(),
    });
    saveConfig(configPath, config);

    item.resolution = opts.resolution;
  }

  console.log(JSON.stringify(item, null, 2));
}

export async function cmdCheckItemDelete(adapter: VendorAdapter, checklistId: string, checkItemId: string): Promise<void> {
  await adapter.checkItemDelete(checklistId, checkItemId);
  console.log(JSON.stringify({ deleted: checkItemId }, null, 2));
}

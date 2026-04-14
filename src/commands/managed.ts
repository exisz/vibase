/**
 * Managed command — show all managed records
 */

import { loadManaged } from '../managed.js';
import { getAgentbaseDir } from '../config.js';

export async function cmdManaged(configDir: string): Promise<void> {
  const agentbaseDir = getAgentbaseDir(configDir);
  const managed = loadManaged(agentbaseDir);

  if (!managed.records || managed.records.length === 0) {
    console.log('No managed records.');
    return;
  }

  console.log(JSON.stringify(managed, null, 2));
}

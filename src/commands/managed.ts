/**
 * Managed command — show all managed records
 */

import { loadManaged } from '../managed.js';
import { getAgentfileDir } from '../config.js';

export async function cmdManaged(configDir: string): Promise<void> {
  const agentfileDir = getAgentfileDir(configDir);
  const managed = loadManaged(agentfileDir);

  if (!managed.records || managed.records.length === 0) {
    console.log('No managed records.');
    return;
  }

  console.log(JSON.stringify(managed, null, 2));
}

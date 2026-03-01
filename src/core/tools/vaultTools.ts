import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from '@mariozechner/pi-coding-agent';
import type { BashSpawnContext } from '@mariozechner/pi-coding-agent';
import { isBlockedCommand } from '../security/blocklist';

export interface VaultToolsOptions {
  blockedCommands?: string[];
  enableBlocklist?: boolean;
}

/**
 * Creates a read-only subset of vault tools for inline edit.
 * No bash, edit, or write tools — only read, grep, find, ls.
 */
export function createReadOnlyVaultTools(vaultPath: string) {
  return [
    createReadTool(vaultPath),
    createGrepTool(vaultPath),
    createFindTool(vaultPath),
    createLsTool(vaultPath),
  ];
}

export function createVaultTools(vaultPath: string, options?: VaultToolsOptions) {
  const bashSpawnHook = (ctx: BashSpawnContext): BashSpawnContext => {
    if (options?.enableBlocklist && options.blockedCommands) {
      if (isBlockedCommand(ctx.command, options.blockedCommands)) {
        throw new Error(`Command blocked by safety settings: ${ctx.command.slice(0, 80)}`);
      }
    }
    return ctx;
  };

  return [
    createReadTool(vaultPath),
    createBashTool(vaultPath, { spawnHook: bashSpawnHook }),
    createEditTool(vaultPath),
    createWriteTool(vaultPath),
    createGrepTool(vaultPath),
    createFindTool(vaultPath),
    createLsTool(vaultPath),
  ];
}

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
  blockedCommands?: { unix: string[]; windows: string[] };
  enableBlocklist?: boolean;
  bashEnabled?: boolean;
  env?: Record<string, string>;
}

/**
 * Returns the effective blocked commands list for the current platform.
 * On Windows, both unix and windows lists are merged (Git Bash can execute unix commands).
 */
function getPlatformBlockedCommands(cmds: { unix: string[]; windows: string[] }): string[] {
  if (process.platform === 'win32') {
    return [...cmds.unix, ...cmds.windows];
  }
  return cmds.unix;
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
  const bashEnabled = options?.bashEnabled !== false;

  const bashSpawnHook = (ctx: BashSpawnContext): BashSpawnContext => {
    if (options?.enableBlocklist && options.blockedCommands) {
      const blocked = getPlatformBlockedCommands(options.blockedCommands);
      if (isBlockedCommand(ctx.command, blocked)) {
        throw new Error(`Command blocked by safety settings: ${ctx.command.slice(0, 80)}`);
      }
    }
    // Merge custom environment variables into spawn context
    // Always include process.env as base to avoid dropping PATH, HOME, etc.
    if (options?.env && Object.keys(options.env).length > 0) {
      const baseEnv = Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>;
      ctx.env = { ...baseEnv, ...(ctx.env ?? {}), ...options.env };
    }
    return ctx;
  };

  const tools = [
    createReadTool(vaultPath),
    ...(bashEnabled ? [createBashTool(vaultPath, { spawnHook: bashSpawnHook })] : []),
    createEditTool(vaultPath),
    createWriteTool(vaultPath),
    createGrepTool(vaultPath),
    createFindTool(vaultPath),
    createLsTool(vaultPath),
  ];

  return tools;
}

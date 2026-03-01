/**
 * McpStorage - Handles .claude/mcp.json read/write.
 *
 * MCP server configurations are stored in Claude Code-compatible format
 * with optional obsidian-agent metadata in _obsidianAgent field.
 *
 * File format:
 * {
 *   "mcpServers": {
 *     "server-name": { "command": "...", "args": [...] }
 *   },
 *   "_obsidianAgent": {
 *     "servers": {
 *       "server-name": { "enabled": true, "contextSaving": true, "disabledTools": ["tool"] }
 *     }
 *   }
 * }
 */

import type { App } from 'obsidian';
import type {
  McpConfigFileWithMeta,
  McpServer,
  McpServerConfig,
  ParsedMcpConfig,
} from './types';
import { DEFAULT_MCP_SERVER, isValidMcpServerConfig } from './types';

/** Path to MCP config file relative to vault root. */
export const MCP_CONFIG_PATH = '.claude/mcp.json';
const MCP_CONFIG_DIR = '.claude';

export class McpStorage {
  constructor(private app: App) {}

  private async ensureDir(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(MCP_CONFIG_DIR))) {
      await adapter.mkdir(MCP_CONFIG_DIR);
    }
  }

  async load(): Promise<McpServer[]> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(MCP_CONFIG_PATH))) {
        return [];
      }

      const content = await adapter.read(MCP_CONFIG_PATH);
      const file = JSON.parse(content) as McpConfigFileWithMeta;

      if (!file.mcpServers || typeof file.mcpServers !== 'object') {
        return [];
      }

      const meta = file._obsidianAgent?.servers ?? {};
      const servers: McpServer[] = [];

      for (const [name, config] of Object.entries(file.mcpServers)) {
        if (!isValidMcpServerConfig(config)) {
          continue;
        }

        const serverMeta = meta[name] ?? {};
        const disabledTools = Array.isArray(serverMeta.disabledTools)
          ? serverMeta.disabledTools.filter((tool: unknown) => typeof tool === 'string')
          : undefined;
        const normalizedDisabledTools =
          disabledTools && disabledTools.length > 0 ? disabledTools : undefined;

        servers.push({
          name,
          config,
          enabled: serverMeta.enabled ?? DEFAULT_MCP_SERVER.enabled,
          contextSaving: serverMeta.contextSaving ?? DEFAULT_MCP_SERVER.contextSaving,
          disabledTools: normalizedDisabledTools,
          description: serverMeta.description,
        });
      }

      return servers;
    } catch {
      return [];
    }
  }

  async save(servers: McpServer[]): Promise<void> {
    await this.ensureDir();

    const mcpServers: Record<string, McpServerConfig> = {};
    const agentServers: Record<
      string,
      { enabled?: boolean; contextSaving?: boolean; disabledTools?: string[]; description?: string }
    > = {};

    for (const server of servers) {
      mcpServers[server.name] = server.config;

      // Only store metadata if different from defaults
      const meta: {
        enabled?: boolean;
        contextSaving?: boolean;
        disabledTools?: string[];
        description?: string;
      } = {};

      if (server.enabled !== DEFAULT_MCP_SERVER.enabled) {
        meta.enabled = server.enabled;
      }
      if (server.contextSaving !== DEFAULT_MCP_SERVER.contextSaving) {
        meta.contextSaving = server.contextSaving;
      }
      const normalizedDisabledTools = server.disabledTools
        ?.map((tool) => tool.trim())
        .filter((tool) => tool.length > 0);
      if (normalizedDisabledTools && normalizedDisabledTools.length > 0) {
        meta.disabledTools = normalizedDisabledTools;
      }
      if (server.description) {
        meta.description = server.description;
      }

      if (Object.keys(meta).length > 0) {
        agentServers[server.name] = meta;
      }
    }

    // Preserve existing unknown keys in the file
    const adapter = this.app.vault.adapter;
    let existing: Record<string, unknown> | null = null;
    if (await adapter.exists(MCP_CONFIG_PATH)) {
      try {
        const raw = await adapter.read(MCP_CONFIG_PATH);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          existing = parsed as Record<string, unknown>;
        }
      } catch {
        existing = null;
      }
    }

    const file: Record<string, unknown> = existing ? { ...existing } : {};
    file.mcpServers = mcpServers;

    const existingMeta =
      existing && typeof existing._obsidianAgent === 'object'
        ? (existing._obsidianAgent as Record<string, unknown>)
        : null;

    if (Object.keys(agentServers).length > 0) {
      file._obsidianAgent = { ...(existingMeta ?? {}), servers: agentServers };
    } else if (existingMeta) {
      const { servers: _servers, ...rest } = existingMeta;
      if (Object.keys(rest).length > 0) {
        file._obsidianAgent = rest;
      } else {
        delete file._obsidianAgent;
      }
    } else {
      delete file._obsidianAgent;
    }

    const content = JSON.stringify(file, null, 2);
    await adapter.write(MCP_CONFIG_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.app.vault.adapter.exists(MCP_CONFIG_PATH);
  }

  /**
   * Parse pasted JSON (supports multiple formats).
   *
   * Formats supported:
   * 1. Full Claude Code format: { "mcpServers": { "name": {...} } }
   * 2. Single server with name: { "name": { "command": "..." } }
   * 3. Single server without name: { "command": "..." }
   * 4. Multiple named servers: { "server1": {...}, "server2": {...} }
   */
  static parseClipboardConfig(json: string): ParsedMcpConfig {
    try {
      const parsed = JSON.parse(json);

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid JSON object');
      }

      // Format 1: Full Claude Code format
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        const servers: Array<{ name: string; config: McpServerConfig }> = [];

        for (const [name, config] of Object.entries(parsed.mcpServers)) {
          if (isValidMcpServerConfig(config)) {
            servers.push({ name, config: config as McpServerConfig });
          }
        }

        if (servers.length === 0) {
          throw new Error('No valid server configs found in mcpServers');
        }

        return { servers, needsName: false };
      }

      // Format 2: Single server config without name
      if (isValidMcpServerConfig(parsed)) {
        return {
          servers: [{ name: '', config: parsed as McpServerConfig }],
          needsName: true,
        };
      }

      // Format 3: Single named server
      const entries = Object.entries(parsed);
      if (entries.length === 1) {
        const [name, config] = entries[0];
        if (isValidMcpServerConfig(config)) {
          return {
            servers: [{ name, config: config as McpServerConfig }],
            needsName: false,
          };
        }
      }

      // Format 4: Multiple named servers
      const servers: Array<{ name: string; config: McpServerConfig }> = [];
      for (const [name, config] of entries) {
        if (isValidMcpServerConfig(config)) {
          servers.push({ name, config: config as McpServerConfig });
        }
      }

      if (servers.length > 0) {
        return { servers, needsName: false };
      }

      throw new Error('Invalid MCP configuration format');
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Invalid JSON');
      }
      throw error;
    }
  }

  /**
   * Try to parse clipboard content as MCP config.
   * Returns null if not valid MCP config.
   */
  static tryParseClipboardConfig(text: string): ParsedMcpConfig | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) {
      return null;
    }

    try {
      return McpStorage.parseClipboardConfig(trimmed);
    } catch {
      return null;
    }
  }
}

/**
 * McpToolAdapter - Bridges MCP tools into pi-mono AgentTool format.
 *
 * Maintains connected MCP clients per server, fetches tool lists,
 * and creates AgentTool wrappers that call MCP tools via the client.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type, type TSchema } from '@sinclair/typebox';

import { parseCommand } from '../../utils/mcp';
import type { McpServerConfig, McpStdioServerConfig, McpSSEServerConfig, McpHttpServerConfig } from './types';
import { getMcpServerType } from './types';

interface ConnectedServer {
  client: Client;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

/**
 * Convert a JSON Schema object to a TypeBox TSchema.
 * Uses Type.Unsafe to wrap arbitrary JSON Schema for pi-mono compatibility.
 */
function jsonSchemaToTypebox(schema?: Record<string, unknown>): TSchema {
  if (!schema || Object.keys(schema).length === 0) {
    // Permissive schema for tools without declared parameters
    return Type.Record(Type.String(), Type.Any());
  }
  // Use Type.Unsafe to pass through the JSON Schema as-is.
  // pi-mono's convertToLlm will serialize it correctly for the LLM API.
  return Type.Unsafe(schema);
}

export class McpToolAdapter {
  private connectedServers: Map<string, ConnectedServer> = new Map();

  /**
   * Close all connected MCP clients.
   */
  async reset(): Promise<void> {
    for (const [, server] of this.connectedServers) {
      try {
        await server.client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.connectedServers.clear();
  }

  /**
   * Connect to an MCP server and cache the connection + tool list.
   */
  private async connectServer(name: string, config: McpServerConfig): Promise<ConnectedServer> {
    // Return cached connection if available
    const existing = this.connectedServers.get(name);
    if (existing) return existing;

    const type = getMcpServerType(config);
    let transport;

    if (type === 'stdio') {
      const stdioConfig = config as McpStdioServerConfig;
      const { cmd, args } = parseCommand(stdioConfig.command, stdioConfig.args);
      const env = Object.fromEntries(
        Object.entries({ ...process.env, ...stdioConfig.env })
          .filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>;
      transport = new StdioClientTransport({
        command: cmd,
        args,
        env,
        stderr: 'ignore',
      });
    } else {
      const urlConfig = config as McpSSEServerConfig | McpHttpServerConfig;
      const url = new URL(urlConfig.url);
      const options = urlConfig.headers ? { requestInit: { headers: urlConfig.headers } } : undefined;
      transport = type === 'sse'
        ? new SSEClientTransport(url, options)
        : new StreamableHTTPClientTransport(url, options);
    }

    const client = new Client({ name: 'obsidian-agent', version: '1.0.0' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      await client.connect(transport, { signal: controller.signal });

      let tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> = [];
      try {
        const result = await client.listTools(undefined, { signal: controller.signal });
        tools = result.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
        }));
      } catch {
        // listTools failed but connection succeeded
      }

      const connected: ConnectedServer = { client, tools };
      this.connectedServers.set(name, connected);
      return connected;
    } catch (error) {
      try { await client.close(); } catch { /* ignore */ }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get pi-mono AgentTool wrappers for all tools from currently active MCP servers.
   *
   * @param activeServers Map of server name → config for servers that should be active
   * @param disallowedTools Set of full tool names (mcp__server__tool) to exclude
   */
  async getToolsForActiveServers(
    activeServers: Record<string, McpServerConfig>,
    disallowedTools: Set<string> = new Set(),
  ): Promise<AgentTool<any>[]> {
    const allTools: AgentTool<any>[] = [];

    // Close connections to servers no longer active
    for (const [name, server] of this.connectedServers) {
      if (!(name in activeServers)) {
        try { await server.client.close(); } catch { /* ignore */ }
        this.connectedServers.delete(name);
      }
    }

    for (const [serverName, config] of Object.entries(activeServers)) {
      try {
        console.log(`[MCP] Connecting to server "${serverName}" (${getMcpServerType(config)})...`);
        const connected = await this.connectServer(serverName, config);
        console.log(`[MCP] Connected to "${serverName}", ${connected.tools.length} tools available`);

        for (const mcpTool of connected.tools) {
          const fullToolName = `mcp__${serverName}__${mcpTool.name}`;

          // Skip disallowed tools
          if (disallowedTools.has(fullToolName)) continue;

          const agentTool = this.createAgentTool(
            serverName,
            mcpTool,
            connected.client,
          );
          allTools.push(agentTool);
        }
      } catch (error) {
        // Log connection error with detail but continue with other servers
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[MCP] Failed to connect to server "${serverName}": ${errMsg}`);
        if (error instanceof Error && error.stack) {
          console.error(`[MCP] Stack:`, error.stack);
        }
      }
    }

    return allTools;
  }

  /**
   * Create a pi-mono AgentTool wrapper for a single MCP tool.
   */
  private createAgentTool(
    serverName: string,
    mcpTool: { name: string; description?: string; inputSchema?: Record<string, unknown> },
    client: Client,
  ): AgentTool<any> {
    const fullName = `mcp__${serverName}__${mcpTool.name}`;
    const description = mcpTool.description
      ? `[MCP: ${serverName}] ${mcpTool.description}`
      : `[MCP: ${serverName}] ${mcpTool.name}`;

    return {
      name: fullName,
      label: `${serverName}: ${mcpTool.name}`,
      description,
      parameters: jsonSchemaToTypebox(mcpTool.inputSchema),
      execute: async (
        _toolCallId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
      ) => {
        try {
          const result = await client.callTool(
            { name: mcpTool.name, arguments: params },
            undefined,
            signal ? { signal } : undefined,
          );

          // Convert MCP result to AgentToolResult format
          const textParts: string[] = [];
          for (const content of (result.content as Array<{ type: string; text?: string }>) || []) {
            if (content.type === 'text' && content.text) {
              textParts.push(content.text);
            }
          }

          const text = textParts.join('\n') || 'Tool executed successfully (no output)';

          if (result.isError) {
            throw new Error(text);
          }

          return {
            content: [{ type: 'text' as const, text }],
            details: undefined,
          };
        } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
        }
      },
    };
  }
}

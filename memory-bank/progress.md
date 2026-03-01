# Progress

## What Works
- Plugin loads in Obsidian and registers sidebar view
- Multi-provider LLM support (Anthropic, OpenAI, Google, XAI, Groq, OpenRouter, Mistral)
- Real-time streaming with text, thinking, tool calls, and tool results
- Vault-scoped tools: read, write, edit, bash, grep, find, ls
- Settings UI: provider/model selection, API keys, thinking level, system prompt, blocklist, auto-scroll
- Command blocklist filtering for bash tool
- Markdown rendering of assistant responses
- Collapsible thinking blocks and tool call details
- Auto-scrolling during streaming
- Cancel streaming support
- New chat command

## What's Left to Build
- Chat history persistence (currently in-memory only)
- Test framework setup
- Any features the user requests

## Recent Changes
- **MCP Support** (2026-03-01): Added full Model Context Protocol server support
  - Types, storage (.claude/mcp.json), server manager, tester, tool adapter
  - Bridges MCP tools into pi-mono AgentTool format via Type.Unsafe()
  - Context-saving mode: servers activated via @mention in prompts
  - Settings UI: add/edit/delete/toggle/test/import MCP servers
  - Per-tool enable/disable in test modal
  - Clipboard import (supports multiple JSON formats)
  - MCP-aware tool rendering (icon, name formatting, summary)
  - System prompt updated with MCP guidance

## Known Issues
- None documented yet (initial commit)

## Architecture Decisions
| Decision | Rationale |
|----------|-----------|
| pi-mono libraries for LLM | Provides multi-provider support, tool execution, and agent orchestration out of the box |
| AsyncGenerator streaming | Bridges pi-mono's event-based subscription into a pull-based stream for easier consumption |
| esbuild post-build patches | Required for Obsidian's Electron environment (import.meta, node: imports, electron.asar) |
| Vault-scoped tools | Security: agent cannot access files outside the vault |
| No React/Vue | Obsidian convention: vanilla DOM with Obsidian API helpers |
| MCP config in .claude/mcp.json | Claude Code-compatible format; metadata in _obsidianAgent field |
| Per-query MCP tool activation | Context-saving servers only load tools when @-mentioned, saving tokens |
| MCP tools as AgentTool wrappers | Bridges MCP SDK tools into pi-mono via Type.Unsafe() for JSON Schema |

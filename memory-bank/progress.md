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

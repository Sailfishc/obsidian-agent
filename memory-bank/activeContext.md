# Active Context

## Current State
The plugin is at its initial commit stage. Core architecture is complete and functional:
- Plugin entry, sidebar view, agent service, streaming, and settings all implemented
- 16 source files across a clean modular structure

## Recent Changes
- Initial commit (`d297b13`): Full plugin implementation

## Current Work Focus
- No active development tasks; project just initialized

## Next Steps
- TBD based on user direction

## Active Decisions
- No test framework yet — manual testing via Obsidian reload
- Chat history is in-memory only (no persistence across sessions)
- API keys stored in plugin settings (with env var fallback)

## Important Patterns
- **Streaming:** AgentService.query() returns AsyncGenerator<StreamChunk>, consumed by ChatView
- **DOM:** Vanilla DOM manipulation using Obsidian API (createDiv, createEl), no framework
- **Security:** Vault-scoped tools + bash blocklist
- **Build:** esbuild with 3 post-build patches for Electron compatibility

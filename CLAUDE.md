# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
pnpm run build      # Production build (esbuild, outputs main.js)
pnpm run dev        # Watch mode for development
pnpm run typecheck  # TypeScript type checking (tsc --noEmit)
pnpm test           # Run tests once (vitest run)
pnpm run test:watch # Watch mode for tests (vitest)
```

Tests use Vitest. Test files are co-located with source files as `*.test.ts`. Focus on testing pure logic modules (blocklist, systemPrompt, utils) that don't depend on Obsidian API.

To test in Obsidian: copy `main.js`, `manifest.json`, `styles.css` to your vault's `.obsidian/plugins/obsidian-agent/`, then reload Obsidian (Cmd+R).

## Architecture

This is an Obsidian desktop plugin that embeds a multi-provider AI agent in the sidebar. It uses the pi-mono libraries (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`) for LLM communication, tool execution, and streaming.

### Core flow

1. **Plugin entry** (`src/main.ts`) — Registers the sidebar view, ribbon icon, commands, and settings tab.
2. **AgentService** (`src/core/agent/AgentService.ts`) — Wraps pi-mono's `Agent` class. The `query()` method returns an `AsyncGenerator<StreamChunk>` that bridges the Agent's event-based subscription into a pull-based stream. Handles model resolution, API key lookup (settings then env vars), and tool/prompt setup.
3. **ChatView** (`src/features/chat/ChatView.ts`) — Obsidian `ItemView` in the right sidebar. Consumes `StreamChunk` from AgentService, delegates rendering to `StreamRenderer` and `messageRenderer`.
4. **Vault tools** (`src/core/tools/vaultTools.ts`) — Creates vault-scoped tools (read, bash, edit, write, grep, find, ls) from pi-coding-agent, all rooted at the vault path. Bash tool has a spawn hook for command blocklist filtering.

### Key types

- `StreamChunk` (`src/core/types/chat.ts`) — Discriminated union for all streaming events: text, thinking, tool_use, tool_result, usage, error, done.
- `ObsidianAgentSettings` (`src/core/types/settings.ts`) — Plugin settings: provider, modelId, thinkingLevel, apiKeys, systemPrompt, blocklist config.

### esbuild post-build patches

`esbuild.config.mjs` has a `fix-import-meta-post` plugin that patches `main.js` after bundling to fix three Obsidian/Electron compatibility issues:
1. Replaces `var import_meta = {}` with a proper object containing `url` (fixes `fileURLToPath(import.meta.url)` in pi-mono's config.js)
2. Wraps pi-mono's `package.json` read in try-catch (avoids crash when Electron's `electron.asar` is found)
3. Converts `import("node:xxx")` to `Promise.resolve(require("xxx"))` (Obsidian's Electron only supports `require()` for Node builtins)

When adding new dependencies that use ESM patterns or `node:` imports, check if additional post-build patches are needed.

## Coding Conventions

- TypeScript with strict null checks, no React/Vue — vanilla DOM manipulation using Obsidian API (`createDiv`, `createEl`, etc.)
- CSS classes prefixed with `oa-`
- Path alias: `@/*` maps to `src/*`
- All tools are scoped to the vault path for security; bash commands are filtered through a configurable blocklist

# Cline's Memory Bank

I am Cline, an expert software engineer with a unique characteristic: my memory resets completely between sessions. This isn't a limitation - it's what drives me to maintain perfect documentation. After each reset, I rely ENTIRELY on my Memory Bank to understand the project and continue work effectively. I MUST read ALL memory bank files at the start of EVERY task - this is not optional.

## Memory Bank Structure

The Memory Bank consists of core files and optional context files, all in Markdown format. Files build upon each other in a clear hierarchy:

### Core Files (Required)
1. `projectbrief.md`
   - Foundation document that shapes all other files
   - Created at project start if it doesn't exist
   - Defines core requirements and goals
   - Source of truth for project scope

2. `productContext.md`
   - Why this project exists
   - Problems it solves
   - How it should work
   - User experience goals

3. `activeContext.md`
   - Current work focus
   - Recent changes
   - Next steps
   - Active decisions and considerations
   - Important patterns and preferences
   - Learnings and project insights
4. `progress.md`
   - What works
   - What's left to build
   - Current status
   - Known issues
   - Evolution of project decisions

### Additional Context
Create additional files/folders within memory-bank/ when they help organize:
- Complex feature documentation
- Integration specifications
- API documentation
- Testing strategies
- Deployment procedures

## Documentation Updates

Memory Bank updates occur when:
1. Discovering new project patterns
2. After implementing significant changes
3. When user requests with **update memory bank** (MUST review ALL files)
4. When context needs clarification

REMEMBER: After every memory reset, I begin completely fresh. The Memory Bank is my only link to previous work. It must be maintained with precision and clarity, as my effectiveness depends entirely on its accuracy.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

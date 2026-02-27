# AGENTS.md

Instructions for AI coding agents working with this codebase.

## Project Overview

Obsidian Agent is an Obsidian plugin that embeds a multi-provider AI coding agent in the sidebar. It uses pi-mono (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`) for LLM communication and tool execution.

## Build & Development

```bash
npm install        # Install dependencies
npm run build      # Production build
npm run dev        # Watch mode
npm run typecheck  # Type check without emit
```

## Architecture

- `src/main.ts` - Plugin entry point
- `src/core/agent/AgentService.ts` - Wraps pi-mono Agent with streaming chunk interface
- `src/core/tools/vaultTools.ts` - Creates vault-scoped tools (read, bash, edit, write, grep, find, ls)
- `src/core/prompts/systemPrompt.ts` - System prompt construction
- `src/features/chat/ChatView.ts` - Obsidian sidebar view
- `src/features/settings/SettingsTab.ts` - Plugin settings UI

## Coding Style

- TypeScript with strict null checks
- Vanilla DOM manipulation (Obsidian API style, no React/Vue)
- CSS classes prefixed with `oa-`
- camelCase for functions/variables, PascalCase for classes

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

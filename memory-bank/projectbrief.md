# Project Brief: Obsidian Agent

## Overview
An Obsidian desktop plugin that embeds a multi-provider AI agent in the sidebar. Users can interact with an LLM that has direct access to vault files through scoped tools (read, write, edit, bash, grep, find, ls).

## Core Requirements
- Provide a chat-based AI assistant within Obsidian's right sidebar
- Support multiple LLM providers (Anthropic, OpenAI, Google, XAI, Groq, OpenRouter, Mistral)
- Give the agent file-system access scoped to the vault directory
- Stream responses in real-time with thinking, tool calls, and text
- Maintain security through command blocklisting and vault-scoped operations

## Technology Stack
- **Language:** TypeScript (strict null checks, no React — vanilla DOM)
- **Platform:** Obsidian desktop plugin (Electron)
- **AI Libraries:** pi-mono (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`)
- **Build:** esbuild with custom post-build patches for Obsidian/Electron compatibility
- **Styling:** CSS with `oa-` class prefix

## Key Constraints
- No test framework configured; verification is manual (build + load in Obsidian)
- esbuild post-build patches required for ESM/node: import compatibility in Electron
- All file tools must be rooted to vault path for security
- Bash commands filtered through configurable blocklist

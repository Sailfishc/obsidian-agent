# Product Context: Obsidian Agent

## Why This Project Exists
Obsidian users manage large knowledge bases of markdown files. An embedded AI agent with direct vault access enables intelligent file operations, content generation, code execution, and knowledge retrieval — all without leaving the editor.

## Problems It Solves
1. **Context switching** — Users don't need to copy/paste between Obsidian and external AI tools
2. **Vault awareness** — The agent can read, search, and modify vault files directly
3. **Multi-provider flexibility** — Users can choose their preferred LLM provider and model
4. **Safe automation** — Command blocklist and vault-scoped tools prevent accidental damage

## How It Works
1. User opens the AI agent sidebar (ribbon icon or command palette)
2. User types a prompt in the input area
3. AgentService wraps the prompt with system context and sends it to the selected LLM
4. The agent can use tools (read, write, edit, bash, grep, find, ls) to interact with the vault
5. Responses stream in real-time with collapsible thinking blocks and tool call details
6. User can cancel streaming, start new chats, or customize settings

## User Experience Goals
- Fast, responsive streaming UI with auto-scroll
- Transparent tool usage (users see what the agent reads/writes/executes)
- Simple configuration (provider, model, API key, optional system prompt)
- Safe defaults (blocklist enabled, vault-scoped operations)

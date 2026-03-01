# Obsidian Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**AI coding agent embedded in your Obsidian vault.** Get intelligent assistance for reading, writing, editing, and searching your notes — with full agentic capabilities including file operations, bash commands, and multi-step workflows.

![Obsidian Agent](Preview.png)

## Features

- 🤖 **Multi-Provider LLM Support** — Anthropic Claude, OpenAI GPT, Google Gemini, Groq, OpenRouter, and any OpenAI-compatible endpoint (Ollama, LM Studio, etc.)
- 📁 **Vault-Aware Tools** — Read, write, edit, and search files within your vault with full context awareness
- 💻 **Bash Execution** — Run shell commands with configurable safety blocklist
- 🔍 **Smart Search** — Grep and find across your entire vault
- 🧠 **Thinking Modes** — Adjustable reasoning levels (off, minimal, low, medium, high)
- 📎 **File Context** — Attach files as context with @mention, auto-detect active note
- 💬 **Conversation History** — Persistent chat sessions with easy switching
- 🎨 **Streaming UI** — Real-time token streaming with thinking visualization and tool execution feedback

## Installation

### From Release (Recommended)

1. Download the latest release from the [Releases page](https://github.com/Sailfishc/obsidian-agent/releases)
2. Extract to your Obsidian vault: `.obsidian/plugins/obsidian-agent/`
3. Enable the plugin in Obsidian Settings → Community Plugins

### Build from Source

```bash
# Clone the repository
git clone https://github.com/Sailfishc/obsidian-agent.git
cd obsidian-agent

# Install dependencies
pnpm install

# Build
pnpm run build

# Copy to Obsidian vault
cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/obsidian-agent/
```

## Usage

### Opening the Agent

- Click the **bot icon** in the left ribbon
- Use the command palette: `Obsidian Agent: Open chat view`
- Use the command: `Obsidian Agent: New chat`

### Basic Commands

| Command | Description |
|---------|-------------|
| `Read file.md` | Read and analyze a file |
| `Edit file.md to...` | Modify file contents |
| `Create file.md with...` | Create a new file |
| `Search for "keyword"` | Grep across vault |
| `Find all *.md files` | Find files by pattern |
| `Run ls -la` | Execute bash command |

### File Context

- **Active Note**: Automatically attached when you start a chat (shown as a pill above input)
- **@mention**: Type `@` to attach additional files or folders as context
- **Remove Context**: Click the × on any context pill

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Escape` | Cancel streaming |

## Configuration

### Provider Settings

1. Go to **Settings → Obsidian Agent**
2. Select your provider:
   - **Anthropic** — Claude models (recommended)
   - **OpenAI** — GPT-4, GPT-3.5
   - **Google** — Gemini models
   - **Custom OpenAI** — Ollama, LM Studio, or any OpenAI-compatible API

3. Enter your API key (or set environment variables like `ANTHROPIC_API_KEY`)

### Custom OpenAI-Compatible Endpoint

For local models (Ollama, LM Studio, etc.):

1. Select **Custom OpenAI** as provider
2. Set **Base URL**: `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio)
3. Set **Model ID**: Your model name (e.g., `llama3.2`, `qwen2.5-coder`)
4. API Key can be left empty for local endpoints

### Thinking Level

Adjust reasoning depth:
- **Off** — No thinking, fastest response
- **Minimal** — Brief reasoning
- **Low** — Quick analysis
- **Medium** — Balanced (default)
- **High** — Deep reasoning

### Command Blocklist

Block dangerous bash commands. Default blocked:
- `rm -rf`
- `chmod 777`
- `chmod -R 777`

Add more commands in settings.

## Environment Variables

Alternatively, set API keys via environment variables:

```bash
export ANTHROPIC_API_KEY=sk-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=...
export GROQ_API_KEY=...
```

## Development

```bash
# Install dependencies
pnpm install

# Development watch mode
pnpm run dev

# Production build
pnpm run build

# Type checking
pnpm run typecheck

# Run tests
pnpm test

# Test watch mode
pnpm run test:watch
```

### Testing in Obsidian

Use the provided deploy script (update `VAULT_PATH` first):

```bash
./deploy.sh
```

Or manually copy build artifacts:

```bash
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/obsidian-agent/
```

Then reload Obsidian: `Cmd+R` (macOS) or `Ctrl+R` (Windows/Linux).

## Architecture

Built on [pi-mono](https://github.com/badlogic/pi-mono) libraries:
- `@mariozechner/pi-agent-core` — Stateful agent with tool execution
- `@mariozechner/pi-ai` — Multi-provider LLM streaming
- `@mariozechner/pi-coding-agent` — Coding tools (read, write, edit, bash, grep, find, ls)

### Key Components

```
src/
├── main.ts                    # Plugin entry point
├── core/
│   ├── agent/
│   │   └── AgentService.ts    # pi-mono Agent wrapper
│   ├── tools/
│   │   └── vaultTools.ts      # Vault-scoped tools
│   ├── prompts/
│   │   └── systemPrompt.ts    # System prompt builder
│   ├── security/
│   │   └── blocklist.ts       # Bash command filtering
│   └── storage/
│       └── ConversationStore.ts # Conversation persistence
└── features/
    ├── chat/
    │   ├── ChatView.ts        # Main chat UI
    │   ├── rendering/         # Stream and message rendering
    │   └── ui/                # Input, context pills, conversation list
    └── settings/
        └── SettingsTab.ts     # Settings UI
```

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- [pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner — Core agent and AI libraries
- [Obsidian](https://obsidian.md) — The powerful knowledge base
- [Claude](https://claude.ai) — AI assistance in building this plugin

# Claudian 功能调研报告

> 调研日期：2026-03-01
> 项目地址：https://github.com/YishenTu/claudian
> 版本：v1.3.65

## 一、项目概述

**Claudian** 是一个 Obsidian 插件，由 YishenTu 开发，将 **Claude Code CLI** 嵌入 Obsidian 侧边栏。与我们的 obsidian-agent 使用 pi-mono 库不同，Claudian 直接使用 **Anthropic 官方的 `@anthropic-ai/claude-agent-sdk`**（v0.2.5），将 Vault 作为 Claude 的工作目录。

**技术栈差异：**

- **obsidian-agent**：pi-mono 库（`@mariozechner/pi-agent-core` 等），自己创建 vault tools
- **Claudian**：`@anthropic-ai/claude-agent-sdk` + `@modelcontextprotocol/sdk`，依赖 Claude Code CLI 已安装

**依赖：**

```json
{
  "@anthropic-ai/claude-agent-sdk": "^0.2.5",
  "@modelcontextprotocol/sdk": "~1.25.3",
  "tslib": "^2.8.1"
}
```

## 二、核心架构

```
src/
├── main.ts                      # 插件入口
├── core/                        # 核心基础设施
│   ├── agent/                   # Claude Agent SDK 封装 (ClaudianService)
│   ├── agents/                  # 自定义 agent 管理 (AgentManager)
│   ├── commands/                # Slash 命令管理
│   ├── hooks/                   # PreToolUse/PostToolUse 安全钩子
│   ├── mcp/                     # MCP 服务器配置与测试
│   ├── plugins/                 # Claude Code 插件发现与管理
│   ├── prompts/                 # 系统提示词（主 agent、inline edit、标题生成等）
│   ├── sdk/                     # SDK 消息转换
│   ├── security/                # 审批、黑名单、路径验证
│   ├── storage/                 # 分布式存储系统
│   ├── tools/                   # 工具常量与工具函数
│   └── types/                   # 类型定义
├── features/                    # 功能模块
│   ├── chat/                    # 主聊天视图 + UI、渲染、控制器、标签页
│   ├── inline-edit/             # 内联编辑服务 + UI
│   └── settings/                # 设置页 UI
├── shared/                      # 共享 UI 组件和弹窗
├── i18n/                        # 国际化（10 种语言）
├── utils/                       # 工具函数
└── style/                       # 模块化 CSS
```

## 三、核心功能特性

### 1. 多 Tab 会话管理

- 支持 3-10 个并发 chat tab
- Tab bar 可在 header 或 input 区域切换位置
- 每个 tab 独立会话、独立模型/MCP 配置
- 会话 fork/rewind 支持（从历史某点分叉新会话）
- Tab 状态持久化，重启 Obsidian 后恢复

### 2. Claude Agent SDK 集成（ClaudianService）

核心服务封装了 Claude Agent SDK 的 `query()` 函数：

- 使用 **持久化查询(persistent query)** 模式消除冷启动延迟
- 支持 `resume` session 恢复上下文
- 动态更新 model / thinking tokens / permission mode / MCP servers
- 支持 subagent（Task tool）的 sync 和 async 模式
- MessageChannel 消息队列和轮次管理
- QueryOptionsBuilder 构建查询配置

**关键设计：** ClaudianService 维护一个持久的 agent query 连接，通过 MessageChannel 将用户消息排入队列，避免每次请求都冷启动 SDK。

### 3. Inline Edit（内联编辑）

选中文本 + 快捷键弹出 modal 直接编辑，是 Claudian 的亮点功能之一。

- 两种模式：
  - **selection**：替换选中文本，使用 `<replacement>` 标签
  - **cursor**：在光标处插入内容，使用 `<insertion>` 标签
- 只读工具访问（Read, Glob, Grep, LS），限制在 vault 范围内
- Word-level diff 预览
- 支持多轮对话（clarification → 继续编辑）
- 独立的 system prompt（`inlineEdit.ts`）

### 4. MCP 支持

完整的 Model Context Protocol 服务器管理：

- 支持 stdio、SSE、HTTP 三种传输方式
- **Context-saving 模式**：MCP 服务器设为 `@` 提及时才激活，节省 context token
- 每个服务器可配置 disabled tools
- 在输入框用 `@mcp-server` 激活
- MCP 测试功能（McpTester）
- 配置存储在 `.claude/mcp.json`

### 5. Custom Agents（自定义代理）

支持四层 agent 加载优先级（越靠前优先级越高）：

1. **Built-in agents**：SDK init 消息中的内置 agent（Explore, Plan, Bash, general-purpose）
2. **Plugin agents**：`{installPath}/agents/*.md`（命名空间 `plugin-name:agent-name`）
3. **Vault agents**：`{vaultPath}/.claude/agents/*.md`
4. **Global agents**：`~/.claude/agents/*.md`

Agent 定义为 `.md` 文件 + YAML frontmatter，通过 `@Agents/` 在聊天中选择调用。

### 6. Claude Code Plugins

- 自动发现 `~/.claude/plugins/installed_plugins.json` 中的已安装插件
- 支持 user-scoped 和 project-scoped 两种范围
- Plugin 的 skills、agents、slash commands 自动整合
- Per-vault 启用/禁用控制
- 设置写入 `.claude/settings.json` 保持与 Claude Code CLI 兼容

### 7. Skills 系统

- 从 `~/.claude/skills/` 或 `{vault}/.claude/skills/` 加载 `SKILL.md`
- 基于上下文自动调用
- 兼容 Claude Code 的 skill 格式
- 支持 `disableModelInvocation`、`userInvocable` 等配置

### 8. Slash Commands（斜杠命令）

- `/command` 触发自定义 prompt 模板
- 支持参数占位符、`@file` 引用、bash 替换
- 可覆盖 model 和 allowed tools
- 来源四种：`builtin`、`user`、`plugin`、`sdk`
- 存储在 `.claude/commands/*.md`（YAML frontmatter）

### 9. Instruction Mode（指令模式）

- 在输入框输入 `#` 触发
- 使用 AI refine 用户的自定义指令
- 通过 modal 预览/编辑后追加到 system prompt
- 保存在 `systemPrompt` 设置字段中

### 10. Plan Mode（规划模式）

- `Shift+Tab` 切换进入/退出 Plan Mode
- 先探索和设计方案，再提交给用户审批
- 审批后三种选择：
  - 在新会话中执行
  - 在当前会话中继续
  - 提供反馈修改方案
- Plan Mode 是临时状态，重启 Obsidian 后自动恢复到 normal 模式

### 11. 安全机制

#### 权限模式

| 模式 | 行为 |
|------|------|
| **YOLO** | 所有工具自动执行（默认） |
| **Safe** | 每次工具调用需要审批（Bash 精确匹配，文件工具前缀匹配） |
| **Plan** | 先规划再执行 |

#### Security Hooks（PreToolUse 钩子链）

- **BlocklistChecker**：命令黑名单检查
  - 区分 Unix 和 Windows 平台命令
  - Windows 下 Bash Tool 合并两个平台的黑名单（因为 Git Bash 也能执行 Windows 命令）
  - 支持正则匹配
- **BashPathValidator**：Bash 命令中的路径逃逸检测
- **VaultRestriction**：文件操作限制在 vault + export paths + external contexts
- Symlink-safe 路径验证（`realpath`）

#### 路径访问控制

| 位置 | 权限 | 路径格式 |
|------|------|----------|
| **Vault** | 读/写 | 相对路径 |
| **Export paths** | 仅写 | `~` 或绝对路径 |
| **External contexts** | 完全访问 | 绝对路径 |

#### CC 兼容权限规则

使用 `Tool(pattern)` 格式：
- `Bash(git *)` — 允许 git 命令
- `Read(*.md)` — 允许读取 markdown 文件
- `WebFetch(domain:github.com)` — 允许获取 GitHub

### 12. 上下文管理

- 自动附加当前打开的笔记（`<current_note>` 标签）
- `@` 提及 vault 文件
- 编辑器选中文本自动作为 `<editor_selection>` 上下文
- 拖拽/粘贴图片 + Vision 支持
- **External Context**：可添加 vault 外的目录作为额外上下文
- **Persistent External Contexts**：跨会话持久化的外部目录
- 按 tag 排除笔记（`excludedTags`）
- Canvas 选中内容感知

### 13. 国际化（i18n）

10 种语言支持：en, de, es, fr, ja, ko, pt, ru, zh-CN, zh-TW

### 14. 其他功能

- **BangBash Mode (`!`)**：`!command` 直接执行 bash 命令
- **Chrome 集成**：通过 `claude-in-chrome` 扩展让 Claude 操作 Chrome
- **自动标题生成**：AI 驱动的会话标题自动生成
- **Vim 风格导航**：可配置 w/s/i 等键绑定
- **Resume Session**：恢复之前的 SDK 会话
- **环境变量片段（Env Snippets）**：保存和恢复环境变量配置集

## 四、存储架构

| 文件 | 内容 |
|------|------|
| `.claude/claudian-settings.json` | Claudian 专用设置 |
| `.claude/settings.json` | CC 兼容设置（permissions, env, plugins） |
| `.claude/settings.local.json` | 本地覆盖设置（gitignored） |
| `.claude/mcp.json` | MCP 服务器配置 |
| `.claude/commands/*.md` | Slash 命令定义 |
| `.claude/agents/*.md` | 自定义 agent 定义 |
| `.claude/skills/*/SKILL.md` | Skill 定义 |
| `.claude/sessions/*.meta.json` | 会话元数据 |
| `~/.claude/projects/{vault}/*.jsonl` | SDK 原生会话消息 |

## 五、与 obsidian-agent 的关键差异

| 维度 | obsidian-agent | Claudian |
|------|---------------|----------|
| **AI 后端** | pi-mono 库，多 provider 支持 | Claude Agent SDK，仅 Claude |
| **工具系统** | pi-coding-agent 的 vault tools | SDK 内置工具 + PreToolUse hooks |
| **Session** | 无持久化 session | SDK session resume + fork/rewind |
| **多 Tab** | 单会话 | 多 Tab（3-10） |
| **MCP** | 无 | 完整 MCP 支持 |
| **Inline Edit** | 无 | Word-level diff 内联编辑 |
| **Agents** | 无 | 多层自定义 agent + subagent |
| **Plugins** | 无 | Claude Code plugin 生态整合 |
| **权限** | 简单 blocklist | 三模式 + CC 兼容权限规则 |
| **i18n** | 无 | 10 种语言 |
| **测试** | 无测试框架 | Jest，完整的 unit + integration |
| **代码量** | ~10 个 src 文件 | ~80+ 个 src 文件 |
| **esbuild 补丁** | 3 个 import.meta/node: 补丁 | 独立构建脚本 |

## 六、值得借鉴的功能

### 高优先级

1. **Inline Edit** — 选中文本直接编辑，非常实用的交互方式，提升笔记编辑效率
2. **MCP 支持** — 可扩展的工具生态，连接外部数据源和工具
3. **Plan Mode** — 先规划后执行，减少破坏性操作，提升用户信任
4. **Session persistence** — 会话持久化和恢复，重启不丢失上下文

### 中优先级

5. **Multi-tab** — 并行多个对话，适合同时处理多个任务
6. **Security hooks 架构** — 可插拔的安全检查链，比简单 blocklist 更灵活
7. **Context-saving MCP** — 按需激活 MCP，节省 token 消耗
8. **Custom Agents** — 用户定义专用子代理，分工明确

### 低优先级

9. **i18n** — 多语言支持，扩大用户群
10. **Claude Code Plugin 生态** — 与 Claude Code CLI 深度整合
11. **Vim 导航** — 键盘流用户的效率提升
12. **BangBash** — 快速执行 shell 命令

## 七、技术亮点

### 持久化查询架构

Claudian 最核心的技术设计是 **persistent query** 模式。ClaudianService 维护一个长期运行的 SDK query 连接，通过 MessageChannel 将用户消息排入队列。这避免了每次用户发消息都要冷启动 Claude SDK，显著降低延迟。

### Hook 系统

安全检查通过 `HookCallbackMatcher` 实现可组合的 PreToolUse 钩子链：

```typescript
hooks: {
  PreToolUse: [
    createBlocklistHook(getBlocklistContext),
    createVaultRestrictionHook(vaultContext),
  ],
}
```

每个 hook 独立检查，返回 `{ continue: true }` 放行或 `{ continue: false, hookSpecificOutput: { permissionDecision: 'deny' } }` 拒绝。

### SDK 消息转换层

`transformSDKMessage` 将 Claude Agent SDK 的原始消息（stream events、assistant messages、system messages）转换为 Claudian 内部的 `StreamChunk` 类型，解耦了 SDK 细节和 UI 渲染。

### 测试体系

完整的 Jest 测试配置：
- 测试目录结构镜像 `src/` 结构
- Unit tests + Integration tests 分项目运行
- Mock 了 `obsidian` 和 `claude-agent-sdk` 模块
- TDD 工作流（先写失败测试 → 最小实现 → 重构）

# Kapybara 项目深度调研报告

## 1. 项目概述

**Kapybara** 是一个基于 Python 的 AI Agent 框架项目，由 Sailfishc 维护（fork 自 BeautyyuYanli/Kapybara）。项目名称可能源自"水豚"（Capybara）的变体拼写。

### 1.1 基本信息

| 属性 | 值 |
|------|-----|
| **仓库** | `Sailfishc/Kapybara` |
| **主要语言** | Python 98.2% |
| **Python 版本** | 3.13+ (核心模块要求 3.14) |
| **许可证** | MIT |
| **包管理器** | PDM (Python Dependency Manager) |
| **作者** | Yanli 盐粒 (`yanli@dify.ai`) |

### 1.2 项目定位

Kapybara 是一个**面向生产环境的 AI Agent 运行时框架**，核心特点包括：

- **基于 pydantic-ai** 构建 Agent 系统
- **支持多渠道消息路由**（Channel-based routing）
- **持久化记忆存储**（Folder-backed Memory Store）
- **Docker 容器化部署**（SSH + Supervisor 架构）
- **Telegram Bot 集成**（作为 Starter 示例）

---

## 2. 项目架构

### 2.1 目录结构

```
Kapybara/
├── core/                    # 核心 Agent 运行时
│   ├── src/k/
│   │   ├── agent/          # Agent 核心逻辑
│   │   │   ├── core/       # Agent 实现、工具、提示词
│   │   │   ├── memory/     # 记忆存储系统
│   │   │   └── channels.py # 频道路由工具
│   │   ├── io_helpers/     # IO 辅助（Shell 会话管理）
│   │   ├── runner_helpers/ # 运行辅助（OS 命令构建）
│   │   ├── starters/       # 启动器入口
│   │   └── config.py       # 运行时配置
│   ├── tests/
│   └── pyproject.toml
│
├── collections/             # 消息集合/启动器集合
│   └── src/kapy_collections/
│       └── starters/
│           ├── telegram/    # Telegram 轮询启动器
│           └── telegram_mq/ # Telegram 消息队列启动器
│
├── docker/                  # Docker 部署配置
│   ├── basic-os/
│   │   ├── Dockerfile
│   │   ├── docker-entrypoint.sh
│   │   └── supervisord.conf
│   └── docker-compose.yaml
│
├── data/fs/                 # 运行时文件系统挂载点
│   └── .kapybara/          # 配置和数据目录
│
├── docs/concept/            # 概念文档
│   └── channel.md          # Channel 设计规范
│
└── scripts/                 # 构建/部署脚本
```

### 2.2 核心组件关系图

```
┌─────────────────────────────────────────────────────────────┐
│                    Telegram Starter                         │
│              (collections/kapy_collections)                 │
└─────────────────────────┬───────────────────────────────────┘
                          │ Event(in_channel, out_channel, content)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      Agent Runtime                          │
│                    (core/src/k/agent)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │   Agent     │  │    Tools     │  │   Prompts       │    │
│  │   (run)     │──│  (bash,      │──│   (SOP,         │    │
│  │             │  │   edit_file, │  │    Skills,      │    │
│  │             │  │   read_media)│  │    Memory)      │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
│           │                                                │
│           ▼                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Memory System                          │   │
│  │  - FolderMemoryStore (JSON + JSONL)                │   │
│  │  - MemoryRecord (compacted/detailed)               │   │
│  │  - Hierarchical channel-based retrieval            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Shell Session (anyio + asyncio)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Docker Container                         │
│  - SSH Server (sshd)                                        │
│  - Cron Daemon                                              │
│  - User Workspace (/home/k)                                 │
│  - Skills Directory (~/.kapybara/skills)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 核心技术模块

### 3.1 Agent 核心 (`core/src/k/agent/core/`)

#### 3.1.1 `agent.py` - Agent 编排

**关键类：`MyDeps`**
```python
@dataclass(slots=True)
class MyDeps:
    """Agent 运行的依赖容器"""
    config: Config
    memory_storage: FolderMemoryStore
    memory_parents: list[str]
    start_event: Event
    bash_cmd_history: list[str] = field(default_factory=list)
    count_down: int = 6  # Bash 工具调用倒计时
    shell_manager: ShellSessionManager = field(init=False)
```

**核心函数：`agent_run()`**
- 加载记忆上下文（支持祖先检索）
- 注入系统提示词（偏好、技能、SOP）
- 运行 Agent 并返回 `MemoryRecord`

#### 3.1.2 工具系统 (`shell_tools.py`)

| 工具 | 功能 |
|------|------|
| `bash()` | 启动新的 bash 会话 |
| `bash_input()` | 向会话发送 stdin |
| `bash_wait()` | 等待会话输出 |
| `bash_interrupt()` | 中断会话 |
| `edit_file()` | 文件内容编辑 |
| `read_media()` | 读取媒体文件（图片/音频/视频/文档） |

**Bash 会话管理特点：**
- 使用 `anyio.open_process` 实现异步进程管理
- 支持流式 stdout/stderr 读取
- 内置超时控制和输出截断（16000 tokens）
- 会话 ID 为 6 位数字，便于用户传递

#### 3.1.3 提示词系统 (`prompts.py`)

**核心提示词模块：**

| 提示词 | 用途 |
|--------|------|
| `SOP_prompt` | 标准操作流程（8 步） |
| `general_prompt` | 通用能力描述 |
| `bash_tool_prompt` | Bash 工具使用说明 |
| `input_event_prompt` | Event 结构解释 |
| `memory_instruct_prompt` | 记忆检索指导 |
| `response_instruct_prompt` | 回复路由指导 |
| `intent_instruct_prompt` | 意图判断规则（4 条） |
| `preference_prompt` | 偏好管理 |
| `compacted_prompt` | 记忆压缩规则 |

**SOP 流程：**
1. 检查输入事件，确定回复目标频道
2. **检索记忆/上下文**（在任何决策之前）
3. 决定是否回复（根据意图规则）
4. 检查所需技能是否存在
5. 执行任务（长时间任务先发确认消息）
6. 发送回复
7. 创建新技能（如适用）
8. 调用 `finish_action` 生成结构化摘要

### 3.2 记忆系统 (`core/src/k/agent/memory/`)

#### 3.2.1 `MemoryRecord` 数据结构

```python
class MemoryRecord(BaseModel):
    created_at: datetime
    in_channel: str                    # 输入频道（必需）
    out_channel: str | None = None     # 输出频道（None=同输入）
    id_: str = ""                      # 时间序 ID（8 字符 base64-like）
    parents: list[str] = []            # 父记录 ID
    children: list[str] = []           # 子记录 ID
    input: str                         # 原始输入
    compacted: list[str] = []          # 压缩后的处理过程
    output: str = ""                   # 回复输出
    detailed: list[ModelRequest | ModelResponse] = []  # 详细对话历史
```

**ID 设计特点：**
- 基于毫秒级 POSIX 时间戳
- 48 位大端编码 → 6 字节 → 8 字符 URL-safe 字符串
- 字母表设计使字典序=时间序
- 示例：`"-01234AB"`

#### 3.2.2 `FolderMemoryStore` 存储实现

**文件系统布局：**
```
<root>/records/YYYY/MM/DD/HH/
├── <id>.core.json        # 元数据 + compacted
└── <id>.detailed.jsonl   # JSONL: input + output + tool_calls
```

**存储特性：**
- 严格模式：JSON 解析错误会抛出带路径/行号的异常
- 自修复：缺失记录的引用会被清理并桥接邻居
- 缓存失效：基于文件 stat 快照
- 支持 `ripgrep (rg)` 进行关键词搜索

### 3.3 频道系统 (`docs/concept/channel.md`)

#### 3.3.1 Channel 格式规范

```
# 格式：URL 路径式层级结构
# - 斜杠分隔
# - 无空段
# - 无前导/尾随斜杠

# 示例：Telegram 频道
telegram/chat/<chat_id>/thread/<message_thread_id>
```

#### 3.3.2 技能注入规则

```
root(channel) = 第一个路径段

- Context skill:  context/{root(in_channel)}
- Messager skill: messager/{root(effective_out_channel)}
```

#### 3.3.3 偏好注入顺序

对于 `in_channel = telegram/chat/<chat_id>`：

1. `PREFERENCES.md` (或 `PREFERENCES.default.md`)
2. `telegram.md`
3. `telegram/PREFERENCES.md`
4. `telegram/chat.md`
5. `telegram/chat/PREFERENCES.md`
6. `telegram/chat/<chat_id>.md`
7. `telegram/chat/<chat_id>/PREFERENCES.md`

#### 3.3.4 记忆检索规则

```
查询前缀：telegram/chat/<chat_id>
匹配：
  - telegram/chat/<chat_id>
  - telegram/chat/<chat_id>/thread/1
  - telegram/chat/<chat_id>/thread/2
```

### 3.4 配置系统 (`core/src/k/config.py`)

```python
class Config(BaseSettings):
    """从构造函数参数和 K_* 环境变量加载"""
    
    config_base: Path = Path("~/.kapybara")
    ssh_user: str | None = None
    ssh_addr: str | None = None
    ssh_port: int = 22
    ssh_key: Path = Path("~/.ssh/id_ed25519")
    
    # 不变量：
    # - config_base 始终指向 .kapybara 目录
    # - ssh_user 和 ssh_addr 同时为 None 时启用本地模式
```

**环境变量前缀：** `K_`
- `K_CONFIG_BASE`
- `K_SSH_USER`
- `K_SSH_ADDR`
- `K_SSH_PORT`
- `K_SSH_KEY`

### 3.5 Docker 部署 (`docker/`)

#### 3.5.1 容器架构

```yaml
services:
  basic-os:
    image: kapybara-basic-os:latest
    environment:
      PUID: "${PUID}"   # 运行时用户 ID
      PGID: "${PGID}"   # 运行时组 ID
    volumes:
      - ../data/fs:/home/k        # 用户工作区
      - ../core:/core             # 核心代码（开发挂载）
      - ../collections:/collections
    ports:
      - "${SSH_HOST_PORT:-2222}:22"
```

#### 3.5.2 容器内服务（Supervisor 管理）

| 服务 | 优先级 | 功能 |
|------|--------|------|
| `sshd` | 10 | SSH 服务器（用于远程命令执行） |
| `cron` | 20 | 定时任务守护进程 |
| `start.sh` | 30 | 用户自定义启动脚本 |

#### 3.5.3 安全设计

- **非 root 运行**：容器启动时动态创建用户
- **SSH 密钥隔离**：`~/.ssh/id_ed25519` 容器内生成
- **卷挂载验证**：`/home/k` 必须是挂载点
- **UID/GID 检查**：禁止使用 root (0)

---

## 4. Telegram Starter 实现

### 4.1 架构概述

```
collections/src/kapy_collections/starters/telegram/
├── api.py          # Telegram Bot API 客户端
├── cli.py          # 命令行入口
├── runner.py       # 轮询循环和分发逻辑
├── compact.py      # 更新压缩和触发规则
├── events.py       # Telegram → Event 转换
├── history.py      # 更新历史持久化 (JSONL)
└── tz.py           # 时区处理
```

### 4.2 轮询机制

```python
async def _poll_and_run_forever(...):
    while True:
        updates = await api.get_updates(offset=next_offset, timeout_seconds=timeout)
        
        # 过滤未见过的更新
        unseen_updates = filter_unseen_updates(updates, last_consumed_update_id)
        
        # 累积待处理更新
        pending_updates_by_id[update_id] = update
        
        # 检查触发条件
        grouped = dispatch_groups_for_batch(pending, keyword, chat_ids, bot_user_id)
        
        # 触发后分发所有待处理更新
        if grouped:
            for chat_id, batch in dispatch_groups.items():
                await run_agent_for_chat_batch(batch)
```

### 4.3 触发规则

| 条件 | 描述 |
|------|------|
| **关键词匹配** | 消息内容包含配置的关键词 |
| **私聊** | 默认回复（除非明确说"不用回复"） |
| **回复机器人** | 回复机器人的消息 |
| **@提及** | 提及机器人用户名 |

### 4.4 更新压缩策略

**可压缩的更新类型：**
- `message`, `edited_message`, `channel_post`, `edited_channel_post`
- `business_message`, `edited_business_message`

**纯文本消息条件：**
- 仅包含 `text` 字段和格式化元数据（`entities`）
- 允许回复纯文本消息
- 排除 `forum_topic_created` 服务消息

---

## 5. 技能系统 (Skills)

### 5.1 技能文档结构

```
~/.kapybara/skills/
├── core/           # 核心技能
│   ├── web-search/SKILLS.md
│   ├── file-search/SKILLS.md
│   └── ...
├── meta/           # 元技能
│   ├── skills-search/SKILLS.md
│   ├── edit-file/SKILLS.md
│   └── ...
└── <platform>/     # 平台特定技能
    ├── telegram/SKILLS.md   # context/telegram
    └── ...
```

### 5.2 技能注入

```python
# 核心技能拼接
def concat_skills_md(config_base: str | Path) -> str:
    for group in ("core", "meta"):
        for skill_file in sorted(glob("*/SKILLS.md")):
            chunks.append(f"# ===== skills:{group}/{skill}/SKILLS.md =====")
            chunks.append(skill_file.read_text())

# 频道技能注入
def maybe_load_channel_skill_md(group, channel):
    root = channel_root(channel)  # 第一段
    md = skills_root / group / root / "SKILLS.md"
    return md.read_text() if md.exists() else None
```

### 5.3 创建新技能

Agent 可以通过 `create-skill` 工具动态创建新技能，当：
- 涉及新安装的应用
- 可以封装为可复用工作流

---

## 6. 开发工作流

### 6.1 环境设置

```bash
# 核心模块
cd core/
pdm install  # 或使用 uv

# 集合模块
cd collections/
pdm install
```

### 6.2 代码质量检查

```bash
# 在 core/ 目录下
pdm run fix        # ruff format + lint
pdm run typecheck  # ty check
pdm run test       # pytest
```

### 6.3 文档规范（AGENTS.md）

**必须遵守的规则：**

| 层级 | 内容 |
|------|------|
| **模块 docstring** | 目的、边界、关键不变量 |
| **类 docstring** | 职责、生命周期、状态变更 |
| **函数 docstring** | 行为契约、参数、副作用、异常 |
| **块注释** | 解释**为什么**（权衡、约束、边界情况） |

**代码即真相：** 如果 docstring 与代码冲突，以代码为准并更新文档。

---

## 7. 关键技术栈

### 7.1 核心依赖

| 库 | 用途 | 版本 |
|----|------|------|
| `pydantic-ai-slim` | Agent 框架 | ^1.62.0 |
| `pydantic` | 数据验证 | ^2.12.5 |
| `pydantic-settings` | 配置管理 | ^2.12.0 |
| `anyio` | 异步 IO | ^4.12.1 |
| `rich` | 终端输出 | ^14.3.2 |
| `logfire` | 可观测性 | ^4.22.0 |
| `tiktoken` | Token 计数 | ^0.12.0 |
| `aio-pika` | RabbitMQ 客户端 | ^9.6.1 |

### 7.2 开发工具

| 工具 | 用途 |
|------|------|
| `pdm` | 包管理 |
| `ruff` | Lint + Format |
| `ty` | 类型检查 |
| `pytest` | 测试 |
| `uv` | 快速 Python 安装 |
| `ripgrep (rg)` | 文件搜索 |

### 7.3 模型支持

通过 `pydantic-ai` 支持多模型后端：
- `OpenRouterModel` (默认示例)
- Google Generative AI
- OpenAI
- 其他 OpenRouter 可用模型

---

## 8. 设计亮点

### 8.1 频道路由设计

**优势：**
- 显式路由：`in_channel` → `out_channel`
- 层级记忆：前缀匹配支持上下文继承
- 技能隔离：`context/{platform}` / `messager/{platform}`

**示例场景：**
```
用户输入: telegram/chat/123/thread/456
→ Context skill: context/telegram
→ Messager skill: messager/telegram
→ 记忆检索：telegram/chat/123/* 的所有记录
```

### 8.2 记忆压缩

**压缩规则核心：**
- `raw_input`：用户输入的自然语言摘要（保持原文）
- `raw_output`：代理输出的自然语言摘要
- `input_intents`：意图解释（包含发送者身份和目的）
- `compacted_actions`：高保真任务过程日志

**高保真原则（最重要）：**
> 不要过度摘要而丢失具体细节：接收了什么、尝试了什么、观察到了什么、回应了什么。

### 8.3 Shell 会话管理

**设计特点：**
- 使用 `asyncio.Task` 而非 `anyio.TaskGroup`（支持跨工具调用保持会话）
- 流式输出读取（避免阻塞等待）
- 退出后自动 draining（获取剩余输出）
- 管理器统一生命周期（`ShellSessionManager`）

### 8.4 偏好系统

**动态注入：**
- 根偏好 → 频道前缀偏好 → 用户特定偏好
- 支持 Agent 自主更新偏好文件
- 使用 `edit_file` 工具修改

---

## 9. 潜在改进点

### 9.1 文档完善

- 缺少根目录 `README.md`
- 技能系统文档不足
- 缺少快速开始指南

### 9.2 测试覆盖

- 核心模块测试目录存在但内容待补充
- 缺少端到端测试示例

### 9.3 扩展性

- 目前仅 Telegram 启动器
- 可扩展其他平台（Discord、Slack、微信等）
- 支持 Webhook 模式（当前仅轮询）

---

## 10. 总结

### 10.1 项目定位

Kapybara 是一个**生产级 AI Agent 框架**，专注于：

1. **多渠道消息处理**（Channel-based routing）
2. **持久化记忆管理**（Folder-backed store）
3. **可容器化部署**（Docker + SSH）
4. **技能系统扩展**（Markdown-based skill docs）

### 10.2 适用场景

| 场景 | 适配度 | 说明 |
|------|--------|------|
| 个人 AI 助手 | ⭐⭐⭐⭐⭐ | 完整记忆 + 偏好系统 |
| 客服机器人 | ⭐⭐⭐⭐ | 多渠道支持 + 意图识别 |
| 自动化工作流 | ⭐⭐⭐⭐ | Bash 工具 + 技能创建 |
| 企业知识库 | ⭐⭐⭐ | 记忆检索 + 上下文管理 |

### 10.3 技术评价

| 维度 | 评分 | 说明 |
|------|------|------|
| **代码质量** | ⭐⭐⭐⭐ | 类型注解完整、docstring 规范 |
| **架构设计** | ⭐⭐⭐⭐⭐ | 模块化清晰、关注点分离 |
| **文档完善度** | ⭐⭐ | 缺少用户文档 |
| **可扩展性** | ⭐⭐⭐⭐ | 技能系统 + 启动器模式 |
| **生产就绪** | ⭐⭐⭐⭐ | Docker 部署 + 错误处理 |

---

## 附录 A：关键文件清单

| 文件路径 | 重要性 | 描述 |
|----------|--------|------|
| `core/src/k/agent/core/agent.py` | ⭐⭐⭐⭐⭐ | Agent 核心编排 |
| `core/src/k/agent/core/prompts.py` | ⭐⭐⭐⭐⭐ | 系统提示词定义 |
| `core/src/k/agent/memory/entities.py` | ⭐⭐⭐⭐ | 记忆记录结构 |
| `core/src/k/agent/memory/folder.py` | ⭐⭐⭐⭐ | 记忆存储实现 |
| `core/src/k/agent/channels.py` | ⭐⭐⭐⭐ | 频道工具函数 |
| `core/src/k/io_helpers/shell.py` | ⭐⭐⭐⭐ | Shell 会话管理 |
| `docs/concept/channel.md` | ⭐⭐⭐⭐ | 频道设计规范 |
| `AGENTS.md` | ⭐⭐⭐ | 开发规范 |
| `docker/basic-os/Dockerfile` | ⭐⭐⭐ | 容器构建 |

---

## 附录 B：命令速查

```bash
# 开发环境
cd core && pdm run fix
cd core && pdm run typecheck
cd core && pdm run test

# Docker 构建
./scripts/docker-build.sh

# Docker 启动
docker compose -f docker/docker-compose.yaml up

# 环境变量
export K_CONFIG_BASE=~/.kapybara
export K_SSH_USER=k
export K_SSH_ADDR=localhost
export K_SSH_PORT=2222
```

---

**调研时间：** 2026-03-01  
**调研来源：** `opensrc/repos/github.com/Sailfishc/Kapybara`  
**文档作者：** Qwen Code

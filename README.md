# Mnemonic

> 🧠 A local, cross-agent long-term memory engine for AI coding assistants.
> 🧠 一个本地化、跨 Agent 的 AI 编程助手长期记忆引擎。

[English](#english) · [中文](#中文)

---

## English

### What is Mnemonic?

Mnemonic watches the session transcripts produced by your AI coding agents
(Codex, Claude Code, Gemini, Amp, OpenCode, OpenClaw), distills them into
structured, durable memories, and builds a searchable knowledge base plus a
linked wiki. Any agent can later recall past decisions, bugs, fixes, and
patterns — so knowledge is no longer lost when a session ends.

Everything runs **locally**: SQLite for storage, an embedded vector index
(LanceDB or SQLite) for semantic search, and an OpenAI-compatible LLM for
extraction and synthesis.

### Key features

- **Multi-agent ingestion** — parses Codex, Claude Code, Gemini, Amp, OpenCode,
  and OpenClaw sessions automatically.
- **Four-layer memory model**
  - `episodic` — specific events ("Fixed X on date Y")
  - `semantic` — factual knowledge ("Project uses library X")
  - `procedural` — how-to steps ("To deploy: do X then Y")
  - `insight` — generalizable patterns ("When X happens, Y is usually the cause")
- **Quality pipeline** — evaluate → extract → normalize → link → consolidate →
  reflect → verify → wiki, each stage checkpointed and fail-open.
- **Provenance & status** — every memory tracks source sessions and a status
  (`proposed` / `observed` / `verified` / `superseded`) used for salience decay.
- **Routine deduplication** — automatic cross-session near-duplicate merging
  (lexical + semantic), with insight salience guards to keep quality high.
- **Semantic search & Q&A** — `search` for hits, `query` for natural-language
  answers fused from memories and the wiki.
- **Interactive TUI** — browse the timeline, search, and inspect memory details.

### Architecture

```diagram
╭──────────────╮   sessions   ╭───────────────╮
│ AI agents    │─────────────▶│  Watcher      │
│ Codex/Claude │  .jsonl/.json│  (fs-watch)   │
│ Gemini/Amp…  │              ╰───────┬───────╯
╰──────────────╯                      │ ParsedSession
                                      ▼
                          ╭───────────────────────╮
                          │   Pipeline             │
                          │ evaluate→extract→      │
                          │ normalize→link→        │
                          │ consolidate→reflect→   │
                          │ verify→wiki            │
                          ╰───────────┬───────────╯
                                      │ Memory[]
                ╭─────────────────────┼─────────────────────╮
                ▼                     ▼                     ▼
        ╭──────────────╮     ╭──────────────╮      ╭──────────────╮
        │ SQLite +FTS  │     │ Vector index │      │ Markdown     │
        │ (memories)   │     │ Lance/SQLite │      │ wiki vault   │
        ╰──────────────╯     ╰──────────────╯      ╰──────────────╯
                │                     │                     │
                ╰─────────────────────┼─────────────────────╯
                                      ▼
                         search · query · TUI · skills
```

### Requirements

- [Bun](https://bun.sh) runtime
- An OpenAI-compatible LLM (ChatGPT OAuth or an API key)

### Install & setup

```bash
bun install
bun run setup        # interactive wizard: choose auth (OAuth / API key) & model
```

Verify everything is wired up:

```bash
bun run src/cli.ts doctor
```

### Usage

```bash
bun start            # start the background daemon (watch + process)
bun run dev          # same, with --watch reload
bun run tui          # launch the interactive terminal UI
```

Common CLI commands (`mnemonic <command>`):

| Command | Description |
|---|---|
| `start` | Start the background daemon |
| `tui` | Launch the interactive terminal UI |
| `setup` | First-time setup wizard |
| `status` / `stats` | Daemon status / memory statistics |
| `metrics --since 7d` | Recent pipeline quality metrics |
| `search <query>` | Search memories by text + embeddings |
| `query <question>` | Ask a natural-language question |
| `backfill [--reset]` | Re-process all watched sessions |
| `reindex` | Rebuild the vector embedding index |
| `optimize` | Maintenance sweep + dedup + vector optimize |
| `prune [--dry-run]` | Remove low-quality memories |
| `export <json\|markdown>` | Export all memories |
| `graph [fmt] [out]` | Export the memory relation graph |
| `paths` | Show all data/config file paths |
| `auth status` / `auth openai api-key` | Manage authentication |

### Authentication

Mnemonic supports ChatGPT OAuth (browser/headless) and manual API keys:

```bash
mnemonic auth openai browser     # browser OAuth login
mnemonic auth openai api-key     # configure an OpenAI-compatible API key
mnemonic auth status             # show current credentials
```

> If you see `HTTP 402 deactivated_workspace`, your ChatGPT/OpenAI workspace is
> deactivated (billing). Switch to an API key with `mnemonic auth openai api-key`.

### Configuration

Sensible defaults work out of the box. Override via environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_MODEL` | `gpt-4.1-mini` | Extraction/synthesis model |
| `OPENAI_API_KEY` | — | API key (if not using OAuth) |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API endpoint |
| `MNEMONIC_VECTOR_BACKEND` | `lancedb` | `lancedb` or `sqlite` |
| `MNEMONIC_DEDUPLICATE_SESSION_INTERVAL` | `25` | Sessions between auto-dedup runs |
| `MNEMONIC_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |

Run `mnemonic paths` to see where data, settings, and logs live (on macOS:
`~/Library/Application Support/Mnemonic`).

### Development

```bash
bun test             # run the test suite
bunx tsc --noEmit    # type-check
```

### Project layout

```
src/
  parsers/     session parsers per agent (codex, claude-code, gemini, amp, …)
  pipeline/    evaluate, ingest, normalize, link, consolidate, reflect, …
  storage/     sqlite, vector index, deduplicate, serialization
  llm/         prompts, schemas, OpenAI auth
  wiki/        markdown knowledge base (engine, index, query)
  tui/         interactive terminal UI (Ink/React)
  watcher/     filesystem watcher + backfill
docs/          design notes, improvement plans, optimization reports
tests/         unit tests
```

---

## 中文

### Mnemonic 是什么？

Mnemonic 会监听你的 AI 编程助手（Codex、Claude Code、Gemini、Amp、OpenCode、
OpenClaw）产生的会话记录，将其**提炼为结构化、可长期保留的记忆**，并构建可检索
的知识库与互链 wiki。之后任何 Agent 都能回忆起过去的决策、Bug、修复与模式——
会话结束后知识不再丢失。

所有处理**完全本地化**：SQLite 存储、内嵌向量索引（LanceDB 或 SQLite）做语义检索、
以及一个 OpenAI 兼容 LLM 负责提取与综合。

### 核心特性

- **多 Agent 接入** — 自动解析 Codex、Claude Code、Gemini、Amp、OpenCode、
  OpenClaw 的会话。
- **四层记忆模型**
  - `episodic`（情景）— 具体事件（"某日修复了 X"）
  - `semantic`（语义）— 事实知识（"项目使用 X 库"）
  - `procedural`（流程）— 操作步骤（"部署流程：先 X 再 Y"）
  - `insight`（洞察）— 可泛化的模式（"出现 X 时，通常是 Y 引起的"）
- **质量管道** — 评估 → 提取 → 归一化 → 关联 → 合并 → 反思 → 验证 → wiki，
  每一阶段独立 checkpoint 且 fail-open。
- **来源与状态** — 每条记忆记录来源会话与状态
  （`proposed` / `observed` / `verified` / `superseded`），用于显著度衰减。
- **常态化去重** — 自动合并跨会话的近重复记忆（词法 + 语义），并对 insight
  设置显著度下限以保证质量。
- **语义检索与问答** — `search` 返回命中，`query` 融合记忆与 wiki 给出自然语言回答。
- **交互式 TUI** — 浏览时间线、检索、查看记忆详情。

### 架构

```diagram
╭──────────────╮   会话记录   ╭───────────────╮
│ AI Agents    │─────────────▶│  监听器        │
│ Codex/Claude │  .jsonl/.json│  (fs-watch)   │
│ Gemini/Amp…  │              ╰───────┬───────╯
╰──────────────╯                      │ ParsedSession
                                      ▼
                          ╭───────────────────────╮
                          │   处理管道              │
                          │ 评估→提取→归一化→       │
                          │ 关联→合并→反思→         │
                          │ 验证→wiki              │
                          ╰───────────┬───────────╯
                                      │ Memory[]
                ╭─────────────────────┼─────────────────────╮
                ▼                     ▼                     ▼
        ╭──────────────╮     ╭──────────────╮      ╭──────────────╮
        │ SQLite +FTS  │     │ 向量索引      │      │ Markdown     │
        │（记忆）       │     │ Lance/SQLite │      │ wiki 仓库    │
        ╰──────────────╯     ╰──────────────╯      ╰──────────────╯
                │                     │                     │
                ╰─────────────────────┼─────────────────────╯
                                      ▼
                         search · query · TUI · 技能
```

### 运行要求

- [Bun](https://bun.sh) 运行时
- 一个 OpenAI 兼容 LLM（ChatGPT OAuth 或 API Key）

### 安装与配置

```bash
bun install
bun run setup        # 交互向导：选择认证方式（OAuth / API Key）与模型
```

检查环境是否就绪：

```bash
bun run src/cli.ts doctor
```

### 使用

```bash
bun start            # 启动后台守护进程（监听 + 处理）
bun run dev          # 同上，带 --watch 热重载
bun run tui          # 启动交互式终端界面
```

常用命令（`mnemonic <command>`）：

| 命令 | 说明 |
|---|---|
| `start` | 启动后台守护进程 |
| `tui` | 启动交互式终端界面 |
| `setup` | 首次配置向导 |
| `status` / `stats` | 守护进程状态 / 记忆统计 |
| `metrics --since 7d` | 近期管道质量指标 |
| `search <query>` | 按文本 + 向量检索记忆 |
| `query <question>` | 自然语言提问 |
| `backfill [--reset]` | 重新处理所有已监听会话 |
| `reindex` | 重建向量嵌入索引 |
| `optimize` | 维护扫描 + 去重 + 向量优化 |
| `prune [--dry-run]` | 清除低质量记忆 |
| `export <json\|markdown>` | 导出全部记忆 |
| `graph [fmt] [out]` | 导出记忆关系图 |
| `paths` | 显示所有数据/配置路径 |
| `auth status` / `auth openai api-key` | 管理认证 |

### 认证

支持 ChatGPT OAuth（浏览器/设备码）与手动 API Key：

```bash
mnemonic auth openai browser     # 浏览器 OAuth 登录
mnemonic auth openai api-key     # 配置 OpenAI 兼容 API Key
mnemonic auth status             # 查看当前凭据
```

> 若出现 `HTTP 402 deactivated_workspace`，说明你的 ChatGPT/OpenAI 工作区被停用
> （计费问题）。可用 `mnemonic auth openai api-key` 切换为 API Key。

### 配置项

开箱即用，可通过环境变量覆盖：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `LLM_MODEL` | `gpt-4.1-mini` | 提取/综合所用模型 |
| `OPENAI_API_KEY` | — | API Key（不用 OAuth 时） |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API 地址 |
| `MNEMONIC_VECTOR_BACKEND` | `lancedb` | `lancedb` 或 `sqlite` |
| `MNEMONIC_DEDUPLICATE_SESSION_INTERVAL` | `25` | 自动去重的会话间隔 |
| `MNEMONIC_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |

运行 `mnemonic paths` 可查看数据、设置与日志的位置（macOS 上为
`~/Library/Application Support/Mnemonic`）。

### 开发

```bash
bun test             # 运行测试
bunx tsc --noEmit    # 类型检查
```

### 目录结构

```
src/
  parsers/     各 Agent 的会话解析器（codex、claude-code、gemini、amp 等）
  pipeline/    评估、提取、归一化、关联、合并、反思 ……
  storage/     sqlite、向量索引、去重、序列化
  llm/         提示词、schema、OpenAI 认证
  wiki/        markdown 知识库（引擎、索引、查询）
  tui/         交互式终端界面（Ink/React）
  watcher/     文件系统监听 + 历史回填
docs/          设计文档、改进计划、优化报告
tests/         单元测试
```

---

> **Note / 说明**：Mnemonic stores everything locally and never uploads your
> session data anywhere except to the LLM endpoint you configure.
> Mnemonic 全程本地存储，除你配置的 LLM 端点外不会上传任何会话数据。

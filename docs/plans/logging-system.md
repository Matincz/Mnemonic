# Mnemonic 日志系统实现规范

> 执行者：Codex
> 仓库：`~/Desktop/Mnemonic`（即当前 cwd）
> 分支命名：`feat/logging-system`
> 目标：为 Mnemonic 增加完整的日志系统，保留最近 7 天日志，零外部依赖。

---

## 1. 背景与现状

当前项目**没有真正的日志系统**：

- `console.log/error` 散落在 7 个文件（`src/index.ts`, `src/cli.ts`, `src/watcher/index.ts`, `src/watcher/fs-watcher.ts`, `src/pipeline/ingestor.ts`, `src/pipeline/wiki-ingestor.ts`, `src/pipeline/index.ts`）。
- `src/ipc/runtime.ts` 的 `RuntimeIPC.emit()` 仅写 4 类事件到 `events.ndjson`，且**只记录 `session-skipped`/`session-error`，不记录成功事件**。
- LLM 调用（`src/llm/index.ts`）无任何记录，调试 Qwen3.5-9B 等本地模型的提取质量极困难。
- 关闭终端就丢失全部日志。

## 2. 目标

| 编号 | 需求 |
|---|---|
| G1 | 提供分级 logger（`debug` / `info` / `warn` / `error`），可通过环境变量 `MNEMONIC_LOG_LEVEL` 调整 |
| G2 | 文本日志按天 rotate：`mnemonic-YYYY-MM-DD.log` |
| G3 | LLM 调用专项日志（NDJSON）：`llm-YYYY-MM-DD.ndjson`，每行一次调用 |
| G4 | Pipeline 阶段日志（NDJSON）：`pipeline-YYYY-MM-DD.ndjson`，记录每个 session 的处理生命周期 |
| G5 | **保留最近 7 天**：启动时清理超过 7 天的日志文件，运行中每次 rotate 也清理一次 |
| G6 | 控制台镜像：默认在终端继续打印 `info` 及以上（保持现有用户体验），通过 `MNEMONIC_LOG_CONSOLE=false` 关闭 |
| G7 | 修复 `RuntimeIPC.emit` 的成功路径漏写 bug：成功 ingest 时也要 emit `session-processed` 事件 |
| G8 | 提供 `mnemonic logs` CLI 子命令查看日志 |
| G9 | **零新增 npm 依赖**（使用 Node 内置 `fs`、`path`） |

## 3. 文件布局（最终态）

### 新增

```
src/
  logger.ts                  # 核心 logger 模块（单例）
  llm/
    log.ts                   # LLM 调用日志包装器
```

### 修改

```
src/
  app-paths.ts               # 增加 logsDir 路径
  config.ts                  # 暴露日志相关配置
  cli.ts                     # 替换 console.log；新增 logs 子命令
  index.ts                   # 替换 console.error
  ipc/runtime.ts             # 修复成功事件漏写
  llm/index.ts               # 在 llmGenerate / llmGenerateJSON 内部接入 LLM logger
  pipeline/index.ts          # 替换 console.log，并 emit pipeline-stage 日志
  pipeline/ingestor.ts       # 替换 console.log
  pipeline/wiki-ingestor.ts  # 替换 console.log
  watcher/index.ts           # 替换 console.log
  watcher/fs-watcher.ts      # 替换 console.log
```

### 测试

```
tests/
  logger.test.ts             # logger 行为 + rotate + 7 天清理
  llm-log.test.ts            # LLM 日志格式 + 截断 + 失败记录
```

## 4. 详细设计

### 4.1 路径

在 `src/app-paths.ts` 增加：

```ts
logsDir: path.join(dataRoot, "logs")
```

实际目录：`~/Library/Application Support/Mnemonic/logs/`

### 4.2 配置

在 `src/config.ts` 暴露：

```ts
logsDir: string
logLevel: "debug" | "info" | "warn" | "error"   // default "info"
logRetentionDays: number                          // default 7
logConsole: boolean                               // default true
```

环境变量优先级最高：
- `MNEMONIC_LOG_LEVEL`
- `MNEMONIC_LOG_RETENTION_DAYS`
- `MNEMONIC_LOG_CONSOLE` (`true|false|0|1`)

### 4.3 核心 Logger（`src/logger.ts`）

API：

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  component?: string;       // 例如 "pipeline" / "watcher"
  logsDir?: string;
  level?: LogLevel;
  console?: boolean;
  retentionDays?: number;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(component: string): Logger;
}

export function getLogger(component?: string): Logger;
export function configureLogger(opts: LoggerOptions): void;
export function flushLogger(): void;          // 测试用：同步刷盘
export function purgeOldLogs(): void;         // 立即触发清理
```

文本行格式：

```
2026-05-11T12:34:56.789Z INFO [pipeline] Extracting memories... | sessionId=codex-019e081c-95ad source=codex
```

- 时间戳：ISO-8601 UTC（与现有 `events.ndjson` 一致）
- meta 字段以 `key=value` 拼接，值含空格用双引号包裹；嵌套对象用 `JSON.stringify` 紧凑格式

写入策略：
- 同步 `appendFileSync`（与 `RuntimeIPC` 保持一致，避免引入异步队列复杂度）
- 文件名：`mnemonic-YYYY-MM-DD.log`，按本地时区切分日期
- 每次写入前检查日期，跨天则切换目标文件

清理：
- `configureLogger` 初始化时执行一次 `purgeOldLogs`
- 每次切换日期文件时再执行一次
- 删除条件：文件名解析出的日期 < `today - retentionDays + 1`（即保留今天 + 前 6 天，共 7 天）
- 同时清理 `mnemonic-*.log`、`llm-*.ndjson`、`pipeline-*.ndjson`

控制台镜像：
- `console=true` 时，等级 ≥ 配置 level 的消息同时通过 `process.stdout.write`（`error`/`warn` 走 `process.stderr.write`）输出，格式与文件一致，但**保留现有的 `[component]` 前缀风格**以兼容用户视觉记忆

### 4.4 LLM 调用日志（`src/llm/log.ts`）

每次 `llmGenerate` 或 `llmGenerateJSON` 调用记一条 NDJSON：

```json
{
  "ts": "2026-05-11T12:34:56.789Z",
  "model": "qwen3.5-9b-mlx-4bit",
  "baseURL": "http://localhost:10240/v1",
  "authMode": "api",
  "kind": "json",                      // "text" | "json" | "oauth"
  "schema": "RawMemorySchema",         // 仅 json 模式有；从 Zod schema 名推断或调用方传入
  "promptChars": 4821,
  "promptPreview": "...前 800 字符...",
  "responseChars": 1543,
  "responsePreview": "...前 800 字符...",
  "durationMs": 8421,
  "ok": true,
  "error": null,                        // 失败时填错误消息
  "errorRaw": null,                     // 失败时填模型原始返回（用于排查 zod 失败）
  "callerComponent": "ingestor"         // 调用方传入或栈推断
}
```

实现方式：
- 在 `src/llm/index.ts` 的 `llmGenerate` / `llmGenerateJSON` 内部包裹 try/finally
- 提供可选 `LlmCallOptions.component?: string` 让 pipeline 各阶段（ingestor、linker、consolidator、reflector、evaluator）传入身份标识
- prompt / response 截断阈值：常量 `LLM_LOG_PREVIEW_CHARS = 800`，但同时记录完整字符长度
- **失败时（zod 失败、网络错误、HTTP 非 2xx）必须记录原始模型输出 `errorRaw`**——这是修复"过去看不到 over-escape JSON"问题的关键

### 4.5 Pipeline 阶段日志

在 `src/pipeline/index.ts` 主入口为每个 session 创建一个 `traceId`（用 `nanoid`，已在依赖里）：

每个阶段开始/结束都写一行到 `pipeline-YYYY-MM-DD.ndjson`：

```json
{"ts":"...","traceId":"abc123","sessionId":"codex-...","stage":"evaluate","event":"start"}
{"ts":"...","traceId":"abc123","sessionId":"codex-...","stage":"evaluate","event":"end","durationMs":1234,"result":"skipped","reason":"..."}
{"ts":"...","traceId":"abc123","sessionId":"codex-...","stage":"extract","event":"end","durationMs":8421,"memoryCount":8}
{"ts":"...","traceId":"abc123","sessionId":"codex-...","stage":"link","event":"end","durationMs":4231}
{"ts":"...","traceId":"abc123","sessionId":"codex-...","stage":"consolidate","event":"end","durationMs":3120}
{"ts":"...","traceId":"abc123","sessionId":"codex-...","stage":"reflect","event":"end","durationMs":2890}
{"ts":"...","traceId":"abc123","sessionId":"codex-...","stage":"wiki-ingest","event":"end","durationMs":1530}
```

阶段名建议：`evaluate | extract | normalize | link | consolidate | reflect | propagate-verification | wiki-ingest`。

### 4.6 修复 `RuntimeIPC.emit` 成功路径

阅读 `src/pipeline/index.ts` 的 `processSession`（或类似主流程函数），找到当前只在 skip/error 时调用 `ipc.emit` 的位置。在成功 ingest 完成后追加：

```ts
ipc.emit({
  kind: "session-processed",
  timestamp: new Date().toISOString(),
  message: `Processed ${filePath}`,
  sessionId,
  source,
  memoryCount: memories.length,
});
```

同时更新 `writeStatus`，将 `lastError` 在成功场景清空（设为 `undefined`）以避免 stale 错误一直显示。

### 4.7 CLI：`mnemonic logs` 子命令

在 `src/cli.ts` 新增：

```
mnemonic logs                  # 默认 tail 最近 100 行 mnemonic-YYYY-MM-DD.log
mnemonic logs -n 500           # 自定义行数
mnemonic logs --llm            # 改为查看 llm-YYYY-MM-DD.ndjson
mnemonic logs --pipeline       # 改为查看 pipeline-YYYY-MM-DD.ndjson
mnemonic logs --follow         # 类似 tail -f（轮询 1s）
mnemonic logs --date 2026-05-10
mnemonic logs --level warn     # 仅显示 warn/error（仅对文本日志生效）
mnemonic logs --path           # 打印日志目录路径后退出
```

输出 NDJSON 时使用人类友好格式（自动美化关键字段：ts, stage, durationMs, error）。

### 4.8 console.log 替换映射

| 文件 | 现有调用 | 替换为 |
|---|---|---|
| `src/index.ts` | `console.error(...)` | `getLogger("bootstrap").error(...)` |
| `src/cli.ts` | `console.log(...)` | `getLogger("cli").info(...)` 或保留（如果是命令直接输出，给用户看的不算日志，**保留 console**） |
| `src/watcher/index.ts` | `console.log("[watcher] ...")` | `getLogger("watcher").info(msg, meta)` |
| `src/watcher/fs-watcher.ts` | 同上 | `getLogger("watcher").debug(...)` |
| `src/pipeline/index.ts` | `console.log("[pipeline] ...")` | `getLogger("pipeline").info(...)` |
| `src/pipeline/ingestor.ts` | 同上 | `getLogger("pipeline.ingestor").info(...)` |
| `src/pipeline/wiki-ingestor.ts` | 同上 | `getLogger("pipeline.wiki").info(...)` |

**判断准则**：
- 给最终用户看的命令输出（`mnemonic search` 结果、`mnemonic paths` 表格等）→ **保留 console**
- 后台运行状态、流程进度、错误诊断 → **改为 logger**

## 5. 测试要求

### 5.1 `tests/logger.test.ts`

- ✅ 不同 level 过滤正确（debug 在 info level 下不写入）
- ✅ 跨天自动切换文件名
- ✅ `purgeOldLogs` 删除 8 天前的 `mnemonic-*.log` / `llm-*.ndjson` / `pipeline-*.ndjson`，保留 7 天内文件
- ✅ meta 序列化：含空格的字符串加引号；对象走 JSON.stringify
- ✅ `child("foo.bar")` 继承配置，组件名拼接
- ✅ 控制台开关 `MNEMONIC_LOG_CONSOLE=false` 时不调用 stdout/stderr write

测试时使用临时目录 `path.join(os.tmpdir(), "mnemonic-test-logs-XXXX")`，每个用例独立目录。

### 5.2 `tests/llm-log.test.ts`

- ✅ 成功调用记录 `ok: true` + duration + preview 截断
- ✅ 失败调用（mock fetch 抛错或返回非 2xx）记录 `ok: false` + 错误消息 + errorRaw
- ✅ Zod 失败场景：mock LLM 返回 stringified-array，记录 errorRaw 为完整原文
- ✅ promptChars / responseChars 是真实长度（即使 preview 被截断）

### 5.3 现有测试不能 break

执行 `bun test` 全绿。

## 6. 验收清单

实施完成时，逐项验证：

```bash
# 1. 编译/类型检查通过
bun run src/cli.ts paths

# 2. 测试全绿
bun test

# 3. 新日志目录已创建
ls "$HOME/Library/Application Support/Mnemonic/logs/"
# 期望看到：mnemonic-YYYY-MM-DD.log

# 4. 启动后跑一个 session
bun run src/cli.ts start
# 终端能看到与之前类似的输出
# 同时 logs/ 下三个文件都有内容：
#   mnemonic-YYYY-MM-DD.log
#   llm-YYYY-MM-DD.ndjson
#   pipeline-YYYY-MM-DD.ndjson

# 5. CLI 子命令工作
mnemonic logs --path
mnemonic logs -n 20
mnemonic logs --llm -n 5
mnemonic logs --pipeline -n 5

# 6. 7 天清理：手动构造 8 天前的旧文件，重启 daemon 后验证被删除
touch -t $(date -v-8d +%Y%m%d0000) \
  "$HOME/Library/Application Support/Mnemonic/logs/mnemonic-2020-01-01.log"
# 重命名让日期解析触发删除
bun run src/cli.ts start  # 启动后该文件应被自动清理

# 7. 修复验证：events.ndjson 现在有 session-processed 事件
tail -5 "$HOME/Library/Application Support/Mnemonic/ipc/events.ndjson"
# 应能看到 kind: session-processed
```

## 7. 实施步骤建议（建议顺序）

1. 创建分支 `feat/logging-system`
2. 扩展 `src/app-paths.ts` 和 `src/config.ts`
3. 实现 `src/logger.ts` + 单测
4. 实现 `src/llm/log.ts`，接入 `src/llm/index.ts` + 单测
5. 在 `src/pipeline/index.ts` 添加 traceId 与阶段日志
6. 修复 `RuntimeIPC.emit` 成功路径漏写
7. 替换其余 `console.log` 调用
8. 实现 `mnemonic logs` 子命令
9. 跑全量验收清单（第 6 节）
10. 提交 PR / 待用户合并（不要执行 `git push --force` 或合并主分支）

## 8. 约束与边界

- **不要新增 npm 依赖**
- **不要修改 LLM prompt / schema**（不属于日志系统范围）
- **不要修改 evaluator 的 skip 逻辑**（这是另一个独立任务）
- **不要删除现有 `events.ndjson` / `status.json`**（保持向后兼容）
- 对 `console.log` 的替换中，凡是属于 CLI 给用户看的输出（例如 `mnemonic paths` 打印路径表）必须**保留 console**
- 跨天 rotate 检查的开销要小：每次写入只做一次 `Date()` 比较，不做 fs.stat
- 如果 `logsDir` 创建失败，logger 必须降级为仅输出到 console（不能让进程崩溃）

## 9. 提交要求

- 单一 PR / 单一分支
- Commit message 风格：常规英文短句即可，例如 `feat(logger): add daily-rotated logger with 7-day retention`
- 不要执行 `git push`，仅本地提交即可，等用户决定合并
- 不要修改 `package.json` 的依赖块

---

完成后请回复以下信息：
1. 分支名
2. 本地 commit 哈希列表
3. 第 6 节验收清单的实际执行结果（命令输出粘贴）
4. 任何偏离本文档的设计决策及理由

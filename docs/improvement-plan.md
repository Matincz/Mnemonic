# Mnemonic 改进计划

> 基于架构 review 整理的修改建议，按优先级分为三个阶段。

---

## P0 — 高优先级（提取质量 + 成本）

### 1. `truncateMessages` 改为首尾截取

**文件**: `src/llm/prompts.ts` L5-15

**现状**: 从头往后截取，长会话的结论性信息（决策、修复结果、最终方案）在尾部，被硬截断丢弃。

**改法**:

```ts
function truncateMessages(session: ParsedSession, maxChars = 12000): string {
  const all = session.messages.map((m) => `[${m.role}]: ${m.content}`);
  const total = all.reduce((n, line) => n + line.length, 0);

  if (total <= maxChars) {
    return all.join("\n\n");
  }

  // 保留前 2 条（上下文）+ 尾部尽可能多的消息
  const headCount = Math.min(2, all.length);
  const head = all.slice(0, headCount);
  const headLen = head.reduce((n, l) => n + l.length, 0);

  const tail: string[] = [];
  let tailLen = 0;
  const budget = maxChars - headLen - 20; // 20 for separator

  for (let i = all.length - 1; i >= headCount; i--) {
    if (tailLen + all[i].length > budget) break;
    tail.unshift(all[i]);
    tailLen += all[i].length;
  }

  if (tail.length === 0) {
    // 会话太长，至少保留最后一条的截断版本
    tail.push(all[all.length - 1].slice(-budget));
  }

  return [...head, "... (truncated) ...", ...tail].join("\n\n");
}
```

**预期收益**: 提取质量显著提升，尤其是长调试会话中的最终修复方案不再丢失。

---

### 2. Consolidator 批处理

**文件**: `src/pipeline/consolidator.ts`

**现状**: 对每个 memory 单独调用 `findRelatedMemories` + `llmGenerateJSON`，ingest 产出 N 条记忆就要 N 次 LLM 调用。

**改法**: 参照 `linker.ts` 的 `linkBatch` 模式，一次性将所有 memory + 候选打包发给 LLM。

```ts
// 核心变更思路
export async function consolidate(memories: Memory[], storage: Storage): Promise<Memory[]> {
  // 1. 批量查找候选
  const candidatesByMemory = await Promise.all(
    memories.map((m) =>
      storage.findRelatedMemories(m, {
        limit: 5,
        layers: ["semantic", "procedural", "insight"],
      }).then((results) => results.map((r) => r.memory).filter((c) => c.id !== m.id))
    ),
  );

  // 2. 过滤出有候选的 memory
  const items = memories
    .map((memory, i) => ({ memory, candidates: candidatesByMemory[i] ?? [] }))
    .filter((item) => item.candidates.length > 0);

  if (items.length === 0) return memories;

  // 3. 一次 LLM 调用处理所有 memory
  const results = await llmGenerateJSON<BatchConsolidationResult[]>(
    consolidateBatchPrompt(items),
  );

  // 4. 应用结果（逻辑同现有单条处理）
  // ...
}
```

**新增 prompt**: `consolidateBatchPrompt` — 与 `linkBatchPrompt` 结构类似，多个 memory 用 `---` 分隔。

**预期收益**: LLM 调用次数从 O(n) 降为 O(1)，典型场景节省 5-10 次调用。

---

### 3. Salience 时间衰减

**文件**: `src/storage/index.ts`（搜索排序层）

**现状**: `salience` 仅在 ingest 时赋值，永不变化。旧记忆和新记忆以相同权重参与排序。

**改法**: 在检索时计算 effective salience，不修改存储值（保留原始 LLM 判断）。

```ts
// src/storage/index.ts — 新增工具函数
function effectiveSalience(memory: Memory, halfLifeDays = 90): number {
  const ageMs = Date.now() - new Date(memory.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const decay = Math.pow(0.5, ageDays / halfLifeDays);

  // insight / procedural 层衰减更慢
  const layerBoost = memory.layer === "episodic" ? 1 : 0.5;

  return memory.salience * (1 - layerBoost + layerBoost * decay);
}
```

应用位置：
- `fuseHits` 中的 `hit.memory.salience * 0.05` 替换为 `effectiveSalience(hit.memory) * 0.05`
- `rankResults` 中加入 salience 加权

**预期收益**: 检索结果自然偏向近期记忆，episodic 记忆 90 天后权重减半，semantic/procedural 衰减更缓。

---

## P1 — 中优先级（检索质量 + 可靠性）

### 4. `findRelatedMemories` 搜索策略优化

**文件**: `src/storage/index.ts` L137-143

**现状**: 用 `memory.tags.join(" ")` 做 FTS5 搜索，tags 是短词（如 `auth`, `config`），匹配过于宽泛。

**改法**:

```ts
// 改为使用 title + summary 做文本搜索
const queryText = [memory.title, memory.summary].filter(Boolean).join(" ");
const textMatches = this.searchText(queryText, Math.max(limit * 4, 20))
  .filter((candidate) => candidate.id !== memory.id)
  .filter((candidate) => (options.layers ? options.layers.includes(candidate.layer) : true));
```

**预期收益**: 候选集质量提升，减少 Linker/Consolidator 的 LLM 噪声输入。

---

### 5. Reflect 阶段注入历史上下文

**文件**: `src/pipeline/reflector.ts`

**现状**: 只看当前 batch 的 memory，无法发现跨会话模式。

**改法**:

```ts
export async function reflect(memories: Memory[], storage: Storage): Promise<Memory[]> {
  if (memories.length < 2) return [];

  // 注入最近的高 salience 历史 insight，提供跨会话上下文
  const recentInsights = storage.listByLayer("insight", 5);
  const recentSemantic = storage.listByLayer("semantic", 5);
  const context = [...recentInsights, ...recentSemantic]
    .filter((m) => !memories.some((cur) => cur.id === m.id));

  const insights = await llmGenerateJSON<RawInsight[]>(
    reflectPrompt(memories, context), // prompt 增加 HISTORICAL CONTEXT 区块
  );
  // ...
}
```

**prompt 调整**: 在 `reflectPrompt` 末尾增加：

```
HISTORICAL CONTEXT (recent durable memories for cross-session pattern detection):
${contextBlock}

- Use historical context to detect patterns that span multiple sessions.
- Do not simply restate historical context as new insights.
```

**预期收益**: 能够发现 "这个项目反复出现 X 问题" 之类的跨会话 insight。

---

### 6. Wiki ingest 传入已有页面内容

**文件**: `src/pipeline/wiki-ingestor.ts`

**现状**: `action: "update"` 时 LLM 只看到 index 目录（标题列表），不知道已有页面写了什么，无法真正 merge。

**改法**:

```ts
export async function wikiIngest(
  session: ParsedSession,
  engine: WikiEngine,
  indexManager: IndexManager,
  log: WikiLog,
  registry: EntityRegistry,
): Promise<WikiOperation[]> {
  const indexContent = indexManager.getIndex();
  const schemaContent = generateSchema();

  // 新增：收集现有页面摘要供 LLM 参考
  const existingPages = collectExistingPageSummaries(engine, indexContent);

  const operations = await llmGenerateJSON<WikiOperation[]>(
    wikiIngestPrompt(session, schemaContent, indexContent, existingPages),
  );
  // ...
}

function collectExistingPageSummaries(engine: WikiEngine, indexContent: string): string {
  // 从 index 解析出所有 type/slug，读取每个页面的前 500 字符
  // 控制 token 预算，只传摘要
}
```

**预期收益**: Wiki 更新时能保留已有信息，避免新 session 覆盖旧内容。

---

### 7. LLM 调用改用 Structured Output

**文件**: `src/llm/index.ts`

**现状**: `llmGenerateJSON` 先生成自由文本，再用 `extractJSONFromText` 暴力提取 JSON。该函数内层有 O(n²) 的回退逻辑。

**改法**: 使用 AI SDK 的 `generateObject` + Zod schema：

```ts
import { generateObject } from "ai";

export async function llmGenerateJSON<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
): Promise<T> {
  const settings = loadSettings();
  const openai = createApiClient(settings);

  const { object } = await generateObject({
    model: openai(getChatModel(settings)),
    prompt,
    schema,
    temperature: 0.3,
  });

  return object;
}
```

**影响范围**: 所有调用 `llmGenerateJSON` 的地方需要传入对应的 Zod schema。好在 `types.ts` 已有 `MemorySchema`，其他 schema 需要新增。

**需要新增的 schema 定义**:

```ts
// src/llm/schemas.ts
export const EvalResultSchema = z.object({
  worth_remembering: z.boolean(),
  reason: z.string(),
  estimated_layers: z.array(z.enum(["episodic", "semantic", "procedural", "insight"])),
});

export const RawMemorySchema = z.array(z.object({
  layer: z.enum(["episodic", "semantic", "procedural", "insight"]),
  title: z.string(),
  summary: z.string(),
  details: z.string(),
  tags: z.array(z.string()),
  salience: z.number(),
}));

// ... LinkResult, ConsolidationResult, RawInsight, WikiOperation
```

**注意**: OAuth 模式走的是自定义 `fetch`，不经过 AI SDK，需单独处理或统一到 AI SDK 的 custom provider。

**预期收益**: 消除 JSON 提取失败，减少 prompt 中的 "JSON only" 指令 token。

---

## P2 — 低优先级（架构治理）

### 8. Pipeline Stage Checkpoint

**文件**: `src/pipeline/index.ts` + `src/storage/sqlite.ts`

**现状**: Pipeline 无中间状态持久化，LLM 调用失败时整个 session 处理丢失，需重新从头开始。

**改法**:

```sql
-- 新增 pipeline_checkpoints 表
CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
  session_id TEXT NOT NULL,
  stage TEXT NOT NULL,        -- evaluating | ingesting | linking | ...
  payload TEXT NOT NULL,       -- JSON 序列化的阶段输出
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, stage)
);
```

```ts
// pipeline/index.ts — 每个阶段完成后写 checkpoint
const extracted = await ingest(session);
storage.db.saveCheckpoint(session.id, "ingesting", extracted);

// 失败恢复时检查最后完成的 stage，从下一阶段继续
```

**预期收益**: 长 pipeline 中间失败可恢复，避免重复 LLM 调用。

---

### 9. `loadConfig()` 统一注入

**文件**: 多处（`storage/index.ts`, `storage/vector.ts`, `embeddings/index.ts`, `llm/index.ts`）

**现状**: `loadConfig()` 在构造函数和方法内被隐式调用至少 4 次，每次都重新读取环境变量和解析路径。

**改法**: 通过 `AppContext` 依赖注入：

```ts
// Storage 构造函数接受 config
export class Storage {
  constructor(options: StorageOptions & { config: Config }) {
    this.db = new MemoryDB(options.dbPath ?? options.config.sqlitePath);
    // ...
  }
}
```

所有组件从 `createApp()` 获取统一的 config 实例，消除隐式全局状态。

---

### 10. `saveMemories` + `markProcessed` 事务化

**文件**: `src/pipeline/index.ts`, `src/watcher/index.ts`

**现状**: 记忆保存和文件标记为已处理是两个独立操作，中间崩溃可能导致重复处理或记忆丢失。

**改法**:

```ts
// src/storage/sqlite.ts
withTransaction(fn: () => void) {
  this.db.exec("BEGIN");
  try {
    fn();
    this.db.exec("COMMIT");
  } catch (e) {
    this.db.exec("ROLLBACK");
    throw e;
  }
}
```

在 `watcher/index.ts` 的 `handleSession` 中：

```ts
storage.db.withTransaction(() => {
  for (const memory of result.memories) {
    storage.db.upsertMemory(memory);
  }
  storage.db.markFileProcessed(key, hash, session.id);
});
// 向量索引和 vault 写入放在事务外（非关键路径）
```

---

### 11. `rowToMemory` 去重

**文件**: `src/storage/sqlite.ts` L210, `src/storage/vector.ts` L638

**现状**: 两个文件各有一份几乎一样的 `rowToMemory` 函数。

**改法**: 提取到 `src/storage/serialize.ts` 共享：

```ts
// src/storage/serialize.ts
export function rowToMemory(row: MemoryRow): Memory { ... }
export interface MemoryRow { ... }  // 统一行类型
```

---

### 12. `hasEmbeddingProvider` 结果缓存

**文件**: `src/embeddings/index.ts` L73

**现状**: 每次搜索调用 `hasEmbeddingProvider()` → `loadSettings()` → 读文件解析 JSON。

**改法**:

```ts
let cachedHasProvider: boolean | null = null;

export function hasEmbeddingProvider(settings: Settings | null = loadSettings()) {
  if (cachedHasProvider !== null) return cachedHasProvider;
  cachedHasProvider = resolveEmbeddingConfig(settings) !== null;
  return cachedHasProvider;
}

export function invalidateEmbeddingCache() {
  cachedHasProvider = null;
}
```

在 `setup` / `auth` 命令后调用 `invalidateEmbeddingCache()`。

---

## 实施顺序建议

```
Week 1:  #1 truncateMessages 首尾截取
         #3 salience 时间衰减
Week 2:  #2 consolidator 批处理
         #4 findRelatedMemories 搜索策略
Week 3:  #5 reflect 注入历史
         #6 wiki ingest 传入已有内容
Week 4:  #7 structured output（影响面大，需统一改 prompt 签名）
Later:   #8-#12 架构治理，按需穿插
```

每个改动建议配套对应的 test case 验证。已有 59 个测试可作为回归基线。

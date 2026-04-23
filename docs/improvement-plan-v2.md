# Mnemonic 改进计划 v2

> 基于 v1 落地后的二次架构 review，聚焦**提取语义正确性**和**架构韧性**。
> v1 中的 truncation、batch consolidation、structured output、checkpoint、salience decay 等已实现，不再重复。

---

## P0 — 提取质量核心问题

### 1. Memory 增加 provenance 与 status 语义

**文件**: `src/types.ts`, `src/storage/sqlite.ts`, `src/storage/serialize.ts`

**现状**:
- `Memory` 只记录单一 `sourceSessionId` / `sourceAgent`，consolidator `update-existing` 时覆盖旧来源
- `effectiveSalience` 用 `createdAt` 做衰减，但被 consolidate 刷新过的持久记忆仍按原始时间衰减，导致活跃知识被错误降权
- 无法区分 "assistant 建议但未验证" 与 "用户确认已生效" 的记忆

**改法**:

```ts
// src/types.ts — 新增字段
export const MemorySchema = z.object({
  // ...existing fields...
  updatedAt: z.string().datetime(),                    // consolidate/update 时刷新
  status: z.enum(["proposed", "observed", "verified", "superseded"]),
  sourceSessionIds: z.array(z.string()),               // 所有贡献 session
  supportingMemoryIds: z.array(z.string()),            // 证据链
});
```

```sql
-- src/storage/sqlite.ts — migrate 新增列
ALTER TABLE memories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'observed';
ALTER TABLE memories ADD COLUMN source_session_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE memories ADD COLUMN supporting_memory_ids TEXT NOT NULL DEFAULT '[]';
```

**Pipeline 各阶段配套变更**:

| 阶段 | 变更 |
|------|------|
| `ingestor.ts` | 新记忆 `updatedAt = createdAt`, `status = "observed"`, `sourceSessionIds = [session.id]`, `supportingMemoryIds = []` |
| `consolidator.ts` `update-existing` | `updatedAt = now`, 合并 `sourceSessionIds`, 累加 `supportingMemoryIds` 含原始 memory id |
| `consolidator.ts` `create-synthesis` | `sourceSessionIds` 合并所有参与记忆的来源, `supportingMemoryIds` 含所有参与 memory id |
| `reflector.ts` | insight 的 `supportingMemoryIds` = 所有被反思的 memory id |
| `storage/index.ts` | `effectiveSalience` 对持久层使用 `updatedAt` 而非 `createdAt` 做衰减; `status = "proposed"` 降权 0.3 倍, `status = "superseded"` 降权 0.1 倍 |

**Prompt 变更** (`src/llm/prompts.ts`):

在 `ingestPrompt` 的 Guidelines 末尾增加:

```
- do not store assistant suggestions as durable semantic/procedural memories unless the transcript shows they were applied, confirmed, tested, or adopted by the user
- set status to "proposed" for unverified suggestions, "observed" for facts seen in the transcript, "verified" for outcomes confirmed by test/build/deploy results
```

**预期收益**: 记忆的语义正确性显著提升；持久知识被刷新后不再错误衰减；可按 status 过滤低质量记忆。

---

### 2. Ingest 后增加 Normalize/QA 阶段

**文件**: 新建 `src/pipeline/normalizer.ts`, 修改 `src/pipeline/index.ts`

**现状**:
- `ingestPrompt` 鼓励 "slightly over-extract"，产出直接进入 linker
- 同一 session 可能产出近义标题、summary ≈ title 的薄记忆、空 details 的条目
- 下游 linker/consolidator 为这些噪声付出额外 LLM 调用和错误关联代价

**改法**:

```ts
// src/pipeline/normalizer.ts — 纯 deterministic，不调用 LLM
export function normalize(memories: Memory[]): Memory[] {
  let result = memories;

  // 1. 去除 details 为空或与 summary 几乎一致的薄记忆
  result = result.filter((m) => {
    if (!m.details.trim()) return false;
    if (textSimilarity(m.summary, m.details) > 0.9) return false;
    if (textSimilarity(m.title, m.summary) > 0.9 && m.details.length < 50) return false;
    return true;
  });

  // 2. 合并近义标题（Jaccard > 0.8 的 token 集合）
  result = mergeNearDuplicates(result);

  // 3. 降级弱 semantic/procedural → episodic
  result = result.map((m) => {
    if (
      (m.layer === "semantic" || m.layer === "procedural") &&
      m.salience < 0.4 &&
      m.details.length < 80
    ) {
      return { ...m, layer: "episodic" };
    }
    return m;
  });

  return result;
}
```

**Pipeline 集成**:

```ts
// src/pipeline/index.ts — 在 ingest 和 link 之间插入
const extracted = await runStage(storage, session.id, "ingesting", () => ingest(session));
const normalized = normalize(extracted);  // ← 新增，无 LLM 调用
const linked = await runStage(storage, session.id, "linking", () => linkBatch(normalized, storage));
```

注意: normalize 是 deterministic 的，不需要 checkpoint（输入相同则输出相同）。

**预期收益**: 减少 linker/consolidator 的噪声输入；降低重复 synthesis 的产生；不增加 LLM 成本。

---

### 3. 修复 Consolidator 同 target 多写竞争

**文件**: `src/pipeline/consolidator.ts`

**现状**:
同一 batch 中多条 memory 选择对同一 `target_id` 做 `update-existing` 时：
```ts
outputs.push({ ...existing, ...result1 });  // 第一次推入
outputs.push({ ...existing, ...result2 });  // 第二次推入，覆盖第一次
// dedupeById → last-write-wins，result1 的证据静默丢失
```

**改法**:

```ts
// 在 dedupeById 之前，按 target_id 分组合并
function mergeConsolidationOutputs(outputs: Memory[]): Memory[] {
  const grouped = new Map<string, Memory[]>();
  for (const memory of outputs) {
    const group = grouped.get(memory.id) ?? [];
    group.push(memory);
    grouped.set(memory.id, group);
  }

  return [...grouped.values()].map((versions) => {
    if (versions.length === 1) return versions[0]!;
    // 多版本合并：union tags, union links, 保留最丰富的 details, 取最高 salience
    return versions.reduce((merged, current) => ({
      ...merged,
      tags: Array.from(new Set([...merged.tags, ...current.tags])),
      linkedMemoryIds: Array.from(new Set([...merged.linkedMemoryIds, ...current.linkedMemoryIds])),
      contradicts: Array.from(new Set([...merged.contradicts, ...current.contradicts])),
      details: merged.details.length >= current.details.length ? merged.details : current.details,
      salience: Math.max(merged.salience, current.salience),
    }));
  });
}
```

在 `consolidate()` 的 return 替换:

```ts
return mergeConsolidationOutputs(outputs);  // 替代 dedupeById(outputs)
```

**预期收益**: 消除 consolidation 阶段的数据静默丢失；多证据源的知识合并更完整。

---

## P1 — 架构韧性

### 4. Reflect/Wiki 改为 fail-open enrichment

**文件**: `src/pipeline/index.ts`, `src/watcher/index.ts`

**现状**:
```
evaluate → ingest → link → consolidate → reflect → wiki-ingest
                                                         ↓
                                        watcher.recordProcessedSession()
```
6 个阶段全部成功后才持久化。reflect 或 wiki-ingest 的 LLM 失败 → 已 consolidate 的核心记忆丢失。

**改法**:

```ts
// src/pipeline/index.ts
export async function processSession(...): Promise<PipelineResult> {
  // ... evaluate, ingest, link, consolidate 同前 ...

  // ★ 核心记忆在此持久化
  await storage.saveMemories(consolidated);
  storage.markProcessed(key, hash, session.id);

  // ★ Enrichment 阶段 fail-open
  let insights: Memory[] = [];
  let wikiOps: PipelineResult["wikiOps"] = [];
  const warnings: string[] = [];

  try {
    insights = await runStage(storage, session.id, "reflecting", () => reflect(consolidated, storage));
    if (insights.length > 0) {
      await storage.saveMemories(insights);
    }
  } catch (err) {
    warnings.push(`reflect failed: ${err instanceof Error ? err.message : String(err)}`);
    log(`[pipeline] ⚠ Reflect failed, continuing: ${warnings.at(-1)}`);
  }

  try {
    const operations = await runStage(storage, session.id, "wiki", () =>
      wikiIngest(session, wiki.engine, wiki.index, wiki.log, wiki.registry),
    );
    wikiOps = operations.map((op) => ({ ... }));
  } catch (err) {
    warnings.push(`wiki-ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    log(`[pipeline] ⚠ Wiki ingest failed, continuing: ${warnings.at(-1)}`);
  }

  return {
    sessionId: session.id,
    stage: "done",
    memories: [...consolidated, ...insights],
    skipped: false,
    wikiOps,
    warnings,  // ← 新增字段
  };
}
```

`PipelineResult` 类型增加:
```ts
warnings?: string[];
```

**Watcher 配套变更**: `handleSession` 中核心持久化已在 pipeline 内完成，watcher 只需处理 checkpoint 清理和 IPC 事件。

**预期收益**: 核心记忆存储不再受辅助阶段影响；enrichment 失败可观测但不阻塞。

---

### 5. 检索候选 project 泄漏修复

**文件**: `src/storage/index.ts`

**现状**:
- `findRelatedMemoriesBatch` 中 text 分支不按 `project` 过滤，vector 分支会过滤
- 多项目场景下 linker/consolidator 看到错误项目的候选，产生跨项目误关联
- `rankResults` 丢弃了 FTS5 的 bm25 信号，用位置排序替代

**改法 5a — text 分支增加 project 过滤**:

```ts
// storage/index.ts findRelatedMemoriesBatch 中
const textMatches = this.searchText(buildRelatedMemoryQuery(memory), Math.max(limit * 4, 20))
  .filter((candidate) => candidate.id !== memory.id)
  .filter((candidate) => (options.layers ? options.layers.includes(candidate.layer) : true))
  .filter((candidate) => (!memory.project || !candidate.project || candidate.project === memory.project));
  //                      ^^^^^^^^^^^^^^^^ 新增：同 project 或无 project 标记时放行
```

**改法 5b — 保留 bm25 信号**:

```ts
// storage/sqlite.ts searchMemories 改为返回带 score 的结果
searchMemoriesWithScore(query: string, limit = 20): Array<{ memory: Memory; bm25: number }> {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  const rows = this.db.prepare(`
    SELECT m.*, bm25(memories_fts) as bm25_score
    FROM memories_fts f
    JOIN memories m ON m.id = f.memory_id
    WHERE memories_fts MATCH ?
    ORDER BY bm25(memories_fts), m.salience DESC
    LIMIT ?
  `).all(ftsQuery, limit);

  return rows.map((row) => ({
    memory: rowToMemory(row),
    bm25: Math.abs(row.bm25_score),  // bm25 返回负值，取绝对值
  }));
}
```

```ts
// storage/index.ts rankResults 使用实际 bm25
function rankResults(matches: Array<{ memory: Memory; bm25: number }>, limit: number) {
  const maxBm25 = Math.max(...matches.map((m) => m.bm25), 0.001);
  return matches.map((match) => ({
    memory: match.memory,
    score: (match.bm25 / maxBm25) * 0.8 + effectiveSalience(match.memory) * 0.2,
    reasons: ["keyword"],
  }));
}
```

**预期收益**: 消除跨项目误关联；fusion 排序更准确。

---

### 6. Wiki ingest 候选页面选择优化

**文件**: `src/pipeline/wiki-ingestor.ts`

**现状**:
- `collectExistingPageSummaries` 取前 20 条最近页面的摘要
- 对于 wiki 页面较多时，LLM 看到的是最近修改的页面而非与当前 session 最相关的页面
- wiki 页面无结构化溯源字段（`sourceMemoryIds`, `sourceSessionIds`）

**改法 6a — 基于 session 内容选择候选页面**:

```ts
export function collectExistingPageSummaries(engine: WikiEngine, session?: ParsedSession): string {
  const allPages = engine.listPages();
  let pages: WikiPage[];

  if (session && allPages.length > 20) {
    // 用 session 的 project + 关键词做粗过滤
    const sessionText = session.messages.map((m) => m.content).join(" ").toLowerCase();
    const scored = allPages.map((page) => ({
      page,
      score: scorePageRelevance(page, session.project, sessionText),
    }));
    scored.sort((a, b) => b.score - a.score);
    pages = scored.slice(0, 20).map((s) => s.page);
  } else {
    pages = allPages.slice(0, 20);
  }

  // ...同现有的摘要拼接逻辑
}

function scorePageRelevance(page: WikiPage, project: string | undefined, sessionText: string): number {
  let score = 0;
  if (project && page.tags.some((t) => t.toLowerCase() === project.toLowerCase())) score += 3;
  const titleTokens = page.title.toLowerCase().split(/\s+/);
  for (const token of titleTokens) {
    if (token.length > 3 && sessionText.includes(token)) score += 1;
  }
  for (const tag of page.tags) {
    if (sessionText.includes(tag.toLowerCase())) score += 0.5;
  }
  return score;
}
```

**改法 6b — wiki frontmatter 增加溯源**:

在 `wikiIngestPrompt` 的 frontmatter 要求中增加:
```
- frontmatter must include sourceSessionIds (array of session IDs that contributed to this page)
```

**预期收益**: wiki 更新时看到的是相关页面而非最近页面；减少重复页面；建立 wiki ↔ session 溯源链。

---

## P2 — 可选优化

### 7. LLM/Embedding 依赖注入统一

**文件**: `src/llm/index.ts`, `src/embeddings/index.ts`, `src/app.ts`

**现状**: `llmGenerate`/`llmGenerateJSON`/`embedTexts` 每次调用内部 `loadSettings()` + `loadConfig()`，隐式依赖全局状态。

**改法**: 在 `AppContext` 中创建 bound 版本:

```ts
// src/app.ts
export interface AppContext {
  config: Config;
  storage: Storage;
  wiki: WikiDeps;
  ipc: RuntimeIPC;
  llm: {
    generate: (prompt: string) => Promise<string>;
    generateJSON: <T>(prompt: string, schema: z.ZodType<T>) => Promise<T>;
  };
  embed: (input: string[]) => Promise<EmbeddingVector[]>;
}
```

Pipeline 各阶段函数签名增加 `llm` 参数而非直接 import `llmGenerateJSON`。测试时可注入 mock。

**预期收益**: 消除隐式全局状态；单元测试无需 mock 文件系统或环境变量。

---

### 8. SQLite 向量召回过度剪枝

**文件**: `src/storage/index.ts`

**现状**: SQLite backend 下语义搜索受 `candidateIds` 约束，由 keyword 命中 + salience 背景 id 组成。语义相关但词汇不匹配的记忆可能永远不被考虑。

**改法**: 根据语料规模动态决策:

```ts
private async getSemanticCandidateIds(...) {
  if (this.vectorStore.backend() === "lancedb") return undefined;

  const totalMemories = this.db.countMemories();
  if (totalMemories < 500) return undefined;  // ← 小语料全扫描

  // 大语料才做候选剪枝
  const backgroundIds = await this.vectorStore.listCandidateIds(Math.max(limit * 6, 64), options);
  return Array.from(new Set([...prioritizedIds, ...backgroundIds]));
}
```

**预期收益**: 小规模使用时语义召回更完整；大规模时保持性能。

---

## 实施顺序建议

```
Week 1:  #4 fail-open enrichment（最小改动，最大韧性收益）
         #3 consolidator 多写修复（纯 bug fix）

Week 2:  #2 normalize/QA 阶段（新文件，不影响现有代码）
         #5 检索 project 过滤 + bm25 信号保留

Week 3:  #1 provenance/status 语义（schema 变更，影响面最大）
         #6 wiki 候选页面优化

Later:   #7 DI 统一, #8 向量召回策略
```

每个改动需配套测试。当前 70 个测试作为回归基线。

---

## 与 v1 计划的关系

| v1 条目 | 状态 | 备注 |
|---------|------|------|
| #1 truncateMessages 首尾截取 | ✅ 已实现 | `prompts.ts` L5-41 |
| #2 Consolidator 批处理 | ✅ 已实现 | `consolidateBatchPrompt` + `BatchConsolidationResultSchema` |
| #3 Salience 时间衰减 | ✅ 已实现 | `effectiveSalience()` in `storage/index.ts` |
| #4 findRelatedMemories 搜索策略 | ✅ 已实现 | 使用 title+summary 查询 |
| #5 Reflect 注入历史上下文 | ✅ 已实现 | `reflectPrompt` 含 HISTORICAL CONTEXT |
| #6 Wiki ingest 传入已有内容 | ✅ 已实现 | `collectExistingPageSummaries` |
| #7 Structured Output | ✅ 已实现 | `generateObject` + Zod schema（API 模式）|
| #8 Pipeline Checkpoint | ✅ 已实现 | `pipeline_checkpoints` 表 + `runStage` |
| #9 loadConfig 统一注入 | ⚠️ 部分 | `Storage`/`AppContext` 已注入，`llm`/`embeddings` 仍隐式 |
| #10 事务化写入 | ✅ 已实现 | `withTransaction` + `recordProcessedSession` |
| #11 rowToMemory 去重 | ✅ 已实现 | `storage/serialize.ts` |
| #12 hasEmbeddingProvider 缓存 | ✅ 已实现 | `cachedHasProvider` + `invalidateEmbeddingCache` |

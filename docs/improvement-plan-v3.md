# Mnemonic 记忆质量改进执行计划 v3

> 编制日期：2026-05-02
> 目标：在 v2 已修复时间线、批内去重、salience prompt 等问题的基础上，进一步提升「记忆提取质量与逻辑」的精度与一致性。
> 受众：执行此计划的 AI agent。每一项均给出**改动文件、改动内容、判定方式、验收测试**。请按 P0 → P3 顺序实施，每完成一项跑一次 `bun test`。

---

## 全局约束

1. **不要破坏现有测试**：`bun test` 当前 93 pass。任何改动后必须仍然 pass。
2. **保持向后兼容**：`Memory` schema 字段不要删除/重命名；如需新增字段必须在 [src/types.ts](file:///Users/matincz/Desktop/Mnemonic/src/types.ts) 中加成 optional。
3. **不要替换 LanceDB / SQLite / better-sqlite3 等基础依赖**。
4. **每个 P 阶段都要补/改测试**。测试文件位置见各任务说明。
5. 修改后用以下命令验证：
   ```bash
   bun test
   bun run src/cli.ts paths        # 确认配置仍可加载
   ```

---

## P0：用 Embedding 余弦相似度替换 Jaccard（最重要）

### 背景
[textSimilarity](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/normalizer.ts#L35-L49) 用空格分词的 Jaccard，无法识别近义改写、跨语言、跨 tag 命名的同一事实。这是 ingestor / reflector / consolidator / deduplicate 共同的底层瓶颈。

### 任务 0.1 — 引入 cosine 相似度工具
**新增文件**：[src/pipeline/similarity.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/similarity.ts)

接口：
```typescript
export function cosineSimilarity(a: number[], b: number[]): number;

export interface SemanticSimilarityOptions {
  storage: Pick<Storage, "config">;
}

/** 返回 [-1, 1]；当 embedding 不可用时回退到 Jaccard，保证 0..1 单调可比 */
export async function semanticSimilarity(
  textA: string,
  textB: string,
  options?: SemanticSimilarityOptions,
): Promise<number>;

/** 批量版：一次性 embed 所有文本，避免 N² 次 LLM 请求 */
export async function batchPairwiseSimilarity(
  pairs: Array<[string, string]>,
  options?: SemanticSimilarityOptions,
): Promise<number[]>;
```

实现要点：
- 调用 [embedTexts](file:///Users/matincz/Desktop/Mnemonic/src/embeddings/index.ts#L102) 获取向量
- 对单次 dedup 决策（一条新记忆 vs N 个 candidate），用 1 次 embed 调用拿到 (1+N) 个向量再两两计算
- 当 `hasEmbeddingProvider()` 为 false 时回退到现有 [textSimilarity](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/normalizer.ts#L35-L49)（保留为 fallback）
- 不要在每条 ingest 调用都 cold-start：模块级缓存最近 200 个文本→vector 的 LRU

**测试**：[tests/pipeline/similarity.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/similarity.test.ts)
- mock embedding fetch，验证 cosine 计算
- 验证 fallback 路径（embedding 不可用时不报错）
- 验证 LRU 命中

### 任务 0.2 — Ingestor 去重切到 cosine
**改动文件**：[src/pipeline/ingestor.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts)

把 [findDuplicateCandidate](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts#L62-L90) 中的 `textSimilarity` 调用替换为 `semanticSimilarity`。新阈值：

| 判定 | 旧（Jaccard） | 新（cosine） |
|------|---------------|--------------|
| 高置信完全重复（直接合并） | title ≥ 0.9 | title ≥ 0.85 |
| 中等置信（需 layer + tag/project 兜底） | combined ≥ 0.7 + tagOverlap | combined ≥ 0.78 + (tagOverlap OR sameProject) |

新增**软兜底**：layer 不同但 cosine ≥ 0.92 时，**不合并但建立 linkedMemoryIds**（防止跨 layer 大量重复）。

**测试新增**（[tests/pipeline/ingestor.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/ingestor.test.ts)，可能需新建）：
- "Auth refresh token flow" 与 "JWT refresh handling" 在 mock 高 cosine 下被去重
- 不同 project 但相同标题的记忆**不应**合并（见 P2）

### 任务 0.3 — Normalizer / Reflector / Consolidator 同步
**改动文件**：
- [src/pipeline/normalizer.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/normalizer.ts) [isNearDuplicate](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/normalizer.ts#L90-L99)：批内去重也切到 cosine（阈值：title ≥ 0.8 或 combined ≥ 0.78）
- [src/pipeline/reflector.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/reflector.ts) [matchesExistingInsight](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/reflector.ts#L69-L81)：阈值改为 cosine ≥ 0.6（与 prompt "0.5" 描述对齐：cosine 0.6 ≈ Jaccard 0.4，但语义上更紧）
- [src/storage/deduplicate.ts](file:///Users/matincz/Desktop/Mnemonic/src/storage/deduplicate.ts)：精确 title 合并继续按字符串匹配；近似合并（v2 中的 0.78 阈值）改为 cosine ≥ 0.82

> **注意**：normalizer 在批内运行（同 session 几个 memory），不一定有 embedding（pipeline 早期）。允许 normalizer 仍用 Jaccard 作为快速预筛，cosine 仅在 embedding 已就绪时启用。判定方式：检查 `hasEmbeddingProvider()`。

---

## P0：Provenance 不丢失

### 背景
[mergeIntoExistingMemory](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts#L108-L125) 直接覆写 `sourceSessionId / sourceAgent`，导致 first-seen 来源信息丢失。

### 任务 0.4 — 保留 first-seen 来源
**改动**：在 `mergeIntoExistingMemory` 中：
```diff
- sourceSessionId: incoming.sourceSessionId,
- sourceAgent: incoming.sourceAgent,
+ sourceSessionId: existing.sourceSessionId,    // 保留首次来源
+ sourceAgent: existing.sourceAgent,
```
新来源已经会进入 `sourceSessionIds[]` 数组，不丢信息。

[src/pipeline/consolidator.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/consolidator.ts) 同样不要覆写 update-existing 的 `sourceSessionId / sourceAgent`（当前代码 spread `existing` 已正确保留，但请显式注释保护）。

**测试**：在 [tests/pipeline/ingestor.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/ingestor.test.ts) 中：
```typescript
it("preserves first-seen source when merging duplicates", () => {
  // existing.sourceAgent === "claude-code"; incoming.sourceAgent === "amp"
  // 合并后 sourceAgent 仍是 "claude-code", 但 sourceSessionIds 包含两者
});
```

---

## P1：Project 维度参与去重判定

### 背景
[hasTagOverlap](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts#L127-L134) 只看 tag。不同 project 中同名 procedure（如 "deploy steps"）会被错误合并。

### 任务 1.1 — Project 不一致作为合并的硬性否决
**改动**：[src/pipeline/ingestor.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts) `findDuplicateCandidate` 内增加：
```typescript
if (memory.project && candidate.project && memory.project !== candidate.project) {
  // 跨项目同名记忆：cosine 必须 ≥ 0.95 才合并；否则视为不同
  if (titleSimilarity < 0.95) continue;
}
```

同步修改 [storage.findRelatedMemoriesBatch](file:///Users/matincz/Desktop/Mnemonic/src/storage/index.ts#L144-L202)：当前已对 keyword 路径做了 `candidate.project === memory.project` 过滤；vector 路径也已用 `project: memory.project`。**确认两条路径都过滤**，并补一个测试：

**测试**（[tests/pipeline/ingestor.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/ingestor.test.ts)）：
```typescript
it("does not merge same-titled memories from different projects", () => {
  // existing.project = "iot", incoming.project = "code"
  // 标题相同 "Deployment procedure" → 不合并
});
```

---

## P1：Reflector 用语义检索取代时间窗口

### 背景
[reflect](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/reflector.ts#L18-L29) 历史 context = `listByLayer("insight", 20) + listByLayer("semantic", 5)`，按时间倒序。当语料 5000+ 条时，跨月同主题 insight 几乎不可能命中。

### 任务 1.2 — 历史 context 改为语义 top-k
**改动**：[src/pipeline/reflector.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/reflector.ts)

```typescript
// 旧
const recentInsights = storage.listByLayer("insight", 20);
const recentSemantic = storage.listByLayer("semantic", 5);

// 新
const related = await storage.findRelatedMemoriesBatch(memories, {
  limit: 8,
  layers: ["insight", "semantic"],
});
const contextSet = new Map<string, Memory>();
for (const hits of related) {
  for (const hit of hits) {
    if (memories.some((m) => m.id === hit.memory.id)) continue;
    contextSet.set(hit.memory.id, hit.memory);
  }
}
const context = [...contextSet.values()].slice(0, 25);
```

确保当 storage 没有 embedding 提供方时，仍 fallback 回时间窗口（`findRelatedMemoriesBatch` 内部已自动 fallback 到 keyword）。

**测试**：[tests/pipeline/reflector.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/reflector.test.ts) 中验证 `findRelatedMemoriesBatch` 被调用一次且参数正确。

---

## P1：Salience 事后归一化

### 背景
prompt 给了目标分布，但 LLM 实际不会自觉维持。当前 68.5% 集中在 ≥0.8。

### 任务 1.3 — 加 batch 级 salience 校准
**新增**：[src/pipeline/salience.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/salience.ts)

```typescript
/**
 * 把一批 memory 的 salience 重映射到目标 percentile 分布：
 *   p90+ → 0.9-1.0, p65-p90 → 0.7-0.85, p25-p65 → 0.5-0.7, <p25 → 0.3-0.5
 * 用于一个 session 内 ≥4 条记忆时；少于 4 条不归一化。
 */
export function calibrateSalience(memories: Memory[]): Memory[];
```

**集成**：[src/pipeline/ingestor.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts) 在 `extracted` 数组生成后、dedup 之前调用：
```typescript
const calibrated = calibrateSalience(extracted);
```

**注意**：不能让所有 memory 都被压低。对于 layer === "insight" 或 status === "verified" 不要参与归一化（保持原值）。

**测试**：[tests/pipeline/salience.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/salience.test.ts)
- 输入 10 条 salience 全部 0.9 → 输出最高保留 0.9-1.0，最低被压到 0.3-0.5 区间
- 输入 3 条 → 不归一化
- verified 状态记忆不被压低

---

## P2：Truncation 长会话改用摘要式压缩

### 背景
[truncateMessages](file:///Users/matincz/Desktop/Mnemonic/src/llm/prompts.ts#L25-L66) 用 head + tail，中段决策被丢弃。

### 任务 2.1 — 中段摘要折叠
**改动**：[src/llm/prompts.ts](file:///Users/matincz/Desktop/Mnemonic/src/llm/prompts.ts) 的 `truncateMessages`

新策略（保持函数签名不变）：
1. 若总长 ≤ maxChars：直接返回（不变）
2. 否则：
   - 保留 head 2 条 + tail 至填满 80% budget
   - 中段被丢弃的部分：**统计「丢弃了 N 条消息，跨度 H1..Hk 包含工具调用 T 次」并以一行摘要插入** "... (truncated N messages, including tool calls: ...) ..."
   - 同时：扫描中段所有 user 消息的第一行（≤120 字符）作为 "skipped user prompts" 列表插入（最多 5 条）

这样 LLM 至少能感知中段发生过什么，而不是哑黑盒。

**测试**：[tests/llm/prompts.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/llm/prompts.test.ts)（如不存在请新建）
- 输入超长 session → 输出包含 head/tail/中段摘要标记

### 任务 2.2 — `stripLongCodeBlocks` 减少误删
**改动**：[stripLongCodeBlocks](file:///Users/matincz/Desktop/Mnemonic/src/llm/prompts.ts#L5-L22)

补充关键词白名单：当代码块中出现以下字样之一时**保留完整代码**：
```
config, schema, migration, sql, dockerfile, yaml, env, secret, regex, prompt, template, fixture
```

并把行数阈值从 5 提高到 12（短配置文件常>5 行）。

---

## P2：Status 自动升级闭环

### 背景
v2 已实现「同记忆 ≥3 sessions 自动 verified」，但「proposed → verified 基于后续测试通过/部署成功」仍未做。

### 任务 2.3 — 后续 session 信号回写
**新增**：[src/pipeline/status-updater.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/status-updater.ts)

```typescript
/** 在每个 session 处理完后被 pipeline 调用 */
export async function propagateVerificationSignals(
  session: ParsedSession,
  memories: Memory[],
  storage: Storage,
): Promise<void>;
```

实现：
1. 扫描 session.messages 中是否包含 verification 信号：
   - `/✓|✅|all tests? pass|build success|deployed|merged|fix(ed)? confirmed/i`
   - 或 tool 调用结果中 `exit_code: 0` 且对应命令是 `bun test|npm test|pytest|go test|cargo test|deploy`
2. 若有，找出最近 7 天内由该 project 产生且 status === "proposed" 的记忆，做语义关联（cosine ≥ 0.6 with 当前 session 提取出的 memories），将 status 升级为 "verified"，并写入 `linkedMemoryIds`

**集成**：[src/pipeline/index.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/index.ts) reflector 之后调用。

**测试**：[tests/pipeline/status-updater.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/status-updater.test.ts)
- 一条 proposed 记忆 + 后续 session 含 "tests pass" → 升级为 verified
- 不含信号 → 不变
- 跨 7 天阈值 → 不升级

---

## P2：Contradicts 触发 superseded

### 背景
当前 `contradicts` 字段写入后没有自动把旧记忆置 `superseded`，导致检索时仍按 observed 处理。

### 任务 2.4 — Contradiction → supersede
**改动**：[src/pipeline/linker.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/linker.ts)

当 linker 判定新记忆 contradicts 旧记忆 A 时：
- 若新记忆的 `createdAt > A.updatedAt` 且 `salience >= A.salience`，把 A 的 status 设为 `superseded`，updatedAt 同步
- 在 A.linkedMemoryIds 中加上新记忆 id 以便回溯

**测试**：[tests/pipeline/linker.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/linker.test.ts)（如缺则新建）

---

## P3：Evaluator 启发式扩展

### 任务 3.1 — 失败循环识别
**改动**：[src/pipeline/evaluator.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/evaluator.ts)

新增启发式：
- `isUnresolvedFailureLoop(session)`：同一错误信息（hash 出错栈前 200 字符）在 session 内出现 ≥4 次且最后一条 assistant 消息没有 "fixed/resolved/works/passes" 字样 → 标记为不值得记忆（除非用户明确 "let's document this"）
- `isPureBrowsingSession(session)`：所有 assistant 消息都没触发任何 tool / 没有 code block / 没有 "let's"  → 跳过
- `isUserAbortedSession(session)`：最后一条 user 消息含 "stop|cancel|abort|nevermind" → 跳过

**测试**：扩展 [tests/pipeline/evaluator.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/evaluator.test.ts) 三个新启发式。

---

## P3：定期衰减 + 自动 sweep

### 任务 3.2 — 周度自动维护
**改动**：[src/cli.ts](file:///Users/matincz/Desktop/Mnemonic/src/cli.ts) 在 `start` 命令的 daemon 循环里增加 timer：

- 每 24h 检查一次 `lastMaintenanceAt`（存于 [src/storage/sqlite.ts](file:///Users/matincz/Desktop/Mnemonic/src/storage/sqlite.ts) 的 `meta` 表）
- 距上次 ≥7 天则执行：
  1. `storage.optimize()`（已有）
  2. 删除 `salience < 0.3 && layer === "episodic" && age > 30d && !linkedFrom`
  3. 把 `status === "proposed" && age > 60d && supportingMemoryIds.length === 0` 的记忆降级 salience -0.2

输出报告到 `vault/maintenance/<date>.md`。

**测试**：[tests/storage/maintenance.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/storage/maintenance.test.ts)
- 跑两次 sweep 不应重复删除
- 7 天内不再次执行

---

## P3：跨 layer linkedMemoryIds 一致性

### 任务 3.3 — Episodic ↔ Semantic 双向链接
当 consolidator 用一条 episodic 生成 semantic 时，目前只在 semantic 的 `supportingMemoryIds` 写入 episodic id；反向 episodic 没有指向 semantic 的链接。

**改动**：[src/pipeline/consolidator.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/consolidator.ts) `create-synthesis` 分支后，把新 semantic 的 id 写回每个 supporting episodic 的 `linkedMemoryIds`，并 storage.saveMemory 持久化更新。

**测试**：扩展 [tests/pipeline/consolidator.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/consolidator.test.ts) 验证双向链接。

---

## 验收清单

每完成一项 P 阶段，按下方清单逐一勾选：

```
[ ] P0.1 cosineSimilarity 工具 + LRU + fallback
[ ] P0.2 ingestor 切到 cosine
[ ] P0.3 normalizer / reflector / consolidator / dedup 切到 cosine
[ ] P0.4 mergeIntoExistingMemory 保留 first-seen source
[ ] P1.1 project 不一致硬性否决
[ ] P1.2 reflector 历史 context 用 findRelatedMemoriesBatch
[ ] P1.3 calibrateSalience batch 归一化
[ ] P2.1 truncateMessages 中段摘要插入
[ ] P2.2 stripLongCodeBlocks 白名单 + 阈值
[ ] P2.3 propagateVerificationSignals
[ ] P2.4 contradicts 触发 superseded
[ ] P3.1 evaluator 三个新启发式
[ ] P3.2 周度自动 sweep
[ ] P3.3 episodic↔semantic 双向链接
[ ] bun test 全绿
[ ] bun run src/cli.ts paths 正常
```

---

## 完成后建议执行

```bash
bun run src/cli.ts reset      # 用新逻辑重处理（可选；保留旧库可观察 diff）
bun run src/cli.ts start
# 观察 24h 后
bun run src/cli.ts optimize
```

预期指标改善（相对 v2 验收基线）：
| 指标 | v2 验收 | v3 目标 |
|------|---------|---------|
| 完全 + 近义重复 | <2% | <0.5% |
| 跨 project 错误合并 | 未测 | 0 |
| Insight 跨 session 命中率 | ~低 | 提升 3-5× |
| Salience >= 0.8 占比 | 未变 | 30-35% |
| Proposed 记忆永远停留比 | 100% | <30% |

---

## 备注：风险与回滚

- **embedding 服务不可用**：所有相似度调用都有 Jaccard fallback，pipeline 不会中断
- **calibrateSalience 误压**：可加 feature flag `MNEMONIC_DISABLE_SALIENCE_CALIBRATION=1` 关闭
- **propagateVerificationSignals 误升级**：限制 7 天窗口 + cosine ≥ 0.6 双过滤；若发现误判，可在 maintenance sweep 中回滚
- 所有改动**严格不删除现有数据**，只追加 / 修改字段

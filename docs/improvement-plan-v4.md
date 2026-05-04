# Mnemonic 记忆质量改进执行计划 v4

> 编制日期：2026-05-04
> 目标：在 v3 已完成 cosine 相似度迁移、salience 校准、status 自动升级、双向链接等基础上，进一步修复**缓存正确性、代码重复、健壮性、可观测性**等系统性问题。
> 受众：执行此计划的 AI agent。每一项均给出**改动文件、改动内容、判定方式、验收测试**。请按 P0 → P3 顺序实施，每完成一项跑一次 `bun test`。

---

## 全局约束

1. **不要破坏现有测试**：`bun test` 当前 148 pass。任何改动后必须仍然 pass。
2. **保持向后兼容**：`Memory` schema 字段不要删除/重命名；如需新增字段必须在 [src/types.ts](file:///Users/matincz/Desktop/Mnemonic/src/types.ts) 中加成 optional。
3. **不要替换 LanceDB / SQLite / better-sqlite3 / nanoid 等基础依赖**。
4. **每个 P 阶段都要补/改测试**。
5. 修改后用以下命令验证：
   ```bash
   bun test
   bun run src/cli.ts paths        # 确认配置仍可加载
   ```

---

## P0：相似度缓存正确性 + 去除代码重复（最重要）

### 背景
1. [src/pipeline/similarity.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/similarity.ts) 模块级 `vectorCache` 用纯文本作为 key，在多 provider / 多 model 切换或测试间会**返回上一个 model 的向量**，导致 cosine 计算错配。
2. [src/pipeline/status-updater.ts#L156-L177](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/status-updater.ts#L156-L177) 重复实现了 `cosineSimilarity`，且**绕过 LRU 缓存**直接调 `embedTexts`，每次 session 处理都冷启动一次 embedding。

### 任务 0.1 — Embedding 缓存 key 加入 provider/model 维度
**改动文件**：[src/pipeline/similarity.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/similarity.ts)

要点：
- 新增内部函数 `resolveCacheNamespace(config)`：返回形如 `"openai:text-embedding-3-small:1536"` 的字符串
- 缓存 key 改为 `${namespace}::${normalizedText}`
- 当 `config.embedding` 切换时旧 key 自然不命中，但内存继续被新 key 占用——LRU 容量需要从 200 提升到 400 以容纳两 namespace 共存
- 暴露 `resetSimilarityVectorCacheForTests()` 不变（继续清空全部）

**测试**（[tests/pipeline/similarity.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/similarity.test.ts)）：
- 用相同文本但不同 mock provider 调用两次 `semanticSimilarity` → 第二次必须真的 re-embed（mock 计数 +1），不能命中第一次的缓存

### 任务 0.2 — status-updater 复用统一相似度入口
**改动文件**：[src/pipeline/status-updater.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/status-updater.ts)

要点：
- 删除内部的 `cosineSimilarity` 函数（[L156-L177](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/status-updater.ts#L156-L177)）
- `findSemanticAssociations` 改为调用 `batchPairwiseSimilarity(pairs, { storage })`，传入 `(currentMemory.text, candidate.text)` 二元组，由其负责 embed 与缓存
- 保留阈值 `0.6` 不变；保留 try/catch 回退到 `textSimilarity`（已由 `batchPairwiseSimilarity` 内部回退覆盖）

**测试**：[tests/pipeline/status-updater.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/status-updater.test.ts)
- 现有用例必须仍然通过
- 新增：连续两次 `propagateVerificationSignals` 处理同一 candidate text → mock embed 调用次数应 ≤ 第一次的 +0（命中缓存）

### 任务 0.3 — Ingestor 失败容忍
**改动文件**：[src/pipeline/ingestor.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts)

要点：
- 把 [L52-L54](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts#L52-L54) 的 `Promise.all` 改为 `Promise.allSettled`
- 失败的 memory 当作"无 duplicate / 无 link"处理（即原样保留）
- 在 `console.warn` 中输出失败原因（不要 silently swallow）

**测试**：[tests/pipeline/ingestor.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/ingestor.test.ts)
- mock `findRelatedMemoriesBatch` 对第 2 条 memory 抛错 → 整体 ingest 仍返回 N 条 memory，仅第 2 条不参与去重

---

## P1：Status 升级健壮性

### 背景
- [propagateVerificationSignals](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/status-updater.ts#L12) 用 `createdAtMs > sessionTimestamp` 排除"未来"记忆——但 `reset` + `start` 重处理时 createdAt 是历史值、session.timestamp 是 wall-clock，整个判定可能反转。
- 验证信号正则 `/merged|deployed|✅|✓.../i` 在普通对话中误报率高。

### 任务 1.1 — 时间窗口判定改用 session.timestamp 锚点
**改动文件**：[src/pipeline/status-updater.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/status-updater.ts)

要点：
- 去掉 `createdAtMs > sessionTimestamp` 这个"未来"过滤
- 改用：`createdAtMs >= cutoff && createdAtMs <= sessionTimestamp + 1day`（容许少量时钟漂移）
- 在文件顶部 const 加 `MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000`

**测试**：[tests/pipeline/status-updater.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/status-updater.test.ts)
- 模拟 reset 场景：candidate.createdAt = 2026-04-15，session.timestamp = 2026-04-20 → 应升级
- candidate.createdAt = 2026-04-20，session.timestamp = 2026-04-15 → 不应升级（旧 session 不能验证未来记忆）

### 任务 1.2 — 验证信号双锚定
**改动文件**：[src/pipeline/status-updater.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/status-updater.ts)

新规则：
- "信号词"必须**与命令或 exit_code 同句或紧邻一行**才算 verification
- 拒绝匹配：`"plan to deploy"` / `"merge conflict"` / `"will deploy tomorrow"`（含 will/plan/might 等弱化词）
- 改造 `hasVerificationSignal`：
  ```typescript
  // 先做 verification 词正则；若命中，要求同 message 或 ±1 message 内出现命令/exit_code 锚定
  // 单独的 ✅ ✓ 不算（emoji 在列表中无意义）
  ```

**测试**：扩展 [tests/pipeline/status-updater.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/status-updater.test.ts)
- "plan to deploy next week" → 不升级
- "git merge conflict resolved" → 不升级（merge 不是部署信号）
- "bun test ... exit_code: 0 ... all tests pass" → 升级

---

## P1：Salience 校准平滑化

### 背景
[calibrateSalience](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/salience.ts#L20) 当 `eligible.length < 4` 时**完全不归一化**，导致 3 条 vs 4 条 session 产生分布跳变。

### 任务 1.3 — 小批次也做温和归一化
**改动文件**：[src/pipeline/salience.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/salience.ts)

新策略：
- `eligible.length < 2`：不归一化（无意义）
- `eligible.length === 2 || 3`：用"压缩"模式——把每条原 salience 与目标 percentile 做 70/30 加权混合（保留大部分原始判断，仅做轻微对齐）
- `eligible.length >= 4`：维持现有 percentile 重映射

**测试**：[tests/pipeline/salience.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/salience.test.ts)
- 3 条原 salience 全 0.95 → 输出范围 [0.7, 0.95]，最高仍 ≥0.85
- 1 条 → 完全不变

---

## P2：可观测性 — Pipeline Metrics

### 背景
v3 计划承诺了"完全+近义重复 <0.5%"等量化目标，但代码中**没有任何 metrics 收集**，无法验证是否达成、无法回归监控。

### 任务 2.1 — 新增 metrics 收集模块
**新增文件**：[src/pipeline/metrics.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/metrics.ts)

```typescript
export interface PipelineMetrics {
  sessionId: string;
  ingestedRaw: number;             // LLM 提取的 raw memory 数
  ingestedAfterCalibration: number; // calibrateSalience 后
  ingestedAfterDedup: number;      // findDuplicateCandidate 后
  dedupMerged: number;
  dedupDropped: number;
  crossLayerLinked: number;
  reflectorAdded: number;
  consolidatorMerged: number;
  consolidatorSynthesized: number;
  statusUpgraded: number;
  contradictsSuperseded: number;
  salienceDistribution: { p25: number; p50: number; p75: number; p90: number };
}

export function recordMetrics(storage: Storage, metrics: PipelineMetrics): Promise<void>;
export function summarizeMetrics(storage: Storage, sinceDays: number): Promise<MetricsSummary>;
```

要点：
- 持久化到 SQLite 新表 `pipeline_metrics`（schema 加在 [src/storage/sqlite.ts](file:///Users/matincz/Desktop/Mnemonic/src/storage/sqlite.ts)）
- 表结构：`(session_id TEXT PK, recorded_at TEXT, payload JSON)`

### 任务 2.2 — 集成到 pipeline 各阶段
**改动文件**：[src/pipeline/index.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/index.ts)

要点：
- 在 ingestor / reflector / consolidator / status-updater / linker 调用前后采集计数
- 完成后调一次 `recordMetrics`
- 失败时 metrics 仍尽量上报（best-effort，不影响主流程）

### 任务 2.3 — CLI 增加 metrics 报告子命令
**改动文件**：[src/cli.ts](file:///Users/matincz/Desktop/Mnemonic/src/cli.ts)

新增子命令：
```bash
bun run src/cli.ts metrics --since 7d
```
输出最近 N 天聚合：
- 平均每 session 提取 / 去重 / 合并数
- Salience 分布（p25/p50/p75/p90）
- Status 升级总数
- Top 5 高 dedup 率的 project（疑似噪声源）

**测试**：[tests/pipeline/metrics.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/metrics.test.ts)
- 写入 3 条 metrics → `summarizeMetrics(7)` 返回正确聚合

---

## P2：Findrelatedmemories 召回质量

### 背景
[ingestor.ts#L51](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts#L51) `limit: 15` 在 vault 已有 5000+ 条时可能漏掉真正的近义重复——尤其当 metadata filter（project、layer）被 vector 索引粗略 prune 时。

### 任务 2.4 — 分层召回（keyword + vector hybrid）
**改动文件**：[src/storage/index.ts](file:///Users/matincz/Desktop/Mnemonic/src/storage/index.ts) `findRelatedMemoriesBatch`

要点：
- 现有逻辑已经是 keyword + vector 混合，但 limit 切割可能让低权重的 vector hit 被丢弃
- 改成：`keyword limit = limit * 3` + `vector limit = limit * 2` → 合并后按 score 排序取 top `limit`
- 当 `limit >= 15` 时启用此扩展模式；`limit < 15` 维持原行为

**测试**：扩展 [tests/storage/hybrid.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/storage/hybrid.test.ts)
- 构造 50 条 memory，第 30 条标题与查询近义但 keyword 不命中 → 必须能在 limit=15 时被 vector 召回

---

## P3：架构清理

### 任务 3.1 — Salience / Status / Supersede 协同
**改动文件**：[src/pipeline/salience.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/salience.ts), [src/pipeline/linker.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/linker.ts)

要点：
- `calibrateSalience` 排除条件追加 `status === "superseded"`（与 verified 同等不动）
- `linker.ts` 把记忆 supersede 时，同步把其 salience 衰减 ×0.7（被替代的旧知识不应再高权）

**测试**：扩展 [tests/pipeline/linker.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/linker.test.ts)

### 任务 3.2 — Similarity 接口收窄
**改动文件**：[src/pipeline/similarity.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/similarity.ts)

要点：
- `SemanticSimilarityOptions.storage` 类型从 `Pick<Storage, "config">` 改为更精确的 `{ config?: AppConfig }`
- 减少与 Storage 类的耦合（多处只为了拿 config）

### 任务 3.3 — 配置项 feature flag
**改动文件**：[src/config.ts](file:///Users/matincz/Desktop/Mnemonic/src/config.ts) 或环境变量解析处

新增：
- `MNEMONIC_DISABLE_SALIENCE_CALIBRATION=1`：关闭 calibrateSalience
- `MNEMONIC_DISABLE_VERIFICATION_PROPAGATION=1`：关闭 status-updater
- `MNEMONIC_SIMILARITY_FORCE_FALLBACK=1`：强制使用 Jaccard（用于离线测试）

每个 flag 在对应模块顶部 `if (env...) return memories;` 早返回。

**测试**：每个 flag 配一条测试。

---

## 验收清单

```
[ ] P0.1 Similarity LRU 加入 provider/model namespace
[ ] P0.2 status-updater 复用 batchPairwiseSimilarity（删除重复 cosine）
[ ] P0.3 Ingestor 改用 Promise.allSettled
[ ] P1.1 Status 升级时间窗口判定健壮化（适配 reset）
[ ] P1.2 验证信号双锚定，拒绝弱化词
[ ] P1.3 calibrateSalience 小批次温和归一化
[ ] P2.1 新增 PipelineMetrics 模块 + sqlite 表
[ ] P2.2 pipeline 各阶段集成 metrics 采集
[ ] P2.3 CLI metrics 子命令
[ ] P2.4 findRelatedMemoriesBatch 召回扩展
[ ] P3.1 calibrate/linker 排除 superseded + 衰减
[ ] P3.2 Similarity 接口收窄
[ ] P3.3 三个 feature flag
[ ] bun test 全绿
[ ] bun run src/cli.ts paths 正常
[ ] bun run src/cli.ts metrics --since 7d 输出合理
```

---

## 完成后建议执行

```bash
bun run src/cli.ts reset           # 用新逻辑重处理（可选；保留旧库可观察 diff）
bun run src/cli.ts start
# 24h 后
bun run src/cli.ts metrics --since 1d
bun run src/cli.ts optimize
```

预期可量化指标（新 metrics 模块产出）：
| 指标 | v3 目标（无监控） | v4 目标（有监控） |
|------|------------------|------------------|
| 完全+近义重复率 | <0.5% | 实测可观测 |
| 跨 project 错误合并 | 0 | 实测可观测 |
| Salience >= 0.8 占比 | 30-35% | 实测 + alert |
| Proposed 永停留比 | <30% | 实测 + alert |
| Embedding 缓存命中率 | 未测 | >70% |
| Ingest 失败率 | 未知 | <1% |

---

## 备注：风险与回滚

- **缓存 namespace 变更**：所有旧缓存条目变为不可用——首次启动会有一波重新 embed（短暂延迟，无数据风险）
- **Ingest Promise.allSettled**：失败的 memory 会被原样保留（不去重），可能短暂增加 dedup 池——下次 consolidator 会清理
- **验证信号收紧**：可能漏升级一些边缘 case；用 metrics 监控 statusUpgraded 是否骤降
- **Metrics 表写入失败**：必须 best-effort，不能阻塞主 pipeline
- 所有改动**严格不删除现有数据**，只追加 / 修改字段

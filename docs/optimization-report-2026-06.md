# Mnemonic 代码优化报告 (2026-06)

> 基于真实运行数据（3523 条记忆）+ 源码审查的提炼质量评估与优化方案。
> 本报告**不含代码改动**，仅给出诊断、优先级、以及可交给其他 agent 直接执行的提示词。

---

## 0. 一句话结论

代码工程质量优秀（分阶段 checkpoint、fail-open 富集、status/provenance 体系完整），但**记忆提炼的语义质量**存在三个互相关联的系统性缺陷：**层级倒金字塔、跨会话近重复堆积、verified/多源占比极低**。三者根因相同——**跨会话近重复合并能力不足**。

---

## 1. 实测数据基线

数据库：`~/Library/Application Support/Mnemonic/data/memory.db`

| 指标 | 实测 | 评价 |
|---|---|---|
| 总记忆数 | 3523 | — |
| 层级分布 | insight 1001 / semantic 1292 / procedural 881 / **episodic 349** | ❌ 倒金字塔 |
| 低质 insight | 209 条 salience<0.4（约 21%） | ❌ 噪声升级 |
| 精确重复标题组 | 2 | ✅ 精确去重有效 |
| 近重复标题 | 100+（如 5 个 "...via Telegram..." 架构条目） | ❌ 跨会话语义重复严重 |
| verifiedRatio | 0.021 | ❌ 验证态升级几乎不触发 |
| multiSourceRatio | 0.076 | ❌ 92% 记忆仅单会话 |
| 薄记忆 (details<60) | 0 | ✅ normalizer 过滤有效 |
| projectCoverage | 0.49 | ⚠️ 半数无项目归属 |

### 层级倒金字塔示意

```
                  实际           理想
  insight    ████████ 1001(28%)     ▏稀少
  semantic   ██████████ 1292(37%)   ███
  procedural ███████ 881(25%)       ███
  episodic   ███ 349(10%)           ██████████ 最多
```

### 根因链

```
跨会话近重复不合并
  └─> multiSourceRatio 低 (0.076)
        └─> promoteStatus 需 3 个唯一会话才升 verified → 几乎不触发
              └─> verifiedRatio 极低 (0.021)
跨会话近重复不合并
  └─> 近义标题堆积 (100+)
insight 无 salience 下限
  └─> 209 条低质 insight 升级 → 倒金字塔加剧
```

---

## 2. 问题清单（按严重度）

### P0-1 跨会话近重复无人兜底 ★最严重

- `src/pipeline/normalizer.ts` 的 `mergeNearDuplicates` 只在**单会话批内**去重。
- LLM consolidator (`src/pipeline/consolidator.ts`) 保守，候选受限（`limit: 12`）。
- 真正的全库去重 `deduplicateMemoryCorpus` (`src/storage/deduplicate.ts`) **只在 `optimize` 手动触发**。
- 其 `isCrossBatchNearDuplicate` 阈值 `titleSimilarity>=0.82` 用 Jaccard 词集，对 "X" vs "X and Health Checks" 只算 0.62，永远合不掉。

**影响**：100+ 近义标题；连锁拉低 multiSource 与 verified。

### P0-2 insight 缺少 salience 下限

- `src/pipeline/reflector.ts` 的"≥2 源"约束有效，但无最低 salience 门槛。
- 导致 `User prefers direct yes/no answers`(0.21)、`Draft API is non-official`(0.26) 被升级成 insight。

**影响**：约 209 条低价值 insight，倒金字塔顶部虚胖。

### P1-1 去重相似度算法过弱

- `textSimilarity` (`src/pipeline/normalizer.ts`) 是空格分词 Jaccard，无词干化、对长度敏感。
- 项目已有更强的 `semanticSimilarity`（embedding 余弦，`src/pipeline/similarity.ts`），但去重路径未使用。

### P1-2 项目归属率低 (0.49)

- 半数记忆无 `project`，而 `isCrossBatchNearDuplicate` 在双方都有 project 且不同则拒绝合并；缺失归属也削弱检索过滤。

### P2-1 全库去重 O(n²)

- 3500 条尚可，继续增长会退化；与 embedding 化叠加需注意性能。

---

## 3. 优化方案与优先级

| 优先级 | 方案 | 预期收益 | 改动范围 |
|---|---|---|---|
| P0-1 | 全库近重复去重接入常态流程（如每 N 个会话或 daemon 周期触发），并放宽/改进阈值（token 包含式 + embedding） | 直接压掉 100+ 重复，连带提升 multiSource/verified | `deduplicate.ts`, `storage/index.ts`, daemon 调度 |
| P0-2 | insight 增加 salience 下限，低于阈值降级 | 清掉 ~209 条噪声 insight，修正层级金字塔 | `reflector.ts` 或 `normalizer.ts` |
| P1-1 | 全库去重的相似度改用 embedding（带 textSimilarity 兜底） | 召回更多真重复，减少误合并 | `deduplicate.ts` |
| P1-2 | 提升项目归属率（解析阶段补全 project 推断） | 改善去重命中与检索过滤 | `pipeline/project.ts`, 解析器 |

**实施顺序建议**：P0-1 → P0-2 → P1-1 → P1-2。P0-1 与 P0-2 收益最大且改动局部。

---

## 4. 给其他 Agent 执行的提示词

> 以下每个提示词自包含，可独立交给一个编码 agent。要求：先读相关文件，遵循仓库 AGENTS.md 与既有风格，改完跑 `bun test` 与 `bunx tsc --noEmit` 验证，**不要**降低测试标准来凑绿。

### 提示词 A — P0-1 常态化全库近重复去重

```
任务：让 Mnemonic 的全库近重复去重在常态流程中自动运行，并改进其匹配阈值，
解决跨会话近义标题堆积（当前 100+ 组，例如多条 "...via Telegram..." 架构记忆）。

先阅读这些文件以理解现状：
- src/storage/deduplicate.ts（deduplicateMemoryCorpus / isCrossBatchNearDuplicate）
- src/storage/index.ts（deduplicateMemoryCorpus 当前只在 optimize 路径调用，约 L389）
- src/watcher/index.ts 或 daemon 调度入口（找到会话处理循环 / 周期任务的位置）
- src/pipeline/normalizer.ts（textSimilarity 实现与阈值参考）

要求：
1. 让全库去重周期性自动运行：例如每处理 N 个会话或按 daemon 定时触发一次，
   而不是仅靠手动 `mnemonic optimize`。N 设为可配置，默认 25。
2. 改进 isCrossBatchNearDuplicate 的标题判定：在现有 Jaccard 基础上增加
   "token 包含式"规则——当一个标题的 token 集合是另一个的超集且核心 token 重合度高时，
   判为近重复（覆盖 "X" vs "X and Health Checks" 这类，当前算 0.62 被漏掉）。
   不要让阈值过松导致误合并；保留 project 不同则不合并的现有保护。
3. 保持幂等与 checkpoint 语义，不破坏现有 replaceAllMemories / materializeMemories 流程。

约束：
- 不引入对外部网络的新依赖。
- 全库去重是 O(n^2)，注意 3500+ 规模的性能，必要时按 layer/project 分桶后再两两比较。
- 为新增的"包含式近重复"逻辑补充单元测试（参考 tests/storage/deduplicate.test.ts）。

验证：bun test 全绿；bunx tsc --noEmit 无错误；
新增测试覆盖 "X" vs "X and Y" 能被合并、不同 project 不被合并两种情况。

完成后报告：改了哪些文件、新增测试、合并阈值的最终取值与理由。
```

### 提示词 B — P0-2 insight salience 下限

```
任务：修正 Mnemonic 记忆层级倒金字塔。当前 insight 有 1001 条（含约 209 条 salience<0.4
的低价值条目，如 "User prefers direct yes/no answers" salience=0.21），而原始 episodic
只有 349 条。给 insight 增加最低 salience 门槛。

先阅读：
- src/pipeline/reflector.ts（insight 生成逻辑与 reflectPrompt 调用）
- src/pipeline/normalizer.ts（已有 semantic/procedural 低分降级为 episodic 的先例）
- src/llm/prompts.ts（reflectPrompt 的规则段）

要求（二选一或结合，优先在确定性后处理层做，避免只靠提示词）：
1. 在 reflector 输出后或 normalizer 中，对 layer=insight 且 salience<阈值（默认 0.45）
   的记忆进行降级处理：降为 semantic（若有泛化知识）或直接丢弃（若是一次性观察）。
   阈值设为可配置常量。
2. 同步在 reflectPrompt 规则中明确："insight 必须具备跨场景泛化价值，salience 一般 >=0.5；
   低于此的观察应作为 episodic/semantic，不要升级为 insight。"

约束：
- 不要误伤高价值低 salience 的真 insight；阈值取 0.45 偏保守，附理由说明。
- 不删除已有数据库记忆（本任务只改生成逻辑，存量清理由维护命令负责）。

验证：bun test 全绿；bunx tsc --noEmit 无错误；
为降级逻辑补单测：salience<0.45 的 insight 被降级、>=0.45 保留。

完成后报告：阈值取值、降级策略（降级 vs 丢弃）的选择理由、改动文件。
```

### 提示词 C — P1-1 去重改用 embedding 相似度

```
任务：让 Mnemonic 的全库近重复去重使用语义相似度（embedding 余弦）而非纯 Jaccard 词集，
带 textSimilarity 兜底，以提升真重复召回、减少漏判与误判。

先阅读：
- src/storage/deduplicate.ts（isCrossBatchNearDuplicate 当前用 textSimilarity）
- src/pipeline/similarity.ts（已有 semanticSimilarity / batchPairwiseSimilarity / 向量缓存）
- src/embeddings/index.ts（hasEmbeddingProvider 探测）

要求：
1. 在全库去重的候选对判定中，优先用 batchPairwiseSimilarity 计算 title+summary 的语义相似度；
   当无 embedding provider 或调用失败时，回退到现有 textSimilarity（保持 fail-open）。
2. 为避免 O(n^2) 次 embedding 调用：先用现有廉价 textSimilarity / 分桶做粗筛，
   只对粗筛通过的候选对再算 embedding 精排。
3. 阈值需要重新标定（embedding 余弦的尺度与 Jaccard 不同），给出标定依据。

约束：
- 必须保持无 provider 时仍可工作（回退路径）。
- 复用 similarity.ts 的向量缓存，不要重复实现。
- 注意 3500+ 规模性能，粗筛是必须的。

验证：bun test 全绿（含 MNEMONIC_SIMILARITY_FORCE_FALLBACK=1 的回退路径）；
bunx tsc --noEmit 无错误；补充 embedding 路径与回退路径的测试。

完成后报告：粗筛策略、最终阈值、性能影响估计、改动文件。
```

### 提示词 D — P1-2 提升项目归属率

```
任务：提升 Mnemonic 记忆的项目归属率（当前 projectCoverage 仅 0.49），
改善跨会话去重命中率与检索过滤。

先阅读：
- src/pipeline/project.ts（项目推断逻辑）
- src/parsers/*.ts（各 agent 会话解析，看 project/cwd 等字段来源）
- src/types.ts（ParsedSession / Memory 的 project 字段）

要求：
1. 排查为何半数会话/记忆缺 project：是解析器没提取，还是推断逻辑覆盖不足。
2. 增强 project 推断：可从 cwd / git 仓库根 / 文件路径 / 会话内提及的项目名等线索推断，
   置信度低时保持 unknown，不要瞎填。
3. 确保推断出的 project 一致归一化（大小写/路径形式），以便去重的 project 比较生效。

约束：
- 宁缺毋滥：错误的 project 归属比缺失更有害（会阻止正确的跨会话合并）。
- 不改变现有 schema 字段语义。

验证：bun test 全绿；bunx tsc --noEmit 无错误；
为新增推断规则补单测。处理几个真实会话样本，报告 projectCoverage 的改善幅度。

完成后报告：新增的推断线索、归一化规则、coverage 前后对比、改动文件。
```

### 提示词 E（可选）— 存量数据清理

```
任务：对 Mnemonic 现有数据库执行一次性质量清理（在 A/B 落地后运行），
合并存量近重复、降级存量低质 insight。

要求：
1. 评估是否可通过现有 `mnemonic optimize` / `mnemonic prune` 命令完成，
   若不足则在 CLI 增加一次性 maintenance 子命令（先 --dry-run 预览，再实际执行）。
2. 清理项：合并近重复标题组、降级 salience<0.45 的 insight、清除明显噪声。
3. 操作前自动备份 memory.db。

约束：破坏性操作必须先 --dry-run 并打印将要变更的条目数；默认不直接删数据。

验证：在备份副本上跑 dry-run，报告将合并/降级/删除的数量；确认无误后再对正式库执行。

完成后报告：清理前后各层级数量、重复组数、verified/multiSource 比例对比。
```

---

## 5. 验证清单（每个 agent 完成后必须满足）

- [ ] `bun test` 全部通过（当前基线 183 pass / 0 fail）
- [ ] `bunx tsc --noEmit` 无类型错误
- [ ] 新逻辑有对应单元测试，且未通过降低断言来凑绿
- [ ] 未引入新的外部网络依赖（除非任务明确要求）
- [ ] 遵循仓库 AGENTS.md 与既有代码风格
- [ ] 报告中说明：改动文件、关键阈值取值与理由、（若适用）对实测指标的预期改善

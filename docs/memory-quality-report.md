# Mnemonic 记忆质量评估与改进建议

> 评估日期：2026-04-21
> 数据范围：5,369 条记忆 / 540 个独立 session / 5 个 agent 来源
> 评估者：Amp

---

## 一、现状数据总览

| 指标 | 数值 |
|------|------|
| 总记忆数 | 5,369 |
| 独立 session 数 | 540 |
| 每 session 平均产出 | 9.9 条 (最多 32) |
| 时间跨度 | 2026-04-18 ~ 2026-04-21 (仅 3 天，但含回溯至 3 月的 session) |
| agent 来源 | codex 2514, openclaw 1299, amp 859, claude-code 413, gemini 284 |

### 层级分布

| 层级 | 数量 | 占比 |
|------|------|------|
| insight | 2,027 | 37.8% |
| semantic | 1,522 | 28.3% |
| procedural | 1,191 | 22.2% |
| episodic | 629 | 11.7% |

### Salience 分布

| 区间 | 数量 | 占比 |
|------|------|------|
| 0.8-1.0 | 3,680 | 68.5% |
| 0.6-0.7 | 1,336 | 24.9% |
| ≤0.5 | 353 | 6.6% |

---

## 二、核心质量问题

### 问题 1：时间线错误（已修复）

**严重程度：🔴 严重**

所有记忆的 `created_at` 使用的是 pipeline 处理时间而非会话发生时间。一个 2026-03-26 的 Amp thread 被标记为 2026-04-19 的记忆。

- 根因：`ingestor.ts` 第 11 行使用 `new Date()` 而非 `session.timestamp`
- 影响：时间线排序、salience 衰减、记忆回溯全部基于错误时间
- 状态：**已修复** ingestor / reflector / consolidator 三处

### 问题 2：大量重复记忆（最严重的质量问题）

**严重程度：🔴 严重**

- 339 组完全相同标题，涉及 1,127 条记忆（占总量 **21.0%**）
- 最极端案例："Zeekr to InfluxDB Sync Execution" 重复 **56 次**
- 跨 agent 重复：同一知识点被 codex、gemini、amp 各提取一次
- 同 session 内也有重复：同一 session 产出 3 条同名记忆

**根因分析：**

1. **Consolidator 去重阈值过低**：`textSimilarity > 0.6`（标题）和 `> 0.5`（摘要）在 reflector 中使用，但 ingestor 本身**没有任何去重**
2. **每次 cron/sync 都重新提取**：OpenClaw 的 Zeekr 同步每次运行都产生一个新 session，LLM 每次都提取出同样的记忆
3. **Consolidator 只在同 batch 内比较**：不同 batch 的重复记忆无法被合并
4. **跨 agent 无去重机制**：同一知识从 codex session 和 gemini session 各提取一次，互不感知

### 问题 3：Insight 层过度膨胀

**严重程度：🟡 中等**

Insight 占 37.8%（2,027 条），远超合理比例。大量 insight 是对单条 episodic 的简单复述，而非跨 session 的模式归纳。

典型低质 insight：
- "Tire Pressure Variance Observation" × 12 —— 这只是一次传感器读数，不是 insight
- "CCB Protocol Strictness" 的不同表述 × 10+ —— 同一个发现被反复「发现」

### 问题 4：Salience 普遍虚高

**严重程度：🟡 中等**

68.5% 的记忆 salience ≥ 0.8，仅 6.6% ≤ 0.5。这意味着 salience 几乎失去了区分能力。

原因：LLM 提取时倾向给高分（prompt 中 `0.9+ = critical` 的指引导致了分数通胀）。

### 问题 5：Episodic 低价值噪声

**严重程度：🟢 轻微**

部分 episodic 记忆是纯操作噪声：
- "Session Environment Configuration" — 记录 env vars
- "System Restart Initiated" — 用户重启了电脑
- "Cleanup of Temporary Artifacts" — 删了临时文件
- "Ping Permission Restrictions in Sandbox" — sandbox 限制

这些不具备长期记忆价值，消耗存储和检索资源。

### 问题 6：Status 字段未被利用

**严重程度：🟢 轻微**

5,368/5,369 条记忆状态为 `observed`，仅 1 条为 `proposed`。prompt 中虽然定义了 `proposed/observed/verified` 三态，但 LLM 几乎从不使用 `proposed` 和 `verified`。

### 问题 7：Project 字段覆盖不足且不一致

**严重程度：🟢 轻微**

- 49.5% 的记忆有 project 字段
- 同一项目有多种命名：`workspace-iot` / `workspace` / `workspace-code` / `matincz`
- 来自 Amp 的 project 值取自 thread title（往往不准确）

---

## 三、改进建议

### 优先级 P0：重建时间线

**动作：全量 reset + 重处理**

```bash
bun run src/cli.ts reset
bun run src/cli.ts start
```

ingestor/reflector/consolidator 已修复，重处理后所有记忆时间线将正确。

### 优先级 P0：Ingestor 阶段增加去重

**动作：修改 `ingestor.ts`，在提取后、入库前查询已有记忆做标题/摘要相似度去重**

当前 ingestor 完全不检查已有记忆，导致同一知识被反复入库。建议：

```
提取完成后 → 对每条新记忆，查询 storage 中同 layer/同 tags 的已有记忆 → textSimilarity > 0.7 的跳过
```

### 优先级 P1：提高 Consolidator 的跨 batch 合并能力

**动作：**

1. 将 consolidator 的 `findRelatedMemoriesBatch` 的 `limit` 从 5 提高到 10-15
2. 增加一个定时 **全局去重 sweep**：定期扫描所有记忆，将完全相同标题的记忆合并为一条（保留最新/最完整的版本）
3. consolidator prompt 中明确指示：当 candidate 与新记忆标题 similarity > 0.8 时，必须选择 `update-existing`

### 优先级 P1：收紧 Insight 生成标准

**动作：修改 `reflectPrompt`**

在 Rules 中增加：
- 要求 insight 必须基于 ≥2 条来自**不同 session** 的记忆
- 禁止将单次传感器读数、单次操作结果提升为 insight
- 如果一条 insight 与已有 historical context 的 textSimilarity > 0.5，必须跳过

### 优先级 P1：校准 Salience 分布

**动作：修改 `ingestPrompt` 中的 salience 指引**

将：
```
salience: 0.9+ = critical, 0.7-0.9 = important, 0.5-0.7 = moderate, <0.5 = minor
```

改为：
```
salience distribution target: ~10% at 0.9+, ~25% at 0.7-0.8, ~40% at 0.5-0.6, ~25% at 0.3-0.4
- 0.9+: architecture decisions, critical bugs, security findings
- 0.7-0.8: reusable procedures, stable config facts
- 0.5-0.6: project-specific details, one-time fixes
- 0.3-0.4: session context, transient observations
- <0.3: trivial noise (consider not extracting at all)
```

### 优先级 P2：增加 Evaluator 阶段过滤

**动作：强化 `evaluatePrompt` 过滤规则**

增加以下规则：
- 重复的 cron/sync 执行记录（如 Zeekr sync）在第一次之后标记为 `worth_remembering: false`
- 纯环境上下文（timezone、shell、cwd）如果近期已有相同记录，跳过
- 单次传感器读数不值得记忆，除非出现异常

### 优先级 P2：统一 Project 命名

**动作：增加 project 规范化映射**

```typescript
const PROJECT_ALIASES = {
  'workspace-iot': 'iot',
  'workspace-code': 'code',
  'workspace-rube': 'rube',
  'workspace': 'general',
  'matincz': 'general',
};
```

在 ingestor 中对 `session.project` 做规范化处理。

### 优先级 P3：利用 Status 字段

**动作：**

1. 在 ingestPrompt 中增加 few-shot 示例，展示何时应标为 `proposed` vs `verified`
2. 增加后处理逻辑：当后续 session 中出现 "verified" 关键词（test pass、deploy success）时，将关联的 `proposed` 记忆升级为 `verified`

### 优先级 P3：定期记忆衰减与清理

**动作：增加一个 maintenance 任务**

- 每周运行一次，清理 salience < 0.3 且 >30 天未被引用的记忆
- 将完全重复的记忆合并（保留 supporting_memory_ids 最丰富的版本）
- 输出清理报告到 vault

---

## 四、预期改进效果

| 指标 | 当前 | 目标 |
|------|------|------|
| 总记忆数 | 5,369 | ~2,000-2,500 (去重后) |
| 完全重复比例 | 21.0% | <2% |
| Insight 占比 | 37.8% | 15-20% |
| Salience ≥0.8 占比 | 68.5% | 30-35% |
| 时间线准确性 | ❌ | ✅ |
| 每 session 平均产出 | 9.9 | 5-7 (更精准) |

---

## 五、实施验收记录

> 验收日期：2026-04-21
> 测试结果：93 pass / 0 fail / 310 assertions

### ✅ P0：时间线修复 — 已实施

| 文件 | 改动 | 状态 |
|------|------|------|
| `src/pipeline/ingestor.ts` | `new Date()` → `session.timestamp` | ✅ 已修复 |
| `src/pipeline/reflector.ts` | `new Date()` → `anchor.createdAt` | ✅ 已修复 |
| `src/pipeline/consolidator.ts` | create-synthesis 用 `memory.createdAt` 替代 `new Date()` | ✅ 已修复 |

测试覆盖：`ingest > normalizes project names and preserves the session timestamp`

### ✅ P0：Ingestor 阶段去重 — 已实施

| 改动 | 状态 |
|------|------|
| `ingest()` 接收 `storage` 参数，提取后调用 `findRelatedMemoriesBatch` 查重 | ✅ |
| 标题 similarity ≥ 0.9 直接判定重复 | ✅ |
| 标题+摘要 similarity ≥ 0.7 且有 tag 重叠则判定重复 | ✅ |
| 重复但有更高 status/salience/details 时，合并更新已有记忆 | ✅ |

测试覆盖：
- `ingest > skips memories that match existing same-layer memories with overlapping tags`
- `ingest > upgrades an existing proposed memory when a duplicate arrives with verified evidence`

### ✅ P1：Consolidator 增强 — 已实施

| 改动 | 状态 |
|------|------|
| `findRelatedMemoriesBatch` limit 从 5 → 12 | ✅ |
| 全局去重 sweep 已实现为 `storage.optimize()` → `deduplicateMemoryCorpus()` | ✅ |
| consolidator prompt 增加规则：title similarity > 0.8 时必须 update-existing | ✅ |
| `deduplicate.ts` 实现精确标题合并 + 跨 batch 近似合并（combinedSimilarity ≥ 0.78） | ✅ |

测试覆盖：
- `deduplicateExactTitleGroups > merges exact-title duplicates`
- `deduplicateMemoryCorpus > merges near-duplicate titles across batches`

### ✅ P1：Insight 生成标准收紧 — 已实施

| 改动 | 状态 |
|------|------|
| `reflectPrompt` 增加 `source_sessions` 字段暴露跨 session 信息 | ✅ |
| 要求 insight 必须基于 ≥2 条来自不同 session 的记忆 | ✅ |
| 禁止将 sensor readings / cron success / single-operation 提升为 insight | ✅ |
| 与 historical context similarity > 0.5 时跳过 | ✅ |

### ✅ P1：Salience 分布校准 — 已实施

| 改动 | 状态 |
|------|------|
| salience 指引从 `0.9+ = critical` 改为目标分布 | ✅ |
| 明确 ~10% at 0.9+, ~25% at 0.7-0.8, ~40% at 0.5-0.6, ~25% at 0.3-0.4 | ✅ |
| 增加 <0.3 = trivial noise; prefer not extracting | ✅ |

### ✅ P2：Evaluator 强化过滤 — 已实施

| 改动 | 状态 |
|------|------|
| `evaluatePrompt` 增加 cron/sync 重复过滤规则 | ✅ |
| 增加 env context 过滤规则 | ✅ |
| 增加 sensor reading 过滤规则 | ✅ |
| `evaluator.ts` 增加启发式预过滤：`isRepeatedAutomationNoise()` | ✅ |
| `evaluator.ts` 增加启发式预过滤：`isEnvironmentSnapshotOnly()` | ✅ |
| `evaluator.ts` 增加启发式预过滤：`isBenignTelemetryOnly()` | ✅ |

测试覆盖：
- `evaluate heuristics > skips repeated automation success logs before calling the llm`
- `evaluate heuristics > skips environment snapshot sessions before calling the llm`
- `evaluate heuristics > skips benign telemetry sessions before calling the llm`

### ✅ P2：Project 命名规范化 — 已实施

| 改动 | 状态 |
|------|------|
| `src/pipeline/project.ts` 实现 `normalizeProjectName()` | ✅ |
| `PROJECT_ALIASES` 映射表 (workspace-iot→iot, workspace→general 等) | ✅ |
| `ingestor.ts` 调用 `normalizeProjectName(session.project)` | ✅ |

### ⏳ P3：Status 字段利用 — 部分实施

| 改动 | 状态 |
|------|------|
| prompt 中已有 proposed/observed/verified 指引 | ✅ |
| ingestor 去重时 status 升级逻辑 (`statusPriority`) | ✅ |
| 后处理自动升级 proposed → verified（基于后续 session） | ❌ 未实施 |

### ⏳ P3：定期记忆衰减与清理 — 部分实施

| 改动 | 状态 |
|------|------|
| `storage.optimize()` 提供按需去重清理 | ✅ |
| CLI `optimize` 命令可用 | ✅ |
| 自动周期性 sweep（如每周定时） | ❌ 未实施 |
| 按 salience + age 自动淘汰 | ❌ 未实施 |

---

## 六、待执行操作

### 1. 全量 reset + 重处理（所有改动生效的前提）

```bash
bun run src/cli.ts reset
bun run src/cli.ts start
```

### 2. 重处理后执行一次 optimize

```bash
bun run src/cli.ts optimize
```

### 3. 后续可选迭代

- P3 自动 status 升级：监听后续 session 中 test pass / deploy success 关键词，自动升级关联 proposed 记忆
- P3 定期 sweep：增加 cron 或 daemon 内 timer，每周自动执行 `optimize` + 清理低价值旧记忆

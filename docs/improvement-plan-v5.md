# Mnemonic 记忆质量改进执行报告 v5

> 编制日期：2026-05-05
> 触发：基于对 3,601 条线上记忆的质量评估,发现**记忆生命周期管理(status / contradiction / merge)三项核心机制基本未运转**。
> 受众:执行此报告的 AI agent。每项给出**根因、改动文件、改动内容、验收方式**。按 P0 → P2 顺序实施,每完成一项跑 `bun test`。

---

## 0. 评估证据(为什么要做这次改动)

| 指标 | 实测 | 期望 | 结论 |
|---|---|---|---|
| status=verified | **1 / 3601 (0.03%)** | ≥10% | 🔴 升级链断裂 |
| status=superseded / deprecated | **0** | >0 | 🔴 supersede 未生效 |
| salience ≥ 0.8 | **43.1%** | ~30% | 🟡 v4 校准未达标 |
| salience < 0.3 | **0%** | >5% | 🟡 没有低值记忆 |
| contradicts 非空 | **2.3%** | ≥10% | 🔴 矛盾检测形同虚设 |
| 多 sourceSessionIds | **7.5%** | ≥25% | 🟡 跨会话合并稀少 |
| project 字段非空 | **47.1%** | ≥80% | 🟡 切片维度缺失 |
| 标题完全重复组数 | **103 组** | <20 | 🟡 dedup 仍漏检近义 |

---

## 1. 根因分析(verified=1 的真凶)

[src/pipeline/status-updater.ts#L30](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/status-updater.ts#L30) 第一行守卫:

```typescript
if (memory.status !== "proposed") return false;
```

但 [src/pipeline/ingestor.ts#L47](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts#L47) 默认值是 `"observed"`,且 LLM prompt ([src/llm/prompts.ts#L256](file:///Users/matincz/Desktop/Mnemonic/src/llm/prompts.ts#L256)) 也几乎只输出 `"observed"`/`"verified"`。结果:**没有任何记忆进入 `proposed` 状态,status-updater 永远直接 return false**。这是一个真实的逻辑死锁,与 v4 的"时间窗口健壮化"无关。

---

## 全局约束

1. `bun test` 必须保持全绿
2. `Memory` schema 字段不删不改名
3. 所有改动必须**同时改对应测试**,否则不算完成
4. 验证命令:
   ```bash
   bun test
   bun run src/cli.ts paths
   bun run src/cli.ts metrics --since 7d   # 观察修复前后差异
   ```

---

## P0:打通 status 升级链(最高优先级)

### 任务 0.1 — 放宽 status-updater 的入口门槛
**文件**:[src/pipeline/status-updater.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/status-updater.ts#L30)

**改动**:
```typescript
// 旧:
if (memory.status !== "proposed") return false;
// 新:
if (memory.status === "verified" || memory.status === "superseded") return false;
// 即:proposed 与 observed 都允许被升级为 verified
```

**理由**:`observed` 仅表示"在 transcript 中看到过",并不等于"被验证"。一个 observed 的过程性记忆,如果后续 session 给出了 exit_code=0 的命令证据,理应升级为 verified。

**测试**:[tests/pipeline/status-updater.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/status-updater.test.ts)
- 新增:输入 status=`observed` 的 candidate + 含 verification signal 的新 session → 升级为 verified
- 保留:status=`verified` 的不再被改动

### 任务 0.2 — Reflector 输出降级为 proposed
**文件**:[src/pipeline/reflector.ts#L57](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/reflector.ts#L57)

**改动**:把 reflector 合成的 insight 默认 `status` 从 `"observed"` 改为 `"proposed"`。

**理由**:reflector 产出的是 LLM 二次综合的猜测性 insight,本质上就是"待验证的假设",理应进入 proposed 通道,等待后续 session 给出证据再升 verified。

**测试**:[tests/pipeline/reflector.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/reflector.test.ts)
- 断言 reflector 产出的所有 memory.status === `"proposed"`

### 任务 0.3 — 修复 LLM prompt 引导
**文件**:[src/llm/prompts.ts#L256](file:///Users/matincz/Desktop/Mnemonic/src/llm/prompts.ts#L256)

**改动**:把 status 三档的描述改为更明确的判断标准:
```
- "proposed": 仅在对话中被建议或推断,但未在当前 session 内被命令/测试/部署确认
- "observed": 在 transcript 中被多次出现或用户明确陈述,但无可执行证据
- "verified": 当前 session 内有命令(bun test/git push/curl)且 exit_code=0/HTTP 200 等明确成功信号
```

**测试**:无需新增测试(prompt 改动通过 e2e session 观察 distribution)。

---

## P0:激活 contradiction 检测

### 任务 0.4 — Linker 提示词强制返回 contradicts
**文件**:[src/pipeline/linker.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/linker.ts)、[src/llm/prompts.ts](file:///Users/matincz/Desktop/Mnemonic/src/llm/prompts.ts) 中 linker 部分

**根因**:linker 已经从 LLM 抽取 `contradicts_ids`(linker.ts L53),但实际填充率只有 2.3%——说明 LLM 几乎不输出这个字段。

**改动**:
1. 在 linker prompt 中加入明确示例(few-shot):
   ```
   Example: candidate "use SHA-256 for tokens" vs new "use HMAC-SHA-512 for tokens"
   → contradicts_ids: ["mem-xxx"]
   ```
2. 在 linker.ts 调用 LLM 后,如果 batch 内 candidate 与 incoming **同 project + 同 layer + cosine ≥ 0.85** 但 details 文本相反极性(简单关键词 `not / never / remove / instead of`),即使 LLM 没标也补一条 contradicts 关系。
3. 提供新内部函数 `heuristicContradicts(a: Memory, b: Memory): boolean`,放在 [src/pipeline/linker.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/linker.ts) 顶部。

**测试**:[tests/pipeline/linker.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/linker.test.ts)
- 构造一对极性相反的 memory + LLM 返回空 contradicts_ids → heuristic 必须补上

### 任务 0.5 — Linker 完成 supersede 闭环
**文件**:[src/pipeline/linker.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/linker.ts)

**改动**:当一对 memory 互为 contradicts 且 incoming.createdAt > existing.createdAt + 1day,把 existing.status 写为 `"superseded"`。
- 需要新增 storage 接口 `updateStatus(id, status)` —— 已存在则复用
- 同时把 existing.salience ×0.7(避免被替代的旧知识仍然高权)

**测试**:覆盖整个流程,断言 superseded 状态写入 SQLite 并能 listByLayer 时被排除(可选)。

---

## P1:Salience 分布修正

### 任务 1.1 — 全局 percentile 后置归一化
**文件**:新增 [src/pipeline/salience-normalize.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/salience-normalize.ts) + 集成到 [src/pipeline/index.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/index.ts) 收尾阶段

**根因**:v4 的 calibrateSalience 仅在单 session 内归一化(eligible.length ≥ 4)。跨 session 累积导致**全局分布漂高**(43.1% ≥0.8)。需要周期性全局再校准。

**改动**:
- 新增 `globalSalienceRecalibration(storage, options)`:
  1. 读取所有非 verified / 非 superseded 记忆的 salience
  2. 计算实际 percentile,映射到目标分布:`p25=0.3, p50=0.5, p75=0.7, p90=0.85, p99=0.95`
  3. 写回(批量 SQL update)
- 在 CLI 增加 `bun run src/cli.ts recalibrate` 子命令(手动触发)
- 在 pipeline `optimize` / `reset` 流程末尾自动调用一次

**测试**:[tests/pipeline/salience-normalize.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/salience-normalize.test.ts)
- 输入:1000 条 salience 全部 ∈ [0.7, 1.0]
- 输出:p50 ≈ 0.5(±0.05),p90 ≈ 0.85(±0.05)

---

## P1:跨会话合并增加

### 任务 1.2 — Dedup 召回引入 embedding-only 通道
**文件**:[src/pipeline/ingestor.ts#findDuplicateCandidate](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts)

**根因**:多源合并率 7.5% + 标题完全重复 103 组 → dedup 漏检明显。当前要求 layer + tag 部分匹配才进入相似度比较,导致跨 layer / 不同 tag 的近义记忆无法合并。

**改动**:
- 在现有候选召回之外,**额外**用 embedding 召回 top-5 cosine ≥ 0.88 的候选(忽略 layer / tag 限制)
- 仅当 embedding 候选满足 `same project OR no project on either side` 才进入合并
- 合并时调用 [ingestor.ts#L211](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts#L211) 现有路径,确保 sourceSessionIds 累加

**测试**:[tests/pipeline/ingestor.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/ingestor.test.ts)
- 一条 layer=semantic 旧记忆 + 一条 layer=insight 新记忆,文本近义 → 必须 merge,sourceSessionIds 长度 ≥2

### 任务 1.3 — 合并时保留 provenance(回归 v3 任务)
**文件**:[src/pipeline/ingestor.ts#L182-L211](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts)

**改动**:核对 merge 函数,确保:
- `sourceSessionIds` 是**并集**(目前已是)
- `sourceAgent` 改为 `Set<string>` 并在 [src/types.ts](file:///Users/matincz/Desktop/Mnemonic/src/types.ts) 增加 optional `sourceAgents: string[]` 字段(向后兼容)
- 单值 `sourceSessionId` / `sourceAgent` 保留为最初值(不被覆盖)

**测试**:断言三次合并后 `sourceAgents` 包含三个不同 agent 名。

---

## P1:project 字段强制填充

### 任务 1.4 — Ingestor fallback 推断 project
**文件**:[src/pipeline/project.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/project.ts)(目前只 16 行)+ [src/pipeline/ingestor.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/ingestor.ts)

**改动**:
- project.ts 中已有的推断函数,把它接到 ingestor 的入口:**当 LLM 没填 project 时**,从以下来源推断:
  1. session 工作目录(`cwd` / `pwd`)
  2. 命中文件路径(`/Users/.../Project/src/...`)
  3. session 中出现的 git 仓库名
- 推断失败则填 `"general"`(而不是空),便于后续 metrics 切片

**测试**:[tests/pipeline/project.test.ts](file:///Users/matincz/Desktop/Mnemonic/tests/pipeline/project.test.ts)
- session 含 `/Users/x/Desktop/Foo/src/index.ts` → project="Foo"
- 无任何路径线索 → project="general"

---

## P2:可观测性补齐

### 任务 2.1 — 扩展 metrics 模块
**文件**:[src/pipeline/metrics.ts](file:///Users/matincz/Desktop/Mnemonic/src/pipeline/metrics.ts)

**改动**:在 `PipelineMetrics` 中新增字段:
```typescript
verifiedRatio: number;          // verified / total
supersededAdded: number;
contradictsAdded: number;
multiSourceRatio: number;       // memories with sourceSessionIds.length>1
projectCoverage: number;        // memories with project / total
duplicateTitleGroups: number;   // 在 optimize 阶段统计
```

并在 `bun run src/cli.ts metrics` 输出中加这几项,与 v5 的 P0/P1 改动联动观察是否回升。

---

## 验收清单

```
[ ] P0.1 status-updater 放宽门槛(允许 observed 升级)
[ ] P0.2 reflector 默认产出 proposed
[ ] P0.3 prompt 重写 status 判断标准
[ ] P0.4 linker 加 contradicts 启发式补全 + few-shot
[ ] P0.5 linker 完成 supersede 闭环 + salience 衰减
[ ] P1.1 全局 salience percentile 重校准 + CLI recalibrate
[ ] P1.2 dedup 增加 embedding-only 召回通道
[ ] P1.3 merge 保留 sourceAgents 数组
[ ] P1.4 project 自动推断 + general 兜底
[ ] P2.1 metrics 扩展 + CLI 输出
[ ] bun test 全绿
[ ] bun run src/cli.ts paths 正常
[ ] bun run src/cli.ts recalibrate(P1.1 完成后)能跑通
```

---

## 完成后建议执行

```bash
# 1. 重置后用新逻辑全量重处理
bun run src/cli.ts reset
bun run src/cli.ts start

# 2. 触发一次全局 salience 校准
bun run src/cli.ts recalibrate

# 3. 收集对比指标
bun run src/cli.ts metrics --since 7d
```

### 预期指标对比

| 指标 | 当前 | v5 目标 |
|---|---|---|
| verified 占比 | 0.03% | ≥10% |
| superseded 数量 | 0 | >0(随版本演进自然产生)|
| salience ≥0.8 | 43.1% | 25–35% |
| salience <0.3 | 0% | 5–15% |
| contradicts 非空 | 2.3% | ≥10% |
| 多源记忆 | 7.5% | ≥25% |
| project 覆盖 | 47.1% | ≥95%(含 general 兜底)|
| 标题重复组 | 103 | <30 |

---

## 风险与回滚

- **任务 0.1 放宽 observed → verified**:可能让 verification signal 误报扩散。**缓解**:任务 0.4 的双锚定(同 message 命令 + exit_code)+ 任务 2.1 的 verifiedRatio 监控,异常时立刻调回 `=== "proposed"`。
- **任务 0.5 supersede 自动写入**:可能误把仍有效的旧记忆下线。**缓解**:仅在 cosine ≥0.85 + 极性反向 + createdAt 间隔 ≥1 天才触发;并且 superseded 记忆**不删除**,仅状态标记,可手动恢复。
- **任务 1.1 全局 recalibration**:首次运行会修改大量 salience,**不可逆**。**缓解**:先 dry-run 输出 diff(`--dry-run` 选项),确认分布合理后再写库。
- **任务 1.2 embedding-only 召回**:可能产生跨 project 误合并。**缓解**:同 project 或双方均无 project 才允许合并。

import { verifyAgentIntegration, type AgentIntegrationVerification } from "./integrations";
import { buildRecallCapsule, type RecallCapsule } from "./recall";
import type { Storage } from "./storage";

export interface AgentRecallAuditOptions {
  root: string;
  cwd?: string;
  task: string;
  iterations?: number;
  maxRecallMs?: number;
}

export interface AgentRecallAuditIteration {
  index: number;
  recall: {
    ok: boolean;
    durationMs: number;
    confidence: RecallCapsule["confidence"];
    memoryCount: number;
    issue?: string;
  };
}

export interface AgentRecallAuditResult {
  ok: boolean;
  root: string;
  task: string;
  maxRecallMs: number;
  integration: AgentIntegrationVerification[];
  iterations: AgentRecallAuditIteration[];
  issues: string[];
}

const DEFAULT_ITERATIONS = 3;
const DEFAULT_MAX_RECALL_MS = 500;

export async function runAgentRecallAudit(
  storage: Storage,
  options: AgentRecallAuditOptions,
): Promise<AgentRecallAuditResult> {
  const iterations = Math.max(1, Math.floor(options.iterations ?? DEFAULT_ITERATIONS));
  const maxRecallMs = options.maxRecallMs ?? DEFAULT_MAX_RECALL_MS;
  const integration = verifyAgentIntegration(options.root, "all");
  const issues = integration.flatMap((item) => item.issues.map((issue) => `${item.agent}:${issue}`));
  const auditIterations: AgentRecallAuditIteration[] = [];

  for (let index = 1; index <= iterations; index += 1) {
    const startedAt = nowMs();
    try {
      const capsule = await buildRecallCapsule(storage, {
        task: options.task,
        cwd: options.cwd,
        mode: "fast",
      });
      const durationMs = elapsedMs(startedAt);
      const latencyIssue = durationMs > maxRecallMs ? `iteration-${index}:recall-latency-ms:${durationMs.toFixed(3)}` : undefined;
      if (latencyIssue) {
        issues.push(latencyIssue);
      }

      auditIterations.push({
        index,
        recall: {
          ok: !latencyIssue,
          durationMs,
          confidence: capsule.confidence,
          memoryCount: capsule.memories.length,
          issue: latencyIssue,
        },
      });
    } catch (error) {
      const durationMs = elapsedMs(startedAt);
      const issue = `iteration-${index}:recall-error:${error instanceof Error ? error.message : String(error)}`;
      issues.push(issue);
      auditIterations.push({
        index,
        recall: {
          ok: false,
          durationMs,
          confidence: "low",
          memoryCount: 0,
          issue,
        },
      });
    }
  }

  return {
    ok: issues.length === 0,
    root: options.root,
    task: options.task,
    maxRecallMs,
    integration,
    iterations: auditIterations,
    issues,
  };
}

function nowMs() {
  return Date.now();
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type AgentIntegration = "codex" | "claude" | "gemini" | "all";

export interface AgentIntegrationTarget {
  agent: Exclude<AgentIntegration, "all">;
  fileName: string;
}

export interface AgentIntegrationResult extends AgentIntegrationTarget {
  filePath: string;
  action: "created" | "updated" | "unchanged" | "dry-run";
}

export interface AgentIntegrationVerification extends AgentIntegrationTarget {
  filePath: string;
  installed: boolean;
  issues: string[];
}

const START_MARKER = "<!-- MNEMONIC:RECALL:START -->";
const END_MARKER = "<!-- MNEMONIC:RECALL:END -->";

const TARGETS: AgentIntegrationTarget[] = [
  { agent: "codex", fileName: "AGENTS.md" },
  { agent: "claude", fileName: "CLAUDE.md" },
  { agent: "gemini", fileName: "GEMINI.md" },
];

export function getAgentIntegrationTargets(agent: AgentIntegration): AgentIntegrationTarget[] {
  if (agent === "all") {
    return [...TARGETS];
  }
  return TARGETS.filter((target) => target.agent === agent);
}

export function buildAgentIntegrationBlock(agent: Exclude<AgentIntegration, "all">) {
  const agentName = agent === "codex" ? "Codex" : agent === "claude" ? "Claude Code" : "Gemini";
  return [
    START_MARKER,
    "## Mnemonic Recall",
    "",
    `For ${agentName}, use Mnemonic as a quiet project memory layer.`,
    "",
    "Before planning, editing, debugging, or final reporting on a repo task, run:",
    "",
    '```bash',
    'if command -v mnemonic >/dev/null 2>&1; then',
    '  mnemonic recall --json --cwd "$PWD" "<current user task or failure text>"',
    'else',
    '  bun run src/cli.ts recall --json --cwd "$PWD" "<current user task or failure text>"',
    'fi',
    '```',
    "",
    "Inject only the returned `context` under a `Memory Context` heading when it is not `Relevant memory:\\n- none`.",
    "Use the returned memory ids as source trace, but do not quote or expand full memories unless the user asks.",
    "If the recall confidence is `low`, treat it as optional background and do not let it override current files, tests, or explicit user instructions.",
    END_MARKER,
  ].join("\n");
}

export function applyAgentIntegration(root: string, agent: AgentIntegration, options: { dryRun?: boolean } = {}) {
  return getAgentIntegrationTargets(agent).map((target): AgentIntegrationResult => {
    const filePath = join(root, target.fileName);
    const block = buildAgentIntegrationBlock(target.agent);
    const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    const next = upsertMarkedBlock(existing, block);

    if (options.dryRun) {
      return { ...target, filePath, action: "dry-run" };
    }
    if (existing === next) {
      return { ...target, filePath, action: "unchanged" };
    }

    writeFileSync(filePath, next);
    return { ...target, filePath, action: existing ? "updated" : "created" };
  });
}

export function verifyAgentIntegration(root: string, agent: AgentIntegration): AgentIntegrationVerification[] {
  return getAgentIntegrationTargets(agent).map((target) => {
    const filePath = join(root, target.fileName);
    const issues: string[] = [];
    if (!existsSync(filePath)) {
      return { ...target, filePath, installed: false, issues: ["missing-file"] };
    }

    const content = readFileSync(filePath, "utf8");
    if (!content.includes(START_MARKER)) {
      issues.push("missing-start-marker");
    }
    if (!content.includes(END_MARKER)) {
      issues.push("missing-end-marker");
    }
    if (!content.includes('mnemonic recall --json --cwd "$PWD"') || !content.includes("bun run src/cli.ts recall --json --cwd")) {
      issues.push("missing-recall-command");
    }
    if (!content.includes("Memory Context")) {
      issues.push("missing-memory-context-instruction");
    }

    return { ...target, filePath, installed: issues.length === 0, issues };
  });
}

function upsertMarkedBlock(existing: string, block: string) {
  const start = existing.indexOf(START_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (start >= 0 && end >= start) {
    const afterEnd = end + END_MARKER.length;
    return `${existing.slice(0, start).trimEnd()}\n\n${block}\n\n${existing.slice(afterEnd).trimStart()}`.trimEnd() + "\n";
  }

  if (!existing.trim()) {
    return `${block}\n`;
  }

  return `${existing.trimEnd()}\n\n${block}\n`;
}

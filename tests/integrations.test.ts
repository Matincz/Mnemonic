import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyAgentIntegration, buildAgentIntegrationBlock, getAgentIntegrationTargets, verifyAgentIntegration } from "../src/integrations";

describe("agent integrations", () => {
  it("builds a Codex AGENTS.md recall block", () => {
    const block = buildAgentIntegrationBlock("codex");

    expect(block).toContain("<!-- MNEMONIC:RECALL:START -->");
    expect(block).toContain('mnemonic recall --json --cwd "$PWD"');
    expect(block).toContain("bun run src/cli.ts recall --json --cwd");
    expect(block).toContain("Memory Context");
    expect(block).toContain("<!-- MNEMONIC:RECALL:END -->");
  });

  it("maps supported agents to their local instruction files", () => {
    expect(getAgentIntegrationTargets("all").map((target) => target.fileName)).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
    ]);
  });

  it("writes and updates a marked recall block idempotently", () => {
    const root = mkdtempSync(join(tmpdir(), "mnemonic-integrations-"));
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, "# Existing\n\nKeep this line.\n");

    try {
      const first = applyAgentIntegration(root, "codex");
      const second = applyAgentIntegration(root, "codex");
      const content = readFileSync(agentsPath, "utf8");

      expect(first[0]?.action).toBe("updated");
      expect(second[0]?.action).toBe("unchanged");
      expect(content).toContain("Keep this line.");
      expect(content.match(/MNEMONIC:RECALL:START/g)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies which local agent instruction files are installed", () => {
    const root = mkdtempSync(join(tmpdir(), "mnemonic-integrations-verify-"));

    try {
      applyAgentIntegration(root, "codex");
      const results = verifyAgentIntegration(root, "all");

      expect(results.map((result) => [result.agent, result.installed])).toEqual([
        ["codex", true],
        ["claude", false],
        ["gemini", false],
      ]);
      expect(results[0]?.issues).toEqual([]);
      expect(results[1]?.issues).toContain("missing-file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

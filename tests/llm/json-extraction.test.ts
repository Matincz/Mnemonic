import { describe, expect, it } from "bun:test";
import { extractJSONFromText, normalizeArrayResponse, parseJSONWithRecovery } from "../../src/llm";

describe("extractJSONFromText", () => {
  it("prefers json fences over other fenced blocks", () => {
    const text = `Here is the schema:

\`\`\`yaml
title: Example
\`\`\`

\`\`\`json
[{"type":"concept","slug":"progressive-disclosure"}]
\`\`\`
`;

    expect(extractJSONFromText(text)).toBe(
      `[{"type":"concept","slug":"progressive-disclosure"}]`,
    );
  });

  it("extracts a raw JSON object from surrounding prose", () => {
    const text = `Use this result:
{"pages":["entities/memory-agent"]}
Thanks.`;

    expect(extractJSONFromText(text)).toBe(`{"pages":["entities/memory-agent"]}`);
  });

  it("parses overescaped json arrays", () => {
    const text = `[
  {
    \\\"action\\\": \\\"create\\\",
    \\\"type\\\": \\\"entity\\\",
    \\\"slug\\\": \\\"codex-agent\\\",
    \\\"title\\\": \\\"Codex Agent\\\",
    \\\"content\\\": \\\"---\\\\ntitle: Codex Agent\\\\n---\\\\n\\\",
    \\\"reason\\\": \\\"new entity\\\"
  }
]`;

    expect(parseJSONWithRecovery(text)).toEqual([
      {
        action: "create",
        type: "entity",
        slug: "codex-agent",
        title: "Codex Agent",
        content: "---\ntitle: Codex Agent\n---\n",
        reason: "new entity",
      },
    ]);
  });

  it("parses json embedded inside a quoted string", () => {
    const text = "\"[{\\\"action\\\":\\\"update\\\",\\\"type\\\":\\\"concept\\\",\\\"slug\\\":\\\"memory-vault\\\",\\\"title\\\":\\\"Memory Vault\\\",\\\"content\\\":\\\"body\\\",\\\"reason\\\":\\\"merge\\\"}]\"";

    expect(parseJSONWithRecovery(text)).toEqual([
      {
        action: "update",
        type: "concept",
        slug: "memory-vault",
        title: "Memory Vault",
        content: "body",
        reason: "merge",
      },
    ]);
  });

  it("normalizes arrays containing stringified json objects", () => {
    const parsed = normalizeArrayResponse([
      "{\"action\":\"create\",\"type\":\"entity\",\"slug\":\"codex-agent\",\"title\":\"Codex Agent\",\"content\":\"body\",\"reason\":\"new entity\"}",
      "not-json",
    ]);

    expect(parsed).toEqual([
      {
        action: "create",
        type: "entity",
        slug: "codex-agent",
        title: "Codex Agent",
        content: "body",
        reason: "new entity",
      },
    ]);
  });
});

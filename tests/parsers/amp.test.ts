// tests/parsers/amp.test.ts
import { describe, it, expect } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { AmpParser } from "../../src/parsers/amp";

const SAMPLE_MD = `---
title: Fix auth bug
threadId: T-019d0000-0000-0000-0000-000000000001
created: 2026-04-12T10:00:00.000Z
agentMode: smart
---

# Fix auth bug

## User

How do I fix the JWT refresh token issue?

## Assistant

The issue is that the refresh token is not being rotated on each use. Update the auth middleware to issue a new refresh token on every successful refresh.

## User

Can you show me the code?

## Assistant

Here is the updated middleware code...
`;

describe("AmpParser", () => {
  const parser = new AmpParser();

  it("parses markdown into ParsedSession", () => {
    const session = parser.parseMarkdown(SAMPLE_MD, "T-019d0000-0000-0000-0000-000000000001");
    expect(session).not.toBeNull();
    expect(session!.source).toBe("amp");
    expect(session!.messages).toHaveLength(4);
    expect(session!.messages[0].role).toBe("user");
    expect(session!.messages[0].content).toContain("JWT");
    expect(session!.messages[1].role).toBe("assistant");
    expect(session!.id).toContain("amp-");
  });

  it("reads recent threads through a resolved amp binary", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mnemonic-amp-"));
    const ampBinary = join(tempDir, "amp");

    writeFileSync(
      ampBinary,
      `#!/bin/sh
set -eu
if [ "$1" = "threads" ] && [ "$2" = "list" ]; then
  cat <<'EOF'
Title                                         Last Updated  Visibility  Messages  Thread ID
────────────────────────────────────────────  ────────────  ──────────  ────────  ──────────────────────────────────────
Example thread                                4h ago        Private     2         T-019d0000-0000-0000-0000-000000000123
EOF
  exit 0
fi
if [ "$1" = "threads" ] && [ "$2" = "markdown" ]; then
  cat <<'EOF'
---
title: Example thread
created: 2026-04-12T10:00:00.000Z
---

## User

Hello

## Assistant

Hi there
EOF
  exit 0
fi
exit 1
`,
    );
    chmodSync(ampBinary, 0o755);

    try {
      const shimmed = new AmpParser(ampBinary);
      const ids = await shimmed.listRecentThreads();
      expect(ids).toEqual(["T-019d0000-0000-0000-0000-000000000123"]);

      const session = await shimmed.parse(ids[0]!);
      expect(session).not.toBeNull();
      expect(session!.source).toBe("amp");
      expect(session!.messages).toHaveLength(2);
      expect(session!.messages[0].content).toBe("Hello");
      expect(session!.messages[1].content).toBe("Hi there");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

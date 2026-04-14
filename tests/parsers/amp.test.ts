// tests/parsers/amp.test.ts
import { describe, it, expect } from "bun:test";
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
});

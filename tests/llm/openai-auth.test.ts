import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

describe("openai oauth auth helpers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mock.restore();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("extracts account id from JWT claims", async () => {
    const { extractAccountIdFromTokenResponse } = await import("../../src/llm/openai-auth");

    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_from_claims",
        },
      }),
    ).toString("base64url");
    const jwt = `${header}.${payload}.signature`;

    expect(
      extractAccountIdFromTokenResponse({
        access_token: jwt,
        refresh_token: "refresh",
        id_token: jwt,
        expires_in: 3600,
      }),
    ).toBe("acct_from_claims");
  });

  it("refreshes oauth tokens when expired", async () => {
    const { refreshOAuthTokensIfNeeded } = await import("../../src/llm/openai-auth");

    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 7200,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const refreshed = await refreshOAuthTokensIfNeeded({
      authMode: "oauth",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() - 1,
      accountId: "acct_123",
      model: "gpt-5.4",
    });

    expect(refreshed.accessToken).toBe("new-access");
    expect(refreshed.refreshToken).toBe("new-refresh");
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
  });

  it("builds ChatGPT OAuth headers", async () => {
    const { buildCodexHeaders } = await import("../../src/llm/openai-auth");

    const headers = buildCodexHeaders("access-token", "acct_123");

    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("ChatGPT-Account-Id")).toBe("acct_123");
  });
});

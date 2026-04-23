import { createServer } from "http";
import os from "os";
import { spawn } from "child_process";
import type { OAuthSettings } from "../settings";

const ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const OAUTH_PORT = 1455;
const OAUTH_CALLBACK_PATH = "/auth/callback";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;

export interface TokenResponse {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

interface DeviceAuthStart {
  device_auth_id: string;
  user_code: string;
  interval: string;
}

interface DeviceAuthToken {
  authorization_code: string;
  code_verifier: string;
}

interface PendingOAuth {
  state: string;
  pkce: PkceCodes;
  resolve: (tokens: TokenResponse) => void;
  reject: (error: Error) => void;
  timeout: Timer;
}

interface PkceCodes {
  verifier: string;
  challenge: string;
}

export interface DeviceAuthPrompt {
  verificationUrl: string;
  userCode: string;
}

export interface OAuthLoginResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
}

let oauthServer: ReturnType<typeof createServer> | undefined;
let pendingOAuth: PendingOAuth | undefined;

function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return Buffer.from(bytes).toString("base64url");
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return {
    verifier,
    challenge: base64UrlEncode(hash),
  };
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "memory-agent",
  });

  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

function redirectUri() {
  return `http://localhost:${OAUTH_PORT}${OAUTH_CALLBACK_PATH}`;
}

function clearPendingOAuth() {
  if (!pendingOAuth) return;
  clearTimeout(pendingOAuth.timeout);
  pendingOAuth = undefined;
}

function stopOAuthServer() {
  if (!oauthServer) return;
  oauthServer.close();
  oauthServer = undefined;
}

async function ensureOAuthServer(): Promise<void> {
  if (oauthServer) return;

  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`);

    if (url.pathname !== OAUTH_CALLBACK_PATH) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");

    if (error) {
      pendingOAuth?.reject(new Error(errorDescription || error));
      clearPendingOAuth();
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Authorization failed</h1><p>You can close this window.</p>");
      return;
    }

    if (!pendingOAuth || state !== pendingOAuth.state || !code) {
      pendingOAuth?.reject(new Error("Invalid OAuth callback"));
      clearPendingOAuth();
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h1>Authorization failed</h1><p>Invalid callback state.</p>");
      return;
    }

    const current = pendingOAuth;
    clearPendingOAuth();
    exchangeCodeForTokens(code, redirectUri(), current.pkce)
      .then((tokens) => current.resolve(tokens))
      .catch((error) => current.reject(error instanceof Error ? error : new Error(String(error))));

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Authorization successful</h1><p>You can close this window.</p>");
  });

  await new Promise<void>((resolve, reject) => {
    oauthServer!.once("error", reject);
    oauthServer!.listen(OAUTH_PORT, () => {
      oauthServer!.off("error", reject);
      resolve();
    });
  });
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    clearPendingOAuth();
    pendingOAuth = {
      state,
      pkce,
      resolve,
      reject,
      timeout: setTimeout(() => {
        pendingOAuth?.reject(new Error("OAuth callback timed out"));
        clearPendingOAuth();
      }, OAUTH_TIMEOUT_MS),
    };
  });
}

async function exchangeCodeForTokens(code: string, callbackRedirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackRedirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: HTTP ${response.status}`);
  }

  return response.json() as Promise<TokenResponse>;
}

function normalizeLogin(tokens: TokenResponse): OAuthLoginResult {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId: extractAccountIdFromTokenResponse(tokens),
  };
}

async function tryOpenUrl(url: string): Promise<void> {
  const commands =
    os.platform() === "darwin"
      ? [["open", url]]
      : os.platform() === "win32"
        ? [["cmd", "/c", "start", "", url]]
        : [["xdg-open", url]];

  for (const command of commands) {
    try {
      const child = spawn(command[0], command.slice(1), {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return;
    } catch {}
  }
}

export async function authenticateWithOpenAIBrowser(onUrl?: (url: string) => void): Promise<OAuthLoginResult> {
  await ensureOAuthServer();
  const pkce = await generatePKCE();
  const state = generateState();
  const url = buildAuthorizeUrl(redirectUri(), pkce, state);
  onUrl?.(url);
  await tryOpenUrl(url);

  try {
    const tokens = await waitForOAuthCallback(pkce, state);
    return normalizeLogin(tokens);
  } finally {
    stopOAuthServer();
  }
}

export async function authenticateWithOpenAIHeadless(onPrompt?: (prompt: DeviceAuthPrompt) => void): Promise<OAuthLoginResult> {
  const startResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "memory-agent/0.1.0",
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!startResponse.ok) {
    throw new Error(`Failed to initiate device auth: HTTP ${startResponse.status}`);
  }

  const device = (await startResponse.json()) as DeviceAuthStart;
  onPrompt?.({
    verificationUrl: `${ISSUER}/codex/device`,
    userCode: device.user_code,
  });

  const intervalMs = Math.max(parseInt(device.interval) || 5, 1) * 1000;

  while (true) {
    const pollResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "memory-agent/0.1.0",
      },
      body: JSON.stringify({
        device_auth_id: device.device_auth_id,
        user_code: device.user_code,
      }),
    });

    if (pollResponse.ok) {
      const pollData = (await pollResponse.json()) as DeviceAuthToken;
      const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: pollData.authorization_code,
          redirect_uri: `${ISSUER}/deviceauth/callback`,
          client_id: CLIENT_ID,
          code_verifier: pollData.code_verifier,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: HTTP ${tokenResponse.status}`);
      }

      return normalizeLogin((await tokenResponse.json()) as TokenResponse);
    }

    if (pollResponse.status !== 403 && pollResponse.status !== 404) {
      throw new Error(`Device auth failed: HTTP ${pollResponse.status}`);
    }

    await Bun.sleep(intervalMs + 3000);
  }
}

export function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractAccountIdFromClaims(claims: Record<string, unknown>): string | undefined {
  if (typeof claims.chatgpt_account_id === "string") {
    return claims.chatgpt_account_id;
  }

  const auth = claims["https://api.openai.com/auth"];
  if (typeof auth === "object" && auth !== null && typeof (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id === "string") {
    return (auth as { chatgpt_account_id: string }).chatgpt_account_id;
  }

  const organizations = claims.organizations;
  if (Array.isArray(organizations)) {
    const first = organizations[0];
    if (typeof first === "object" && first !== null && typeof (first as { id?: unknown }).id === "string") {
      return (first as { id: string }).id;
    }
  }

  return undefined;
}

export function extractAccountIdFromTokenResponse(tokens: TokenResponse): string | undefined {
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (!token) continue;
    const claims = parseJwtClaims(token);
    if (!claims) continue;
    const accountId = extractAccountIdFromClaims(claims);
    if (accountId) return accountId;
  }

  return undefined;
}

export function buildCodexHeaders(accessToken: string, accountId?: string): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
    authorization: `Bearer ${accessToken}`,
    originator: "memory-agent",
    "User-Agent": "memory-agent/0.1.0",
  });

  if (accountId) {
    headers.set("ChatGPT-Account-Id", accountId);
  }

  return headers;
}

export function needsOAuthRefresh(settings: OAuthSettings, now = Date.now()): boolean {
  return settings.expiresAt <= now + REFRESH_SKEW_MS;
}

export async function refreshOAuthTokensIfNeeded(settings: OAuthSettings): Promise<OAuthSettings> {
  if (!needsOAuthRefresh(settings)) return settings;

  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: settings.refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: HTTP ${response.status}`);
  }

  const tokens = (await response.json()) as TokenResponse;
  return {
    ...settings,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId: extractAccountIdFromTokenResponse(tokens) ?? settings.accountId,
  };
}

export function getCodexApiEndpoint(): string {
  return CODEX_API_ENDPOINT;
}

export async function extractResponseText(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error("Response body is empty");
  }

  let text = "";
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex: number;

    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "response.output_text.delta" && typeof data.delta === "string") {
            text += data.delta;
          }
        } catch {
          // Ignore incomplete or invalid JSON in SSE
        }
      }
    }
  }

  if (text.length > 0) return text.trim();

  throw new Error("OpenAI OAuth response did not contain text output");
}

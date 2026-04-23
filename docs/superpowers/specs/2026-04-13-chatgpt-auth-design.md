# ChatGPT Auth Integration Design

## Goal

Add terminal-interactive ChatGPT Plus/Pro authentication to this project using an `opencode`-style flow, while preserving the existing OpenAI API key path.

## Scope

- Add a non-official OpenAI OAuth/device-auth path for ChatGPT Plus/Pro accounts.
- Keep manual API key configuration working.
- Route LLM chat requests through the ChatGPT/Codex endpoint when OAuth auth is active.

## Authentication Modes

Settings will support two modes:

- `api`: existing `apiKey + baseURL` configuration.
- `oauth`: ChatGPT Plus/Pro auth using browser or headless device flow.

`oauth` mode stores:

- `accessToken`
- `refreshToken`
- `expiresAt`
- `accountId`

`api` mode stores:

- `apiKey`
- `baseURL`
- `model`

Shared settings also keep:

- `authMode`
- `model`

## CLI / TUI Entry

Reuse the existing setup TUI as the primary terminal interaction entry.

Flow:

1. Choose auth mode:
   - `ChatGPT Plus/Pro (browser)`
   - `ChatGPT Plus/Pro (headless)`
   - `Manual API Key`
2. Complete the selected auth flow.
3. Configure the chat model.
4. Validate configuration where practical.

## Request Routing

For `authMode = oauth`:

- Chat generation requests use `https://chatgpt.com/backend-api/codex/responses`.
- Send:
  - `Authorization: Bearer <accessToken>`
  - `ChatGPT-Account-Id: <accountId>` when available
- Refresh the access token before expiry with the saved refresh token.

For `authMode = api`:

- Keep using the current OpenAI-compatible SDK client and configured `baseURL`.

## Safety / Compatibility

- This is intentionally an `opencode`-style compatibility path, not an official OpenAI developer API integration.
- The OAuth/device endpoints, callback format, and downstream ChatGPT endpoint may change without notice.
- The implementation must not break the current API-key setup flow.

## Tests

- Settings round-trip for `api` and `oauth` modes.
- Auth header construction and token refresh behavior for OAuth mode.
- Existing API-key LLM path remains intact.

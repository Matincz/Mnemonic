# Mnemonic Global CLI Design

## Goal

Turn the current project-scoped `Memory Agent` into a real global CLI named `Mnemonic`, installable with `bun install -g`, with app data stored in user-level directories instead of the repository folder.

## Command Surface

The top-level command is `mnemonic`.

Initial commands:

- `mnemonic start`
- `mnemonic tui`
- `mnemonic setup`
- `mnemonic auth status`
- `mnemonic auth list`
- `mnemonic auth openai browser`
- `mnemonic auth openai headless`
- `mnemonic auth openai api-key`
- `mnemonic auth logout openai`
- `mnemonic paths`
- `mnemonic doctor`

Only `openai` is implemented now, but the command tree must keep the provider slot so more providers can be added later without changing the CLI shape.

## Installation

- Rename the package to `mnemonic`.
- Expose a global binary `mnemonic` via `package.json#bin`.
- Keep local `bun run` scripts for development, but route them through the same CLI entry so local and global execution share one code path.

## Runtime Layout

The app must stop depending on `~/Desktop/Memory agent`.

User-level storage:

- macOS
  - data root: `~/Library/Application Support/Mnemonic`
  - config root: `~/Library/Preferences/Mnemonic`
- Linux
  - data root: `$XDG_DATA_HOME/mnemonic` or `~/.local/share/mnemonic`
  - config root: `$XDG_CONFIG_HOME/mnemonic` or `~/.config/mnemonic`
- Windows
  - data root: `%LOCALAPPDATA%/Mnemonic`
  - config root: `%APPDATA%/Mnemonic`

Within the data root:

- `data/memory.db`
- `vault/`

Within the config root:

- `settings.json`
- optional migration marker files

## Migration

The first run of any `mnemonic` command must check for legacy data in `~/Desktop/Memory agent`.

Rules:

- If the new global directories are empty and the legacy directory exists, migrate automatically.
- Migrate:
  - legacy `data/` -> new `data/`
  - legacy `vault/` -> new `vault/`
  - legacy `data/settings.json` -> new config `settings.json`
- Write a migration marker after success.
- Never overwrite non-empty new directories.
- Never delete the legacy directory automatically.
- If both old and new locations contain data, skip migration and print a clear warning.

## Internal Structure

Add a real CLI entrypoint that dispatches commands instead of relying on direct script execution.

Recommended internal split:

- `src/app-paths.ts`
  - resolve platform-specific app directories
  - expose legacy directory locations
- `src/migration.ts`
  - detect and perform one-time migration
- `src/cli.ts`
  - parse argv and dispatch subcommands
- `bin/mnemonic`
  - global executable shim

Existing modules must consume resolved app paths instead of hardcoded repository paths.

## Auth Behavior

OpenAI auth remains split across:

- OAuth browser
- OAuth headless
- API key

`mnemonic auth openai ...` commands save provider configuration into the global config location.

Chat requests:

- OAuth mode -> ChatGPT/Codex compatibility endpoint
- API key mode -> OpenAI-compatible API

## Validation

Required verification:

- path resolution tests
- legacy migration tests
- CLI argument dispatch tests
- existing auth tests still pass
- `bun test`
- `bunx tsc --noEmit`

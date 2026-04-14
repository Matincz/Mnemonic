# Mnemonic Global CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the app to `Mnemonic`, add a real global `mnemonic` CLI, move runtime data/config into user-level global directories, and migrate legacy `~/Desktop/Memory agent` data automatically on first run.

**Architecture:** Add a dedicated CLI entrypoint plus a small runtime layer for app paths and migration. Keep the current daemon, TUI, and OpenAI auth logic, but route all command execution through `src/cli.ts` and all filesystem locations through resolved app paths.

**Tech Stack:** Bun, TypeScript, Ink, existing OpenAI auth helpers, Bun test

---

## File Structure

- Modify: `package.json`
- Create: `bin/mnemonic`
- Create: `src/app-paths.ts`
- Create: `src/migration.ts`
- Create: `src/cli.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `src/tui/index.tsx`
- Modify: `src/tui/setup.tsx`
- Modify: `src/settings.ts`
- Add tests: `tests/app-paths.test.ts`, `tests/migration.test.ts`, `tests/cli.test.ts`

### Task 1: Add path resolution and legacy migration tests

**Files:**
- Create: `tests/app-paths.test.ts`
- Create: `tests/migration.test.ts`

- [ ] Write failing tests for platform-specific global path resolution and legacy path detection.
- [ ] Run `bun test tests/app-paths.test.ts tests/migration.test.ts` and verify failure is because modules/functions do not exist yet.
- [ ] Implement `src/app-paths.ts` with deterministic path resolution helpers and legacy path helpers.
- [ ] Implement `src/migration.ts` with one-time copy-based migration.
- [ ] Re-run `bun test tests/app-paths.test.ts tests/migration.test.ts`.

### Task 2: Add CLI parsing tests and entrypoint

**Files:**
- Create: `tests/cli.test.ts`
- Create: `src/cli.ts`
- Create: `bin/mnemonic`

- [ ] Write failing tests for argv parsing and dispatch targets.
- [ ] Run `bun test tests/cli.test.ts` and verify failure.
- [ ] Implement CLI parsing and dispatch.
- [ ] Add the global executable shim and package `bin` metadata.
- [ ] Re-run `bun test tests/cli.test.ts`.

### Task 3: Route runtime modules through global paths

**Files:**
- Modify: `src/config.ts`
- Modify: `src/settings.ts`
- Modify: `src/index.ts`

- [ ] Add a failing test or extend existing tests for `settings` to prove config path is no longer tied to the repo path.
- [ ] Run the targeted test and verify failure.
- [ ] Update config/settings/runtime startup to use the resolved app paths and to invoke migration before using storage.
- [ ] Re-run the targeted test.

### Task 4: Unify command entrypoints

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tui/index.tsx`
- Modify: `src/tui/setup.tsx`
- Modify: `package.json`

- [ ] Refactor daemon/TUI/setup files so they export callable functions and still support direct execution where useful.
- [ ] Update package scripts to run through the CLI entry.
- [ ] Verify `auth` subcommands map cleanly onto the current OpenAI auth implementation.
- [ ] Run focused tests plus a manual smoke check with `mnemonic paths`.

### Task 5: Full verification

**Files:**
- No new files

- [ ] Run `bun test`
- [ ] Run `bunx tsc --noEmit`
- [ ] Run a manual smoke check for `bun run src/cli.ts -- paths`
- [ ] Summarize any residual risk, especially that OpenAI OAuth remains a compatibility path rather than an official public API flow.

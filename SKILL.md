---
name: memory-query
description: Query Mnemonic's knowledge base. Use when you need to recall past decisions, patterns, or context from previous coding sessions across all AI agents.
---

# Memory Query Skill

Query the local Mnemonic agent to retrieve past knowledge, decisions, and patterns.

## Usage

### Search memories by text or embedding
```bash
mnemonic search "YOUR_QUERY"
```

### List recent memories
```bash
cd ~/Desktop/Mnemonic
bun run -e "
import { MemoryDB } from './src/storage/sqlite';
import { config } from './src/config';
const db = new MemoryDB(config.sqlitePath);
const results = db.listRecent(10);
console.log(JSON.stringify(results, null, 2));
db.close();
"
```

### Browse by layer
```bash
cd ~/Desktop/Mnemonic
bun run -e "
import { MemoryDB } from './src/storage/sqlite';
import { config } from './src/config';
const db = new MemoryDB(config.sqlitePath);
const results = db.listByLayer('semantic', 10); // episodic | semantic | procedural | insight
console.log(JSON.stringify(results, null, 2));
db.close();
"
```

### Ask a natural-language question
```bash
mnemonic query "What have we learned about auth refresh flow?"
```

### Recall compact context for agent hooks
Use this before planning, editing, debugging, or final reporting when an agent needs quiet, project-scoped context:
```bash
mnemonic recall --json --cwd "$PWD" "fix auth retry failure"
```

`recall` is intentionally smaller and lower-noise than `query`: it returns a context capsule plus source ids for automatic injection into an agent prompt.

### Install recall instructions for local agents
```bash
mnemonic integrate all --cwd "$PWD"
```

This writes or updates marked Mnemonic blocks in `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` so Codex, Claude Code, and Gemini know when to call `mnemonic recall`.

Verify the local agent files afterward:
```bash
mnemonic integrate verify --cwd "$PWD"
```

Run the readiness loop when changing recall or hooks:
```bash
mnemonic recall-audit --cwd "$PWD" --iterations 3 --max-ms 500 "fix auth retry failure"
```

`recall-audit` verifies the Codex, Claude, and Gemini instruction files, then repeatedly runs fast recall under the latency budget. Treat any reported issue as a blocker before relying on automatic agent injection.

### Rebuild embeddings and dashboards
```bash
mnemonic reindex
```

### Direct vault browse
The Markdown vault is at `~/Library/Application Support/Mnemonic/vault/`. Open it with Obsidian or browse directly:
```bash
ls ~/Library/Application\ Support/Mnemonic/vault/
cat ~/Library/Application\ Support/Mnemonic/vault/index.md
```

## Data Storage Paths

| Item | Path |
|------|------|
| **Data root** | `~/Library/Application Support/Mnemonic` |
| **Config root** | `~/Library/Preferences/Mnemonic` |
| **SQLite DB** | `~/Library/Application Support/Mnemonic/data/memory.db` |
| **LanceDB (vectors)** | `~/Library/Application Support/Mnemonic/data/lance/` |
| **Markdown vault** | `~/Library/Application Support/Mnemonic/vault/` |
| **Settings** | `~/Library/Preferences/Mnemonic/settings.json` |
| **IPC status** | `~/Library/Application Support/Mnemonic/ipc/status.json` |
| **IPC events** | `~/Library/Application Support/Mnemonic/ipc/events.ndjson` |
| **Project source** | `~/Desktop/Mnemonic` |

> Run `mnemonic paths` (or `cd ~/Desktop/Mnemonic && bun run src/cli.ts paths`) to verify current paths.

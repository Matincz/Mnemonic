---
name: memory-query
description: Query the Memory Agent's knowledge base. Use when you need to recall past decisions, patterns, or context from previous coding sessions across all AI agents.
---

# Memory Query Skill

Query the local Memory Agent to retrieve past knowledge, decisions, and patterns.

## Usage

### Search memories by text
```bash
cd ~/Desktop/Memory\ agent
bun run -e "
import { MemoryDB } from './src/storage/sqlite';
import { config } from './src/config';
const db = new MemoryDB(config.sqlitePath);
const results = db.searchMemories('YOUR_QUERY', 10);
console.log(JSON.stringify(results, null, 2));
db.close();
"
```

### List recent memories
```bash
cd ~/Desktop/Memory\ agent
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
cd ~/Desktop/Memory\ agent
bun run -e "
import { MemoryDB } from './src/storage/sqlite';
import { config } from './src/config';
const db = new MemoryDB(config.sqlitePath);
const results = db.listByLayer('semantic', 10); // episodic | semantic | procedural | insight
console.log(JSON.stringify(results, null, 2));
db.close();
"
```

### Direct vault browse
The Markdown vault is at `~/Desktop/Memory agent/vault/`. Open it with Obsidian or browse directly:
```bash
ls ~/Desktop/Memory\ agent/vault/
cat ~/Desktop/Memory\ agent/vault/index.md
```

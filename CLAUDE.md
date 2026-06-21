

<!-- MNEMONIC:RECALL:START -->
## Mnemonic Recall

For Claude Code, use Mnemonic as a quiet project memory layer.

Before planning, editing, debugging, or final reporting on a repo task, run:

```bash
if command -v mnemonic >/dev/null 2>&1; then
  mnemonic recall --json --cwd "$PWD" "<current user task or failure text>"
else
  bun run src/cli.ts recall --json --cwd "$PWD" "<current user task or failure text>"
fi
```

Inject only the returned `context` under a `Memory Context` heading when it is not `Relevant memory:\n- none`.
Use the returned memory ids as source trace, but do not quote or expand full memories unless the user asks.
If the recall confidence is `low`, treat it as optional background and do not let it override current files, tests, or explicit user instructions.
<!-- MNEMONIC:RECALL:END -->

// src/wiki/schema.ts
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export function generateSchema() {
  return `# Wiki Schema

## Directory Layout

- \`entities/\` — entity pages about concrete people, places, tools, or systems
- \`concepts/\` — concept pages for definitions, themes, or abstractions
- \`sources/\` — source pages that capture external references or imported materials
- \`procedures/\` — procedure pages for repeatable workflows and playbooks
- \`insights/\` — insight pages for synthesized takeaways and conclusions
- \`raw/\` — raw session captures before they are transformed into wiki pages
- \`index.md\` — generated overview index grouped by page type
- \`log.md\` — append-only operation log
- \`SCHEMA.md\` — this file

## Page Naming

- Each page lives in the directory that matches its type.
- Each page filename is the page slug in kebab-case with a \`.md\` suffix.
- The page type and slug are derived from the directory and filename.
- Use stable slugs so wikilinks remain valid over time.

## Frontmatter Format

Use YAML frontmatter at the top of each page when structured metadata is available:

\`\`\`yaml
---
title: Example Page
summary: One-line description of the page
tags:
  - example
  - wiki
wikilinks:
  - [[concepts/example-concept]]
createdAt: 2026-04-14T00:00:00.000Z
updatedAt: 2026-04-14T00:00:00.000Z
---
\`\`\`

## Body Conventions

- The markdown body comes after the closing frontmatter delimiter.
- The body should be readable on its own without requiring the raw session.
- Wikilinks should use markdown wiki link syntax such as \`[[concepts/example-concept]]\`.
- If \`wikilinks\` is omitted from frontmatter, links can be derived from the markdown body.

## Raw Sessions

- Save raw sessions to \`raw/<session-id>.md\`.
- Raw sessions are source material and should not replace curated wiki pages.
`;
}

export function ensureSchema(wikiRoot: string) {
  mkdirSync(wikiRoot, { recursive: true });

  const schemaPath = join(wikiRoot, "SCHEMA.md");
  if (!existsSync(schemaPath)) {
    writeFileSync(schemaPath, `${generateSchema()}\n`);
  }
}

// src/pipeline/wiki-ingestor.ts
import { llmGenerateJSON } from "../llm";
import { wikiIngestPrompt } from "../llm/prompts";
import { WikiOperationSchema } from "../llm/schemas";
import { generateSchema } from "../wiki/schema";
import { WikiLint } from "../wiki/lint";
import { collectExistingPageSummaries } from "../wiki/summaries";
import { WikiLintTaskQueue } from "../wiki/task-queue";
import type { ParsedSession } from "../types";
import type { WikiEngine } from "../wiki/engine";
import type { IndexManager } from "../wiki/index-manager";
import type { WikiLog } from "../wiki/log";
import type { EntityRegistry } from "../wiki/registry";
import type { WikiOperation } from "../wiki/types";

export async function wikiIngest(
  session: ParsedSession,
  engine: WikiEngine,
  indexManager: IndexManager,
  log: WikiLog,
  registry: EntityRegistry,
): Promise<WikiOperation[]> {
  const indexContent = indexManager.getIndex();
  const schemaContent = generateSchema();
  const existingPages = collectExistingPageSummaries(engine, session);
  const operations = await llmGenerateJSON(
    wikiIngestPrompt(session, schemaContent, indexContent, existingPages),
    WikiOperationSchema,
  );
  const validOperations = operations.filter(isValidWikiOperation);

  for (const operation of validOperations) {
    registry.register(operation.title, operation.type, operation.slug);
    engine.writePage(operation.type, operation.slug, operation.content);
  }

  indexManager.rebuild();

  const lint = new WikiLint(engine);
  const issues = lint.check();
  if (issues.length > 0) {
    const queue = new WikiLintTaskQueue(engine.getRootPath());
    const result = queue.sync(issues, session.id);
    console.log(
      `[wiki-lint] queued ${result.total} task(s) (${result.errors} error(s), ${result.warnings} warning(s), +${result.added}, -${result.resolved})`,
    );
  }

  log.append({
    action: "ingest",
    pages: validOperations.map((operation) => `${operation.type}/${operation.slug}`),
    source: session.id,
  });

  return validOperations;
}
function isValidWikiOperation(operation: Partial<WikiOperation>): operation is WikiOperation {
  return (
    operation.action !== undefined &&
    (operation.action === "create" || operation.action === "update") &&
    operation.type !== undefined &&
    ["entity", "concept", "source", "procedure", "insight"].includes(operation.type) &&
    typeof operation.slug === "string" &&
    operation.slug.length > 0 &&
    typeof operation.title === "string" &&
    operation.title.length > 0 &&
    typeof operation.content === "string" &&
    operation.content.length > 0 &&
    typeof operation.reason === "string"
  );
}

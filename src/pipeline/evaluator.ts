import type { ParsedSession } from "../types";
import { llmGenerateJSON } from "../llm";
import { evaluatePrompt } from "../llm/prompts";

interface EvalResult {
  worth_remembering: boolean;
  reason: string;
  estimated_layers: string[];
}

export async function evaluate(session: ParsedSession): Promise<{
  shouldProcess: boolean;
  reason: string;
}> {
  // Quick heuristic: skip very short sessions
  if (session.messages.length < 2) {
    return { shouldProcess: false, reason: "Too few messages" };
  }

  // Skip sessions with only trivial content
  const totalChars = session.messages.reduce((n, m) => n + m.content.length, 0);
  if (totalChars < 100) {
    return { shouldProcess: false, reason: "Content too short" };
  }

  const result = await llmGenerateJSON<EvalResult>(evaluatePrompt(session));
  return {
    shouldProcess: result.worth_remembering,
    reason: result.reason,
  };
}

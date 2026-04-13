import { generateText, embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { config } from "../config";

export async function llmGenerate(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: openai(config.llmModel),
    prompt,
    temperature: 0.3,
  });
  return text;
}

export async function llmGenerateJSON<T>(prompt: string): Promise<T> {
  const text = await llmGenerate(prompt);
  // Extract JSON from response (may be wrapped in markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
  const jsonStr = jsonMatch[1]?.trim() ?? text.trim();
  return JSON.parse(jsonStr);
}

export async function getEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding(config.embeddingModel),
    value: text,
  });
  return embedding;
}

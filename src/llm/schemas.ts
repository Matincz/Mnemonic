import { z } from "zod";

const MemoryLayerSchema = z.enum(["episodic", "semantic", "procedural", "insight"]);
const DurableLayerSchema = z.enum(["semantic", "procedural", "insight"]);
const WikiPageTypeSchema = z.enum(["entity", "concept", "source", "procedure", "insight"]);
const MemoryStatusSchema = z.enum(["proposed", "observed", "verified"]);

export const EvalResultSchema = z.object({
  worth_remembering: z.boolean(),
  reason: z.string(),
  estimated_layers: z.array(MemoryLayerSchema),
});

const RawMemoryObjectSchema = z.object({
  layer: MemoryLayerSchema,
  title: z.string(),
  summary: z.string(),
  details: z.string(),
  tags: z.array(z.string()),
  status: MemoryStatusSchema.optional(),
  salience: z.number(),
});
type RawMemoryOutput = z.infer<typeof RawMemoryObjectSchema>;
export type RawMemory = RawMemoryOutput;

const RawMemoryItemSchema: z.ZodType<RawMemoryOutput, z.ZodTypeDef, unknown> = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (MemoryStatusSchema.safeParse(record.layer).success) {
    return {
      ...record,
      layer: "semantic",
      status: record.status ?? record.layer,
    };
  }

  return value;
}, RawMemoryObjectSchema);

export const RawMemorySchema: z.ZodType<RawMemoryOutput[], z.ZodTypeDef, unknown> = z.array(RawMemoryItemSchema);

export const LinkResultSchema = z.object({
  linked_ids: z.array(z.string()).default([]),
  contradicts_ids: z.array(z.string()).default([]),
  explanation: z.string(),
});

export const BatchLinkResultSchema = z.array(
  LinkResultSchema.extend({
    memory_id: z.string(),
  }),
);

export const ConsolidationResultSchema = z.object({
  memory_id: z.string().optional(),
  action: z.enum(["none", "update-existing", "create-synthesis"]),
  target_id: z.string().optional(),
  layer: MemoryLayerSchema.optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  details: z.string().optional(),
  tags: z.array(z.string()).optional(),
  salience: z.number().optional(),
  linked_ids: z.array(z.string()).default([]),
  reason: z.string().optional(),
});

export const BatchConsolidationResultSchema = z.array(ConsolidationResultSchema);

export const RawInsightSchema = z.array(
  z.object({
    title: z.string(),
    summary: z.string(),
    details: z.string(),
    tags: z.array(z.string()),
    salience: z.number(),
    linked_ids: z.array(z.string()),
  }),
);

export const WikiOperationSchema = z.array(
  z.object({
    action: z.enum(["create", "update"]),
    type: WikiPageTypeSchema,
    slug: z.string().default(""),
    title: z.string().default(""),
    content: z.string().default(""),
    reason: z.string().default(""),
  }),
);

export const WikiSelectionSchema = z.object({
  pages: z.array(z.string()),
});

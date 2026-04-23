import { z } from "zod";

const MemoryLayerSchema = z.enum(["episodic", "semantic", "procedural", "insight"]);
const DurableLayerSchema = z.enum(["semantic", "procedural", "insight"]);
const WikiPageTypeSchema = z.enum(["entity", "concept", "source", "procedure", "insight"]);

export const EvalResultSchema = z.object({
  worth_remembering: z.boolean(),
  reason: z.string(),
  estimated_layers: z.array(MemoryLayerSchema),
});

export const RawMemorySchema = z.array(
  z.object({
    layer: MemoryLayerSchema,
    title: z.string(),
    summary: z.string(),
    details: z.string(),
    tags: z.array(z.string()),
    status: z.enum(["proposed", "observed", "verified"]).optional(),
    salience: z.number(),
  }),
);

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

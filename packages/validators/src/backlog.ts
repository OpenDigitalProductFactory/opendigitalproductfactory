import { z } from "zod";

const scopeKindSchema = z.enum([
  "platform",
  "common",
  "archetype-category",
  "archetype-leaf",
  "multi-archetype",
  "unknown",
]);
const scopeStringArraySchema = z.array(z.string().min(1)).default([]);

export const createEpicSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  portfolioIds: z.array(z.string()).min(1),
  scopeKind: scopeKindSchema.optional(),
  archetypeCategories: scopeStringArraySchema.optional(),
  archetypeIds: scopeStringArraySchema.optional(),
  scopeRationale: z.string().max(2000).nullable().optional(),
  lifecycleTags: scopeStringArraySchema.optional(),
});

export const updateEpicSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(["open", "in-progress", "done"]).optional(),
  scopeKind: scopeKindSchema.nullable().optional(),
  archetypeCategories: scopeStringArraySchema.optional(),
  archetypeIds: scopeStringArraySchema.optional(),
  scopeRationale: z.string().max(2000).nullable().optional(),
  lifecycleTags: scopeStringArraySchema.optional(),
});

export const createBacklogItemSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional(),
  type: z.enum(["product", "portfolio"]),
  epicId: z.string().optional(),
  priority: z.number().int().min(0).max(999).optional(),
  scopeKind: scopeKindSchema.optional(),
  archetypeCategories: scopeStringArraySchema.optional(),
  archetypeIds: scopeStringArraySchema.optional(),
  scopeRationale: z.string().max(2000).nullable().optional(),
  lifecycleTags: scopeStringArraySchema.optional(),
});

export const updateBacklogItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(10000).optional(),
  status: z.enum(["open", "in-progress", "done", "deferred"]).optional(),
  priority: z.number().int().min(0).max(999).optional(),
  epicId: z.string().nullable().optional(),
  scopeKind: scopeKindSchema.nullable().optional(),
  archetypeCategories: scopeStringArraySchema.optional(),
  archetypeIds: scopeStringArraySchema.optional(),
  scopeRationale: z.string().max(2000).nullable().optional(),
  lifecycleTags: scopeStringArraySchema.optional(),
});

export type CreateEpicInput = z.infer<typeof createEpicSchema>;
export type UpdateEpicInput = z.infer<typeof updateEpicSchema>;
export type CreateBacklogItemInput = z.infer<typeof createBacklogItemSchema>;
export type UpdateBacklogItemInput = z.infer<typeof updateBacklogItemSchema>;

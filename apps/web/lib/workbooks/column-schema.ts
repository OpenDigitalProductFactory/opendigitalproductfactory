// Universal Grid & Workbooks — column create/config validation (EP-GRID-WORKBOOKS).
//
// Extracted from workbook-service so it can be unit-tested without pulling in the
// Prisma client. This is the single source of truth for what a column's
// `fieldConfig` may contain — it MUST stay aligned with the FieldConfig type in
// ./types, because zod strips any key the schema doesn't declare (so a config key
// present in the type but missing here is silently dropped on save).

import { z } from "zod";
import { FIELD_TYPES } from "./types";

const fieldTypeEnum = z.enum(FIELD_TYPES as unknown as [string, ...string[]]);

const selectOptionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  intent: z.string().optional(),
});

const lookupConfigSchema = z.object({
  referenceColumnId: z.string().min(1),
  targetField: z.string().min(1),
  targetFieldType: fieldTypeEnum.optional(),
});

const linkConfigSchema = z.object({
  cardinality: z.enum(["one", "many"]),
  referenceType: z.string().min(1),
});

const rollupConfigSchema = z.object({
  linkColumnId: z.string().min(1),
  op: z.literal("count"),
});

export const fieldConfigSchema = z
  .object({
    options: z.array(selectOptionSchema).optional(),
    referenceType: z.string().optional(),
    multiline: z.boolean().optional(),
    // Number / currency / percent display precision (decimal places).
    precision: z.number().int().min(0).max(10).optional(),
    // Rating: number of stars.
    max: z.number().int().min(1).max(100).optional(),
    // Currency: the symbol to prefix (e.g. "$", "€", "£").
    currencySymbol: z.string().min(1).max(8).optional(),
    // Duration: the unit the stored number is in.
    durationUnit: z.enum(["minutes", "seconds"]).optional(),
    formula: z.string().max(2000).optional(),
    resultType: fieldTypeEnum.optional(),
    lookup: lookupConfigSchema.optional(),
    link: linkConfigSchema.optional(),
    rollup: rollupConfigSchema.optional(),
  })
  .optional();

export const addColumnSchema = z
  .object({
    name: z.string().min(1).max(200),
    fieldType: fieldTypeEnum,
    config: fieldConfigSchema,
    required: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    // Computed columns must carry their definition (fail-closed, not silent).
    if (val.fieldType === "formula" && !val.config?.formula?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A formula is required for a formula column", path: ["config", "formula"] });
    }
    if (val.fieldType === "lookup" && !val.config?.lookup) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A lookup column needs a reference column and target field", path: ["config", "lookup"] });
    }
    if (val.fieldType === "reference" && !val.config?.referenceType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A reference column needs a target entity", path: ["config", "referenceType"] });
    }
  });

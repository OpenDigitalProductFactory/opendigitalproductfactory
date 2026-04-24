import { z } from "zod";

export const AI_PROVIDER_FINANCE_STATUSES = ["seeded", "active", "attention_needed"] as const;
export const AI_PROVIDER_RECONCILIATION_STRATEGIES = [
  "provider_portal",
  "provider_api",
  "internal_observed",
  "manual",
] as const;
export const AI_PROVIDER_VALUATION_METHODS = [
  "commitment_first",
  "metered",
  "hybrid",
] as const;
export const AI_PROVIDER_BILLING_CADENCES = ["monthly", "quarterly", "annual"] as const;
export const AI_PROVIDER_SNAPSHOT_CONFIDENCE = ["low", "medium", "high"] as const;
export const AI_PROVIDER_WORK_ITEM_STATUSES = ["open", "in_progress", "done"] as const;
export const AI_PROVIDER_WORK_ITEM_SEVERITIES = ["low", "medium", "high", "critical"] as const;

const allowanceSchema = z.object({
  allowanceName: z.string().min(1),
  usageUnit: z.string().min(1),
  includedQuantity: z.number().positive(),
  overageUnitCost: z.number().nonnegative().optional(),
  valuationMethod: z.enum(AI_PROVIDER_VALUATION_METHODS).default("commitment_first"),
});

export const seedAiProviderFinanceBridgeSchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  supplierName: z.string().min(1).optional(),
  billingUrl: z.string().url().optional(),
  usageUrl: z.string().url().optional(),
  currency: z.string().length(3).default("USD"),
  monthlyCommittedAmount: z.number().nonnegative().optional(),
  includedQuantity: z.number().positive().optional(),
  usageUnit: z.string().min(1).optional(),
  budgetAmount: z.number().nonnegative().optional(),
  accountableEmployeeId: z.string().min(1).optional(),
  reconciliationStrategy: z.enum(AI_PROVIDER_RECONCILIATION_STRATEGIES).default("provider_portal"),
  valuationMethod: z.enum(AI_PROVIDER_VALUATION_METHODS).default("commitment_first"),
});

export const activateAiProviderContractSchema = z.object({
  contractId: z.string().min(1),
  accountableEmployeeId: z.string().min(1),
  currency: z.string().length(3),
  monthlyCommittedAmount: z.number().nonnegative(),
  billingCadence: z.enum(AI_PROVIDER_BILLING_CADENCES),
  budgetAmount: z.number().nonnegative().optional(),
  allowsOverage: z.boolean().default(false),
  billingUrl: z.string().url().optional(),
  usageUrl: z.string().url().optional(),
  allowances: z.array(allowanceSchema).min(1),
});

export const createContractUsageSnapshotSchema = z.object({
  contractId: z.string().min(1),
  snapshotDate: z.string().min(1),
  sourceType: z.enum(AI_PROVIDER_RECONCILIATION_STRATEGIES),
  confidence: z.enum(AI_PROVIDER_SNAPSHOT_CONFIDENCE).default("medium"),
  consumedQuantity: z.number().nonnegative(),
  includedQuantity: z.number().nonnegative().optional(),
  remainingQuantity: z.number().optional(),
  utilizationPct: z.number().optional(),
  projectedMonthEndQuantity: z.number().optional(),
  projectedUnusedValue: z.number().optional(),
  projectedOverageCost: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createFinanceWorkItemSchema = z.object({
  profileId: z.string().min(1).optional(),
  contractId: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
  ownerEmployeeId: z.string().min(1).optional(),
  type: z.string().min(1),
  status: z.enum(AI_PROVIDER_WORK_ITEM_STATUSES).default("open"),
  severity: z.enum(AI_PROVIDER_WORK_ITEM_SEVERITIES).default("medium"),
  title: z.string().min(1),
  description: z.string().optional(),
  dueAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SeedAiProviderFinanceBridgeInput = z.input<typeof seedAiProviderFinanceBridgeSchema>;
export type ActivateAiProviderContractInput = z.input<typeof activateAiProviderContractSchema>;
export type CreateContractUsageSnapshotInput = z.input<typeof createContractUsageSnapshotSchema>;
export type CreateFinanceWorkItemInput = z.input<typeof createFinanceWorkItemSchema>;

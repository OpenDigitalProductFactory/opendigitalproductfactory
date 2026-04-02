import * as crypto from "crypto";
import type { DecompositionPlan, ValidationResult } from "./feature-build-types";

export function validateDecompositionPlan(plan: DecompositionPlan): ValidationResult {
  const errors: string[] = [];
  if (!plan.epicTitle.trim()) errors.push("epicTitle is required");
  if (plan.featureSets.length === 0) errors.push("at least one feature set is required");
  for (const fs of plan.featureSets) {
    if (!fs.title.trim()) errors.push("feature set title is required");
  }
  return { valid: errors.length === 0, errors };
}

export function createTechDebtItem(input: { title: string; description: string; severity: string }): {
  itemId: string; title: string; type: string; status: string; body: string; priority: number;
} {
  const priorityMap: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };
  return {
    itemId: `BI-REFACTOR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    title: input.title, type: "product", status: "open",
    body: `[Tech Debt] ${input.description}\nSeverity: ${input.severity}`,
    priority: priorityMap[input.severity] ?? 3,
  };
}

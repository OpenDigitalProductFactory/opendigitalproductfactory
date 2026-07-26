// lib/finance/supplier-service.ts — Governed Supplier Onboarding & Profile Posture (BI-SPEND-001)

import { prisma } from "@dpf/db";
import {
  type SupplierStatus,
  type SupplierOnboardingChecklist,
  type UpdateSupplierInput,
  updateSupplierSchema,
} from "./ap-validation";

export type OnboardingPostureEvaluation = {
  score: number; // 0 - 100
  isComplete: boolean;
  missingItems: Array<keyof SupplierOnboardingChecklist>;
};

/**
 * Pure domain function: evaluate onboarding checklist completeness score and missing items.
 */
export function evaluateSupplierOnboardingPosture(
  checklist: SupplierOnboardingChecklist,
): OnboardingPostureEvaluation {
  const items: Array<keyof SupplierOnboardingChecklist> = [
    "hasTaxId",
    "hasBankDetails",
    "hasSignedContract",
    "hasInsuranceCertificate",
  ];

  const missingItems = items.filter((key) => !checklist[key]);
  const completedCount = items.length - missingItems.length;
  const score = Math.round((completedCount / items.length) * 100);

  return {
    score,
    isComplete: missingItems.length === 0,
    missingItems,
  };
}

/**
 * Pure state machine transition rule check for supplier status.
 */
export function canTransitionSupplierStatus(
  currentStatus: SupplierStatus,
  targetStatus: SupplierStatus,
): { allowed: boolean; reason?: string } {
  if (currentStatus === targetStatus) {
    return { allowed: true };
  }

  // Blocked suppliers cannot jump directly to active without re-onboarding/review
  if (currentStatus === "blocked" && targetStatus === "active") {
    return {
      allowed: false,
      reason: "Blocked supplier must transition to onboarding or inactive for review prior to reactivation.",
    };
  }

  return { allowed: true };
}

/**
 * DB operation: update supplier profile with validated input.
 */
export async function updateSupplierProfile(id: string, updates: UpdateSupplierInput) {
  const validated = updateSupplierSchema.parse(updates);

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`Supplier '${id}' not found`);
  }

  if (validated.status && validated.status !== existing.status) {
    const check = canTransitionSupplierStatus(
      existing.status as SupplierStatus,
      validated.status as SupplierStatus,
    );
    if (!check.allowed) {
      throw new Error(`Invalid status transition: ${check.reason}`);
    }
  }

  return await prisma.supplier.update({
    where: { id },
    data: validated,
  });
}

/**
 * DB operation: transition supplier status with audit trail.
 */
export async function transitionSupplierStatus(
  id: string,
  newStatus: SupplierStatus,
  reason?: string,
) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`Supplier '${id}' not found`);
  }

  const check = canTransitionSupplierStatus(
    existing.status as SupplierStatus,
    newStatus,
  );
  if (!check.allowed) {
    throw new Error(`Cannot transition status: ${check.reason}`);
  }

  return await prisma.supplier.update({
    where: { id },
    data: {
      status: newStatus,
      notes: reason
        ? `${existing.notes ? existing.notes + "\n" : ""}[Status change to ${newStatus}]: ${reason}`
        : existing.notes,
    },
  });
}

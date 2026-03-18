// Pure utility library — no server imports. Safe in tests and client components.
import * as crypto from "crypto";

// ─── ID Generators ────────────────────────────────────────────────────────────

function genId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${hex}`;
}

export const generatePolicyId = () => genId("POL");
export const generateRequirementId = () => genId("PREQ");
export const generateCompletionId = () => genId("COMP");

// ─── Constants ────────────────────────────────────────────────────────────────

export const POLICY_CATEGORIES = [
  "security", "hr", "safety", "ethics", "operations", "it", "privacy", "other",
] as const;

export const POLICY_LIFECYCLE_STATUSES = [
  "draft", "in-review", "approved", "published", "retired",
] as const;

export const REVIEW_FREQUENCIES = ["annual", "biennial", "quarterly"] as const;

export const REQUIREMENT_TYPES = [
  "acknowledgment", "training", "attestation", "action",
] as const;

export const REQUIREMENT_FREQUENCIES = [
  "once", "annual", "quarterly", "on-change",
] as const;

export const COMPLETION_METHODS = [
  "digital-signature", "checkbox", "training-completion", "manual-attestation",
] as const;

export const TRAINING_DELIVERY_METHODS = [
  "online", "in-person", "self-paced", "instructor-led",
] as const;

export const SELF_COMPLETABLE_TYPES = ["acknowledgment", "training"] as const;

// ─── Lifecycle State Machine ──────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  "draft":     ["in-review"],
  "in-review": ["approved", "draft"],
  "approved":  ["published"],
  "published": ["retired"],
  "retired":   ["draft"],
};

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Input Types ──────────────────────────────────────────────────────────────

export type PolicyInput = {
  title: string;
  category: string;
  description?: string | null;
  effectiveDate?: Date | null;
  reviewDate?: Date | null;
  reviewFrequency?: string | null;
  fileRef?: string | null;
  obligationId?: string | null;
  ownerEmployeeId?: string | null;
  notes?: string | null;
};

export type RequirementInput = {
  title: string;
  requirementType: string;
  description?: string | null;
  frequency?: string | null;
  applicability?: string | null;
  dueDays?: number | null;
  trainingTitle?: string | null;
  provider?: string | null;
  deliveryMethod?: string | null;
  durationMinutes?: number | null;
  externalUrl?: string | null;
  passingScore?: number | null;
  certificateRequired?: boolean;
};

// ─── Validators ───────────────────────────────────────────────────────────────

/** Returns null if valid, or an error message if invalid. */
export function validatePolicyInput(input: Pick<PolicyInput, "title" | "category">): string | null {
  if (!input.title.trim()) return "Title is required.";
  if (!(POLICY_CATEGORIES as readonly string[]).includes(input.category)) {
    return `Category must be one of: ${POLICY_CATEGORIES.join(", ")}.`;
  }
  return null;
}

/** Returns null if valid, or an error message if invalid. */
export function validateRequirementInput(input: Pick<RequirementInput, "title" | "requirementType">): string | null {
  if (!input.title.trim()) return "Title is required.";
  if (!(REQUIREMENT_TYPES as readonly string[]).includes(input.requirementType)) {
    return `Requirement type must be one of: ${REQUIREMENT_TYPES.join(", ")}.`;
  }
  return null;
}

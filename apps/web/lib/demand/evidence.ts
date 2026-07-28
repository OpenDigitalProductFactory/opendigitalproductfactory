export const DEMAND_EVIDENCE_KINDS = [
  "reviewed-knowledge",
  "customer-feedback",
  "booking",
  "order",
  "subscription",
  "fulfillment",
  "commercial-signal",
  "operational-signal",
  "research",
  "decision",
] as const;
export type DemandEvidenceKind = (typeof DEMAND_EVIDENCE_KINDS)[number];

export const DEMAND_EVIDENCE_STATUSES = ["active", "superseded"] as const;
export type DemandEvidenceStatus =
  (typeof DEMAND_EVIDENCE_STATUSES)[number];

export type DemandEvidenceInput = {
  sourceKind: string;
  sourceRef: string;
  title: string;
  summary?: string | null;
  confidence?: number | null;
  reviewedAt?: Date | null;
};

export type DemandEvidenceValidationResult =
  | {
      valid: true;
      value: {
        sourceKind: DemandEvidenceKind;
        sourceRef: string;
        title: string;
        summary: string | null;
        confidence: number | null;
        reviewedAt: Date | null;
      };
    }
  | { valid: false; message: string };

export function validateDemandEvidenceInput(
  input: DemandEvidenceInput,
): DemandEvidenceValidationResult {
  if (
    !(DEMAND_EVIDENCE_KINDS as readonly string[]).includes(input.sourceKind)
  ) {
    return { valid: false, message: "Choose a supported evidence kind." };
  }
  const sourceRef = input.sourceRef.trim();
  if (!sourceRef) {
    return { valid: false, message: "Evidence requires a stable source reference." };
  }
  const title = input.title.trim();
  if (!title && input.sourceKind !== "reviewed-knowledge") {
    return { valid: false, message: "Evidence requires a title." };
  }
  const confidence = input.confidence ?? null;
  if (
    confidence !== null &&
    (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
  ) {
    return {
      valid: false,
      message: "Evidence confidence must be between 0 and 1.",
    };
  }
  return {
    valid: true,
    value: {
      sourceKind: input.sourceKind as DemandEvidenceKind,
      sourceRef,
      title,
      summary: input.summary?.trim() || null,
      confidence,
      reviewedAt: input.reviewedAt ?? null,
    },
  };
}

export function reviewedKnowledgeIsEligible(input: {
  status: string;
  lastReviewedAt: Date | null;
  pageOrganizationId: string | null;
  demandOrganizationId: string | null;
  isKernel: boolean;
}): boolean {
  if (input.status !== "published" || input.lastReviewedAt === null) {
    return false;
  }
  if (input.isKernel) return true;
  return (
    input.demandOrganizationId !== null &&
    input.pageOrganizationId === input.demandOrganizationId
  );
}

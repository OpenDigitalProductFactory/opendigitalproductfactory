export type ProviderComplianceReviewDecision = "confirmed" | "changed";

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function providerComplianceReviewUpdate(input: {
  decision: ProviderComplianceReviewDecision;
  reviewedAt: Date;
  reviewerId: string;
  existingLocator: unknown;
}): { retrievedAt?: Date; locator: Record<string, unknown> } {
  const locator = {
    ...jsonObject(input.existingLocator),
    review: {
      decision: input.decision,
      reviewedAt: input.reviewedAt.toISOString(),
      reviewerId: input.reviewerId,
    },
  };
  return input.decision === "confirmed"
    ? { retrievedAt: input.reviewedAt, locator }
    : { locator };
}

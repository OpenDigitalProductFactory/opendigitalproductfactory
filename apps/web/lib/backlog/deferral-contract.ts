export type NormalizedDeferral = {
  deferReason: string;
  deferTrigger: string;
  deferReviewAt: Date;
  deferOwnerPrincipalId: string;
};

export type DeferralValidationResult =
  | { ok: true; value: NormalizedDeferral }
  | { ok: false; error: string; message: string };

const MAX_TEXT_LENGTH = 2_000;

function requiredText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeDeferralInput(
  input: unknown,
  now = new Date(),
): DeferralValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      error: "missing_deferral",
      message: "deferral is required when status=deferred",
    };
  }

  const raw = input as Record<string, unknown>;
  const reason = requiredText(raw.reason);
  const trigger = requiredText(raw.trigger);
  const reviewAtRaw = requiredText(raw.reviewAt);
  const ownerPrincipalId = requiredText(raw.ownerPrincipalId);

  if (!reason) return { ok: false, error: "missing_defer_reason", message: "deferral.reason is required" };
  if (reason.length > MAX_TEXT_LENGTH) return { ok: false, error: "defer_reason_too_long", message: `deferral.reason must be at most ${MAX_TEXT_LENGTH} characters` };
  if (!trigger) return { ok: false, error: "missing_defer_trigger", message: "deferral.trigger is required" };
  if (trigger.length > MAX_TEXT_LENGTH) return { ok: false, error: "defer_trigger_too_long", message: `deferral.trigger must be at most ${MAX_TEXT_LENGTH} characters` };
  if (!reviewAtRaw) return { ok: false, error: "missing_defer_review_at", message: "deferral.reviewAt is required" };

  const deferReviewAt = new Date(reviewAtRaw);
  if (Number.isNaN(deferReviewAt.getTime())) {
    return { ok: false, error: "invalid_defer_review_at", message: "deferral.reviewAt must be an ISO-8601 timestamp" };
  }
  if (deferReviewAt.getTime() <= now.getTime()) {
    return { ok: false, error: "defer_review_at_not_future", message: "deferral.reviewAt must be in the future" };
  }
  if (!ownerPrincipalId) {
    return { ok: false, error: "missing_defer_owner", message: "deferral.ownerPrincipalId is required" };
  }

  return {
    ok: true,
    value: {
      deferReason: reason,
      deferTrigger: trigger,
      deferReviewAt,
      deferOwnerPrincipalId: ownerPrincipalId,
    },
  };
}

export const CLEAR_DEFERRAL_PROJECTION = {
  deferReason: null,
  deferTrigger: null,
  deferReviewAt: null,
  deferOwnerPrincipalId: null,
  deferredAt: null,
} as const;

export const DEFERRAL_INPUT_SCHEMA = {
  type: "object",
  description: "Required when retaining an item as deferred. Every deferral must be attributable, trigger-based, and time-bounded for review.",
  properties: {
    reason: { type: "string", description: "Why the item is not actionable now." },
    trigger: { type: "string", description: "Observable condition that allows the item to resume." },
    reviewAt: { type: "string", description: "Future ISO-8601 timestamp for review even if the trigger has not fired." },
    ownerPrincipalId: { type: "string", description: "Canonical Principal id or principalId accountable for the next decision." },
  },
  required: ["reason", "trigger", "reviewAt", "ownerPrincipalId"],
} as const;

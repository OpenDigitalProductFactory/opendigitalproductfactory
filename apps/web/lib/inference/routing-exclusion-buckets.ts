// apps/web/lib/inference/routing-exclusion-buckets.ts
//
// Turn the router's per-endpoint exclusion reasons into ONE plain-language
// cause an owner can act on.
//
// WHY THIS EXISTS: pipeline-v2 already computes an exact reason per excluded
// endpoint and returns them on `decision.excludedReasons`. Every consumer then
// throws that away and substitutes a hardcoded guess — historically "your cloud
// providers are disconnected", which sent a real outage investigation after a
// configuration problem that did not exist while the true cause (a disabled
// connection) stayed invisible. The reasons are the only thing that explains
// WHY a route died; this module buckets them so the dominant cause can be named
// instead of guessed.
//
// Pure module: no DB, no I/O. The reason strings are produced by
// getExclusionReasonV2 (apps/web/lib/routing/pipeline-v2.ts) and arrive prefixed
// with the endpoint id, e.g. "cmq5kq…: Sensitivity clearance missing for 'restricted'".

/** Coarse cause families, each with a distinct owner-facing remedy. */
export type RoutingExclusionBucket =
  /** The connected account cannot use this specific model on this transport. */
  | "account-model-eligibility"
  /** Provider allow/deny list — on this platform, almost always a connection that is switched off. */
  | "connection-excluded"
  /** The endpoint is not cleared for this data class. */
  | "sensitivity-clearance"
  /** Scored dimensions below the task's tier floor. */
  | "quality-floor"
  /** A hard agent capability requirement (EP-AGENT-CAP-002), e.g. tool use. */
  | "capability-floor"
  /** Context window smaller than the request needs. */
  | "context-window"
  /** Endpoint status is not active/degraded. */
  | "endpoint-status"
  /** Model class mismatch (e.g. an embedding model for a chat task). */
  | "model-class"
  /** Anything the buckets above do not recognise. */
  | "other";

export interface BucketedExclusions {
  bucket: RoutingExclusionBucket;
  /** How many endpoints were excluded for this bucket. */
  count: number;
  /** Total endpoints excluded, across all buckets. */
  total: number;
  /** One verbatim reason from this bucket, for the technical disclosure. */
  sampleReason: string;
  /** Every bucket present, most common first — so a tie is still legible. */
  breakdown: Array<{ bucket: RoutingExclusionBucket; count: number }>;
}

/** Strip the "<endpointId>: " prefix pipeline-v2 prepends to each reason. */
export function stripEndpointPrefix(reason: string): string {
  const separator = reason.indexOf(": ");
  if (separator === -1) return reason.trim();
  const head = reason.slice(0, separator);
  // Only strip when the head looks like an id (no spaces) — a genuine reason
  // containing ": " must survive intact.
  return head.includes(" ") ? reason.trim() : reason.slice(separator + 2).trim();
}

/**
 * Classify ONE exclusion reason. Matching is on the stable phrases emitted by
 * getExclusionReasonV2; an unrecognised reason is "other" rather than being
 * forced into a neighbouring bucket, so a new exclusion cannot masquerade as a
 * cause the operator already knows how to fix.
 */
export function bucketExclusionReason(reason: string): RoutingExclusionBucket {
  const text = stripEndpointPrefix(reason).toLowerCase();
  if (text.includes("not supported when codex uses a chatgpt account")) {
    return "account-model-eligibility";
  }
  if (text.includes("request allowlist") || text.includes("request denylist")) {
    return "connection-excluded";
  }
  if (text.includes("sensitivity clearance missing")) return "sensitivity-clearance";
  if (text.includes("minimum quality dimensions not met")) return "quality-floor";
  if (text.includes("requires capability")) return "capability-floor";
  if (text.includes("context window too small")) return "context-window";
  if (text.startsWith("status is")) return "endpoint-status";
  if (text.includes("modelclass")) return "model-class";
  return "other";
}

/**
 * Reduce a full exclusion list to its dominant cause. Returns null for an empty
 * list — "nothing was excluded" is not a cause and must not render as one.
 *
 * Ties break by the ladder order below rather than arbitrarily: a connection
 * that is switched off is a more actionable statement than "quality floor", and
 * naming the actionable one first is the whole point.
 */
const TIE_BREAK_ORDER: RoutingExclusionBucket[] = [
  "account-model-eligibility",
  "connection-excluded",
  "sensitivity-clearance",
  "capability-floor",
  "quality-floor",
  "context-window",
  "endpoint-status",
  "model-class",
  "other",
];

export function dominantExclusion(reasons: readonly string[]): BucketedExclusions | null {
  if (reasons.length === 0) return null;

  const counts = new Map<RoutingExclusionBucket, { count: number; sample: string }>();
  for (const reason of reasons) {
    const bucket = bucketExclusionReason(reason);
    const existing = counts.get(bucket);
    if (existing) existing.count += 1;
    else counts.set(bucket, { count: 1, sample: stripEndpointPrefix(reason) });
  }

  const breakdown = [...counts.entries()]
    .map(([bucket, v]) => ({ bucket, count: v.count }))
    .sort((a, b) =>
      b.count - a.count ||
      TIE_BREAK_ORDER.indexOf(a.bucket) - TIE_BREAK_ORDER.indexOf(b.bucket),
    );

  const top = breakdown[0]!;
  return {
    bucket: top.bucket,
    count: top.count,
    total: reasons.length,
    sampleReason: counts.get(top.bucket)!.sample,
    breakdown,
  };
}

export interface ExclusionExplanation {
  /** What is wrong, in the owner's terms. */
  message: string;
  /** What to do about it — an action, not a restatement of the problem. */
  remediation: string;
  /** Where to do it. Null when the fix is not a portal destination. */
  href: string | null;
}

/**
 * Plain-language explanation for a bucket.
 *
 * Deliberately avoids "activate a provider" as a catch-all: that string is the
 * hardcoded guess this module exists to replace, and on a live install it sent
 * an owner to a page where every provider already read "active".
 */
export function explainExclusion(
  bucketed: BucketedExclusions,
  context: { sensitivity?: string } = {},
): ExclusionExplanation {
  const dataClass = context.sensitivity ? `"${context.sensitivity}"` : "this data class";

  switch (bucketed.bucket) {
    case "account-model-eligibility":
      return {
        message:
          `${bucketed.count} of ${bucketed.total} endpoints use a model that the connected ChatGPT account cannot run through Codex.`,
        remediation:
          "Select a ChatGPT-subscription-supported Codex model such as gpt-5.4, or use an API-key Codex connection for models that require API access.",
        href: "/platform/ai/model-assignment",
      };
    case "connection-excluded":
      return {
        message:
          `${bucketed.count} of ${bucketed.total} endpoints were ruled out because their provider is not in the approved set for this work.`,
        remediation:
          "The provider itself may look active — check its CONNECTION, not just the provider. A connection that is switched off or awaiting a trust-evidence review removes every one of its models from routing.",
        href: "/platform/ai/providers",
      };
    case "sensitivity-clearance":
      return {
        message:
          `${bucketed.count} of ${bucketed.total} endpoints are not cleared to handle ${dataClass} data.`,
        remediation:
          "Either allow this data class on a provider you trust with it, or install a local model capable enough to serve it on-machine. Widening clearance moves this data off your machine — decide it deliberately.",
        href: "/platform/ai/providers",
      };
    case "capability-floor":
      return {
        message:
          `${bucketed.count} of ${bucketed.total} endpoints lack a capability this coworker requires (for example tool use).`,
        remediation:
          "Connect a provider whose models support the required capability, or lower the coworker's capability requirement if it does not genuinely need it.",
        href: "/platform/ai/model-assignment",
      };
    case "quality-floor":
      return {
        message:
          `${bucketed.count} of ${bucketed.total} endpoints scored below the quality floor for this work.`,
        remediation:
          "Check whether those models have actually been measured — an unprofiled model carries placeholder scores and can be excluded despite being capable. Re-run endpoint tests, install a stronger model, or lower the tier floor.",
        href: "/platform/ai/providers",
      };
    case "context-window":
      return {
        message:
          `${bucketed.count} of ${bucketed.total} endpoints have a context window smaller than this work needs.`,
        remediation:
          "Connect a model with a larger context window, or reduce the coworker's minimum context requirement.",
        href: "/platform/ai/model-assignment",
      };
    case "endpoint-status":
      return {
        message: `${bucketed.count} of ${bucketed.total} endpoints are not in a usable state.`,
        remediation: "Review provider status and re-test the connection.",
        href: "/platform/ai/providers",
      };
    case "model-class":
      return {
        message:
          `${bucketed.count} of ${bucketed.total} endpoints are the wrong kind of model for this work (for example an embedding model for a chat task).`,
        remediation:
          "Connect a general-purpose chat model, or correct the model's registered class if it is mis-classified.",
        href: "/platform/ai/providers",
      };
    case "other":
    default:
      return {
        message:
          `${bucketed.count} of ${bucketed.total} endpoints were excluded for a reason this surface does not yet summarise.`,
        remediation: `Verbatim router reason: ${bucketed.sampleReason}`,
        href: "/platform/ai/runtime-health",
      };
  }
}

/**
 * Surface-neutral semantic change-review contract.
 *
 * This module deliberately has no Build Studio, Prisma, GitHub, or inference
 * dependency. Authoring surfaces create the same receipt; persistence adapters
 * can store it in the existing ExternalEvidenceRecord and WorkCapsuleActivity
 * streams without adding another finding or receipt table.
 */

export const CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION = "semantic-change-review-receipt.v2";
export const CHANGE_REVIEW_POLICY_VERSION = "semantic-change-review-policy.v2";
export const CHANGE_REVIEWER_VERSION = "change-reviewer.v1";

export type SemanticReviewSeverity = "critical" | "important" | "minor";
export type SemanticReviewDecision = "pass" | "fail" | "inconclusive";
export type SemanticReviewRisk = "low" | "medium" | "high" | "critical";
export type SemanticReviewDisposition = "reviewed" | "auto-pass";

export interface SemanticReviewIssue {
  severity: SemanticReviewSeverity;
  description: string;
  location?: string;
  suggestion?: string;
}

export interface SemanticReviewResult {
  decision: SemanticReviewDecision;
  issues: SemanticReviewIssue[];
  summary: string;
  parseError?: true;
  /** Infrastructure/protocol failure, deliberately separate from semantic findings. */
  inconclusiveReason?: string;
}

export interface SemanticReviewIdentity {
  capsuleId: string;
  baseTreeHash: string;
  headTreeHash: string;
  diffDigest: string;
  policyVersion: string;
  reviewerVersion: string;
  specialistIds: readonly string[];
}

export interface SemanticReviewReceipt extends Omit<SemanticReviewIdentity, "specialistIds"> {
  schemaVersion: typeof CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION;
  specialistIds: string[];
  disposition: SemanticReviewDisposition;
  risk: SemanticReviewRisk;
  result: SemanticReviewResult;
  rationale?: string;
}

export type SemanticReviewStaleReason =
  | "schema-version-changed"
  | "capsule-changed"
  | "base-tree-changed"
  | "head-tree-changed"
  | "diff-changed"
  | "policy-version-changed"
  | "reviewer-version-changed"
  | "specialist-set-changed";

function normalizedSpecialistIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

export function createSemanticReviewReceipt(input: {
  identity: SemanticReviewIdentity;
  disposition: SemanticReviewDisposition;
  risk: SemanticReviewRisk;
  result: SemanticReviewResult;
  rationale?: string;
}): SemanticReviewReceipt {
  return {
    schemaVersion: CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION,
    ...input.identity,
    specialistIds: normalizedSpecialistIds(input.identity.specialistIds),
    disposition: input.disposition,
    risk: input.risk,
    result: input.result,
    rationale: input.rationale,
  };
}

export function createLowRiskAutoPassReceipt(input: {
  identity: SemanticReviewIdentity;
  rationale: string;
}): SemanticReviewReceipt {
  return createSemanticReviewReceipt({
    identity: input.identity,
    disposition: "auto-pass",
    risk: "low",
    rationale: input.rationale,
    result: {
      decision: "pass",
      issues: [],
      summary: `Independent semantic review auto-passed: ${input.rationale}`,
    },
  });
}

export function assessSemanticReviewReceiptFreshness(
  receipt: SemanticReviewReceipt,
  current: SemanticReviewIdentity,
): { fresh: boolean; reasons: SemanticReviewStaleReason[] } {
  const reasons: SemanticReviewStaleReason[] = [];
  if (receipt.schemaVersion !== CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION) reasons.push("schema-version-changed");
  if (receipt.capsuleId !== current.capsuleId) reasons.push("capsule-changed");
  if (receipt.baseTreeHash !== current.baseTreeHash) reasons.push("base-tree-changed");
  if (receipt.headTreeHash !== current.headTreeHash) reasons.push("head-tree-changed");
  if (receipt.diffDigest !== current.diffDigest) reasons.push("diff-changed");
  if (receipt.policyVersion !== current.policyVersion) reasons.push("policy-version-changed");
  if (receipt.reviewerVersion !== current.reviewerVersion) reasons.push("reviewer-version-changed");
  if (JSON.stringify(receipt.specialistIds) !== JSON.stringify(normalizedSpecialistIds(current.specialistIds))) {
    reasons.push("specialist-set-changed");
  }
  return { fresh: reasons.length === 0, reasons };
}

/** Persistence-shaped projections for the platform's existing evidence streams. */
export function projectSemanticReviewReceipt(receipt: SemanticReviewReceipt): {
  externalEvidence: {
    routeContext: "change-review";
    operationType: "semantic-change-review.receipt";
    target: string;
    provider: "dpf-change-review";
    resultSummary: string;
    details: SemanticReviewReceipt;
  };
  activity: {
    kind: "evidence-recorded";
    summary: string;
    payload: SemanticReviewReceipt;
  };
} {
  const summary = `${receipt.disposition} semantic change review ${receipt.result.decision}: ${receipt.result.summary}`;
  return {
    externalEvidence: {
      routeContext: "change-review",
      operationType: "semantic-change-review.receipt",
      target: receipt.capsuleId,
      provider: "dpf-change-review",
      resultSummary: summary,
      details: receipt,
    },
    activity: { kind: "evidence-recorded", summary, payload: receipt },
  };
}

export function buildSemanticChangeReviewPrompt(input: {
  title: string;
  artifact: string;
  verificationEvidence: string;
  /** Keeps the pre-existing Build Studio prompt byte-for-byte compatible. */
  promptProfile?: "surface-neutral" | "build-studio-v1";
}): string {
  const buildStudio = input.promptProfile === "build-studio-v1";
  const introduction = buildStudio
    ? "You are reviewing code changes for a single build task."
    : "You are reviewing a semantic code change produced by an authoring surface.";
  const titleLabel = buildStudio ? "TASK" : "CHANGE";
  const evidenceLabel = buildStudio ? "TEST OUTPUT" : "VERIFICATION EVIDENCE";

  return `${introduction}

${titleLabel}: ${input.title}

CODE CHANGES:
${input.artifact}

${evidenceLabel}:
${input.verificationEvidence}

REVIEW CHECKLIST — evaluate EVERY item before responding:
1. Does a test exist that covers this change?
2. Is there code duplication with existing functionality?
3. Does the code follow project patterns (TypeScript, Next.js, Tailwind)?
4. Are there security concerns (injection, XSS, etc.)?
5. Is the code clean and maintainable?
6. Does the code use CSS variables (var(--dpf-*)) for all colors — no text-white, bg-white, text-black, bg-black, or inline hex values? (Exception: text-white on accent-background buttons, semantic status colors from ThemeTokens.states)
7. Are interactive elements keyboard-accessible with visible focus indicators? Do form inputs have associated labels? Do buttons have descriptive accessible names?

DECISION DISCIPLINE: report the genuine BLOCKING issues in a single response — be comprehensive about real blockers so there are no surprises on re-review, but do NOT pad the list with nice-to-haves. Reserve "critical" for issues that would cause data loss, security holes, or broken functionality; "important"/"minor" do not block. If the change is correct and tested at a level appropriate to its scope, return "pass". A short, converging review beats an exhaustive one.

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}`;
}

export function parseSemanticReviewResponse(raw: string): SemanticReviewResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((issue: Record<string, unknown>) => ({
          severity: (["critical", "important", "minor"].includes(String(issue.severity))
            ? String(issue.severity)
            : "minor") as SemanticReviewSeverity,
          description: String(issue.description ?? ""),
          location: issue.location ? String(issue.location) : undefined,
          suggestion: issue.suggestion ? String(issue.suggestion) : undefined,
        }))
      : [];
    return {
      decision: issues.some((issue) => issue.severity === "critical") ? "fail" : "pass",
      issues,
      summary: String(parsed.summary ?? "Review complete"),
    };
  } catch {
    return {
      decision: "inconclusive",
      issues: [],
      summary: "Review was inconclusive — the reviewer response could not be parsed.",
      parseError: true,
      inconclusiveReason: "unparseable-review-response",
    };
  }
}

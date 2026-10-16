/**
 * Surface-neutral semantic change-review contract.
 *
 * This module deliberately has no Build Studio, Prisma, GitHub, or inference
 * dependency. Authoring surfaces create the same receipt; persistence adapters
 * can store it in the existing ExternalEvidenceRecord and WorkroomActivity
 * streams without adding another finding or receipt table.
 */

import { z } from "zod";
import { readRoutingEligibility, type RoutingEligibility } from "../inference/routing-exclusion-buckets.ts";
import type { DeliberationArtifactType } from "../deliberation/external-review-activation";

export const LEGACY_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION = "semantic-change-review-receipt.v2";
export const ROLE_BOUND_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION = "semantic-change-review-receipt.v3";
export const CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION = ROLE_BOUND_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION;
export const CHANGE_REVIEW_POLICY_VERSION = "semantic-change-review-policy.v3";
export const LEGACY_CHANGE_REVIEWER_VERSION = "change-reviewer.v1";
export const CHANGE_REVIEWER_VERSION = "change-reviewer.v2";
/** Compatible readers deployed before activation; legacy packets retain their original version. */
export const SEMANTIC_REVIEW_ARTIFACT_CONTRACT_VERSION: 1 | 2 = 2;

/** Historical receipts remain readable; freshness determines whether they authorize new work. */
export function isSemanticReviewReceipt(value: unknown): value is SemanticReviewReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<SemanticReviewReceipt>;
  return receipt.schemaVersion === LEGACY_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION
    || (receipt.schemaVersion === ROLE_BOUND_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION
      && typeof receipt.artifactType === "string");
}

export type SemanticReviewSeverity = "critical" | "important" | "minor";
export type SemanticReviewDecision = "pass" | "fail" | "inconclusive";
export type SemanticReviewRisk = "low" | "medium" | "high" | "critical";
export type SemanticReviewDisposition = "reviewed" | "auto-pass";

export interface SemanticReviewIssue {
  severity: SemanticReviewSeverity;
  description: string;
  location?: string;
  suggestion?: string;
  /** Set only by the server for a craft contribution; never provider authority. */
  advisory?: true;
}

export const semanticReviewCraftGroundingSchema = z.object({
  agentId: z.string().min(1).max(256), professionKey: z.string().min(1).max(256),
  corpusPages: z.array(z.string().min(1).max(2000)).max(50), corpusDigest: z.string().regex(/^[a-f0-9]{64}$/),
  critiqueRefs: z.array(z.string().min(1).max(2000)).max(20), calibratedCritiqueCount: z.number().int().min(0).nullable(),
}).strict();
export type SemanticReviewCraftGrounding = z.infer<typeof semanticReviewCraftGroundingSchema>;

export interface SemanticReviewResult {
  decision: SemanticReviewDecision;
  issues: SemanticReviewIssue[];
  summary: string;
  parseError?: true;
  /** Content-free diagnostics survive branch checkpoints and receipt readback. */
  parseDiagnostics?: SemanticReviewParseDiagnostic[];
  /** Infrastructure/protocol failure, deliberately separate from semantic findings. */
  inconclusiveReason?: string;
  /** Trusted routing diagnostics, never parsed from a provider response. */
  routingEligibility?: RoutingEligibility[];
  failureAnalysisReview?: { adequate: boolean; rationale: string };
  /** Server-supplied material delivered to the executed specialist branch. */
  craftGrounding?: SemanticReviewCraftGrounding[];
}

export interface SemanticReviewParseDiagnostic {
  agentId?: string;
  stage: "missing-json" | "invalid-json" | "schema-mismatch";
  violations?: Array<{ field: string; code: string }>;
  structure?: z.infer<typeof responseStructureSchema>;
}

export interface SemanticReviewIdentity {
  /** Absent only on immutable legacy requests and historical receipts. */
  artifactType?: DeliberationArtifactType;
  capsuleId: string;
  baseTreeHash: string;
  headTreeHash: string;
  diffDigest: string;
  policyVersion: string;
  reviewerVersion: string;
  specialistIds: readonly string[];
  specialistSelectionDigest?: string;
  failureAnalysisDigest?: string;
  sourceHeadSha?: string;
}

export interface SemanticReviewReceipt extends Omit<SemanticReviewIdentity, "specialistIds"> {
  failureAnalysis?: unknown;
  schemaVersion: typeof ROLE_BOUND_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION | typeof LEGACY_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION;
  specialistIds: string[];
  disposition: SemanticReviewDisposition;
  risk: SemanticReviewRisk;
  result: SemanticReviewResult;
  rationale?: string;
}

export type SemanticReviewStaleReason =
  | "schema-version-changed"
  | "artifact-type-changed"
  | "capsule-changed"
  | "base-tree-changed"
  | "head-tree-changed"
  | "diff-changed"
  | "policy-version-changed"
  | "reviewer-version-changed"
  | "specialist-selection-changed"
  | "specialist-set-changed"
  | "failure-analysis-changed";

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
    schemaVersion: input.identity.artifactType ? ROLE_BOUND_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION : LEGACY_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION,
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
  const schemaVersion = current.artifactType ? ROLE_BOUND_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION : LEGACY_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION;
  if (receipt.schemaVersion !== schemaVersion) reasons.push("schema-version-changed");
  if (receipt.artifactType !== current.artifactType) reasons.push("artifact-type-changed");
  if (receipt.capsuleId !== current.capsuleId) reasons.push("capsule-changed");
  if (receipt.baseTreeHash !== current.baseTreeHash) reasons.push("base-tree-changed");
  if (receipt.headTreeHash !== current.headTreeHash) reasons.push("head-tree-changed");
  if (receipt.sourceHeadSha !== current.sourceHeadSha) reasons.push("head-tree-changed");
  if (receipt.diffDigest !== current.diffDigest) reasons.push("diff-changed");
  if (receipt.specialistSelectionDigest !== current.specialistSelectionDigest) reasons.push("specialist-selection-changed");
  if (receipt.failureAnalysisDigest !== current.failureAnalysisDigest) reasons.push("failure-analysis-changed");
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
  artifactType?: DeliberationArtifactType;
  title: string;
  artifact: string;
  verificationEvidence: string;
  /** Keeps the pre-existing Build Studio prompt byte-for-byte compatible. */
  promptProfile?: "surface-neutral" | "build-studio-v1";
  requireFailureAnalysis?: boolean;
}): string {
  const buildStudio = input.promptProfile === "build-studio-v1";
  const introduction = buildStudio
    ? "You are reviewing code changes for a single build task."
    : "You are reviewing a semantic code change produced by an authoring surface.";
  const titleLabel = buildStudio ? "TASK" : "CHANGE";
  const evidenceLabel = buildStudio ? "TEST OUTPUT" : "VERIFICATION EVIDENCE";
  const responseContract = buildStudio ? `{
  "decision": "pass" or "fail" or "cannot-verify",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}` : JSON.stringify({
    decision: "pass", issues: [], summary: "Replace with your review summary.",
    ...(input.requireFailureAnalysis ? { failureAnalysisReview: {
      adequate: true, rationale: "Replace with the omission challenge and evidence supporting recovery readiness.",
    } } : {}),
  }, null, 2);
  const responseGuidance = buildStudio ? "" : `Choose decision \"pass\", \"fail\" or \"cannot-verify\" from the evidence. For findings, issues contains objects with severity (\"critical\", \"important\" or \"minor\") and description. The example values are placeholders, not a verdict.${input.requireFailureAnalysis ? " Include failureAnalysisReview in the same object. Set adequate to your assessment; explain the omission challenge and why final-change evidence supports recovery readiness. A bare assurance is insufficient." : ""}\n\n`;

  const artifactAuthority = buildStudio ? "" : "The supplied immutable artifact is the review target. Review its changed code and attached evidence. An unrelated ambient checkout is not evidence that this artifact is missing; do not substitute local HEAD for the supplied change. If the artifact itself is absent, truncated, or lacks context needed for a verdict, use cannot-verify and name the missing evidence.\n\n";

  if (!buildStudio && input.artifactType && input.artifactType !== "code-change") {
    const expectations: Record<Exclude<DeliberationArtifactType, "code-change">, string> = {
      spec: "Evaluate requirements, acceptance criteria, scope, existing architecture, alternatives, interfaces, risks and a feasible verification strategy.",
      plan: "Evaluate ordered work, dependencies, ownership, compatibility and deployment stages, rollback, acceptance coverage and a feasible verification strategy.",
      "architecture-decision": "Evaluate the decision context, alternatives, tradeoffs, canonical contracts, consequences, reversibility and validation strategy.",
      policy: "Evaluate policy scope, authority, obligations, exceptions, enforceability, conflicts and evidence of compliance.",
      "research-question": "Evaluate the question, assumptions, sources, methods, uncertainty, alternatives and what evidence could answer or refute it.",
    };
    return `You are reviewing an immutable ${input.artifactType} document produced by an authoring surface.

The supplied immutable artifact is the review target. An unrelated ambient checkout cannot replace it. Use cannot-verify for empty, truncated, identity-mismatched or insufficient material, naming the missing reference. Never invent a verdict for unread contents.

DOCUMENT: ${input.title}

IMMUTABLE ARTIFACT (${input.artifactType}):
${input.artifact}

VERIFICATION EVIDENCE:
${input.verificationEvidence}

REVIEW EXPECTATIONS:
${expectations[input.artifactType]}
Distinguish design adequacy from implementation proof. For a proposal, judge whether its verification and failure-recovery plan is credible; do not demand passing tests for code it explicitly has not implemented. Require evidence for claims that implementation or runtime verification already occurred. Check consistency, traceability, authorization boundaries and concrete business/user effects. Ordinary prose does not require a governed objective grammar unless that role is explicitly declared.

DECISION DISCIPLINE: report genuine blocking defects comprehensively. Reserve critical for data loss, security holes or broken functionality; important/minor observations do not block. Missing or contradictory source is cannot-verify, not a finding about unread code.

${responseGuidance}RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
${responseContract}`;
  }

  return `${introduction}

${artifactAuthority}${titleLabel}: ${input.title}

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

CANNOT VERIFY: if the change described above is not actually present in what you can read — ${buildStudio ? "the tree you can see does not contain it, the artifact is empty, or you are looking at different code" : "the supplied artifact is empty, incomplete, or does not contain the described change"} — respond with decision "cannot-verify" and say so in the summary. That is NOT a code issue and must NOT be reported as one: a finding about the code presumes you read the code. Answering "pass" or "fail" asserts that you reviewed THIS change.

DECISION DISCIPLINE: report the genuine BLOCKING issues in a single response — be comprehensive about real blockers so there are no surprises on re-review, but do NOT pad the list with nice-to-haves. Reserve "critical" for issues that would cause data loss, security holes, or broken functionality; "important"/"minor" do not block. If the change is correct and tested at a level appropriate to its scope, return "pass". A short, converging review beats an exhaustive one.

${responseGuidance}RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
${responseContract}`;
}

/**
 * A reviewer that reports it could not see the change, but files that report as a
 * code finding instead of using the cannot-verify channel (BI-82902891). Kept
 * deliberately narrow: it requires the reviewed MATERIAL to be the subject, so an
 * ordinary finding like "a loading state is not present" does not trip it. A false
 * positive costs one retry; a false negative publishes a review of code nobody read.
 */
const UNREVIEWABLE_FINDING = [
  /\b(?:tree|artifact|diff|changeset|working copy|workspace|repository)\b[^.]{0,80}\b(?:does not contain|do not contain|is empty|are empty|not available|not present|could not be (?:read|resolved|located|found))/i,
  /\bcould not\b[^.]{0,40}\b(?:see|read|locate|access|review|verify)\b[^.]{0,40}\b(?:change|diff|artifact|code|tree)\b/i,
  /\breceipt integrity failure\b/i,
];

function reportsUnreviewableChange(issues: readonly SemanticReviewIssue[], summary: string): boolean {
  return [...issues.map((issue) => issue.description), summary]
    .some((text) => UNREVIEWABLE_FINDING.some((pattern) => pattern.test(text)));
}

const reviewerResponseSchema = z.object({
  decision: z.string().transform(value => value.trim().toLowerCase().replaceAll("_", "-"))
    .pipe(z.enum(["pass", "fail", "cannot-verify", "inconclusive"])),
  issues: z.array(z.object({
    severity: z.enum(["critical", "important", "minor"]),
    description: z.string().trim().min(1),
    location: z.string().optional(), suggestion: z.string().optional(),
  })),
  summary: z.string().trim().min(1),
  failureAnalysisReview: z.object({ adequate: z.boolean(), rationale: z.string() }).optional(),
});

export function parseSemanticReviewResponse(raw: string): SemanticReviewResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return unparseableReview({ stage: "missing-json", structure: responseStructure(raw) });
  let value: unknown;
  try {
    value = JSON.parse(jsonMatch[0]);
  } catch {
    // JSON parser messages can quote source or credentials. Never retain them.
    return unparseableReview({ stage: "invalid-json", structure: responseStructure(raw) });
  }
  const validation = reviewerResponseSchema.safeParse(value);
  if (!validation.success) {
    return unparseableReview({ stage: "schema-mismatch", violations:
      validation.error.issues.slice(0, 8).map(issue => ({
        // Only schema-owned fields; never values, arbitrary keys or messages.
        field: issue.path.filter(part => typeof part === "string" && REVIEW_RESPONSE_FIELDS.has(part)).join(".") || "response",
        code: issue.code,
      })),
    });
  }
  const parsed = validation.data;
  const { issues, summary } = parsed;
  // BI-82902891: a reviewer that could not see the change must never reach the
  // pass path. Before this channel existed the response contract offered only
  // pass|fail and the decision came from issue severity alone, so "the tree I
  // was given does not contain this change" arrived as an `important` issue
  // and aggregated into a PASS — an independent-review receipt for a change
  // nobody had read. Inability to review is an INCONCLUSIVE outcome, which
  // already fails closed downstream, not a finding about the code.
  const stated = parsed.decision;
  // The channel is the contract, but a reviewer that ignores it and files
  // "I could not see this change" as a finding must not reach the pass path
  // either — that is the exact shape of the BI-82902891 incident.
  if (stated === "cannot-verify" || stated === "inconclusive" || reportsUnreviewableChange(issues, summary)) {
    return {
      decision: "inconclusive",
      issues,
      summary,
      inconclusiveReason: "reviewer-could-not-verify-change",
    };
  }
  return {
    decision: issues.some((issue) => issue.severity === "critical") ? "fail" : "pass",
    issues,
    summary,
    ...(parsed.failureAnalysisReview ? { failureAnalysisReview: parsed.failureAnalysisReview } : {}),
  };
}

const REVIEW_RESPONSE_FIELDS = new Set([
  "decision", "issues", "severity", "description", "location", "suggestion",
  "summary", "failureAnalysisReview", "adequate", "rationale",
]);

const STRUCTURE_SCAN_LIMIT = 1_000_000;
const boundedCount = z.number().int().min(0).max(STRUCTURE_SCAN_LIMIT);
const responseStructureSchema = z.object({
  characters: boundedCount, completedObjects: boundedCount, openDepth: boundedCount,
  unterminatedString: z.boolean(), scanTruncated: z.boolean(),
}).strict();

/** Diagnostic counts only: never source excerpts, parser messages or JSON repair. */
function responseStructure(raw: string): z.infer<typeof responseStructureSchema> {
  const characters = Math.min(raw.length, STRUCTURE_SCAN_LIMIT);
  let openDepth = 0, completedObjects = 0;
  let quoted = false, escaped = false;
  for (let i = 0; i < characters; i++) {
    const char = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") openDepth++;
    else if (char === "}" && openDepth > 0 && --openDepth === 0) completedObjects++;
  }
  return { characters, completedObjects, openDepth, unterminatedString: quoted,
    scanTruncated: raw.length > characters };
}

/** A persisted normalized result is not a new provider response. Validate the
 * common review fields, then restore only bounded, content-free diagnostics. */
export function restoreSemanticReviewCheckpoint(value: unknown, agentId: string): SemanticReviewResult {
  let result = parseSemanticReviewResponse(JSON.stringify(value) ?? "");
  const grounding = z.object({ craftGrounding: z.array(semanticReviewCraftGroundingSchema).max(50) }).safeParse(value);
  if (grounding.success) result = { ...result, craftGrounding: grounding.data.craftGrounding };
  const eligibility = z.object({ decision: z.literal("inconclusive"),
    inconclusiveReason: z.literal("review-endpoint-ineligible"), routingEligibility: z.array(z.unknown()).min(1).max(5),
  }).safeParse(value);
  if (eligibility.success) {
    const diagnostics = eligibility.data.routingEligibility.map(readRoutingEligibility);
    if (diagnostics.every((item): item is RoutingEligibility => item !== null)) return { ...result,
      decision: "inconclusive", inconclusiveReason: "review-endpoint-ineligible", routingEligibility: diagnostics };
  }
  const stored = z.object({
    decision: z.literal("inconclusive"),
    parseError: z.literal(true),
    parseDiagnostics: z.array(z.object({
      stage: z.enum(["missing-json", "invalid-json", "schema-mismatch"]),
      structure: responseStructureSchema.optional(),
      violations: z.array(z.object({
        field: z.string().max(80).refine(field => field === "response" || field.split(".").every(part => REVIEW_RESPONSE_FIELDS.has(part))),
        code: z.enum(z.ZodIssueCode),
      })).max(8).optional(),
    })).max(5),
  }).safeParse(value);
  if (!stored.success || result.decision !== "inconclusive") return result;
  return { ...result, parseError: true, inconclusiveReason: "unparseable-review-response",
    parseDiagnostics: stored.data.parseDiagnostics.map(diagnostic => ({ ...diagnostic, agentId })),
  };
}

function unparseableReview(diagnostic: SemanticReviewParseDiagnostic): SemanticReviewResult {
  return {
    decision: "inconclusive",
    issues: [],
    summary: `Review was inconclusive — reviewer response validation failed (${diagnostic.stage}).`,
    parseError: true,
    parseDiagnostics: [diagnostic],
    inconclusiveReason: "unparseable-review-response",
  };
}

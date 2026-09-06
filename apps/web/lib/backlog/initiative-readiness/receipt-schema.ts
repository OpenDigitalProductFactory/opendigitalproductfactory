import { createHash } from "node:crypto";
import { validateInitiativeDisposition } from "./disposition-contract";

import type { InitiativeSubject } from "./types";
import type { ReadinessProfile } from "./types";
import { independentReviewerRemedy } from "./reviewer-identity";

export const INITIATIVE_GATE_KEYS = [
  "classification",
  "research",
  "design-spec",
  "spec-approval",
  "architecture-review",
  "data-review",
  "ux-fit-review",
  "security-review",
  "compliance-review",
  "domain-review",
  "plan-review",
  "dependency-disposition",
  "archetype-provisioning",
  "archetype-completeness",
] as const;

export type InitiativeGateKey = (typeof INITIATIVE_GATE_KEYS)[number];
export type InitiativeGateDecision = "pass" | "fail" | "not-applicable";

export type InitiativeArtifactRef =
  | { kind: "feature-build-revision"; revisionId: string }
  | { kind: "document-version"; versionId: string }
  | {
    kind: "repo-blob-at-commit";
    repositoryFullName: string;
    commitSha: string;
    path: string;
    providerBlobId: string;
  };

export type InitiativeAuthoritySnapshot = {
  decision: "allow";
  effectiveHumanCapability: string;
  effectiveAgentGrant: string;
  tokenScope: string;
  organizationId: string;
  actionKey: string;
  policyVersion: string;
};

export type ResolvedInitiativeArtifact = {
  ref: InitiativeArtifactRef;
  digest: string;
  authorPrincipalId: string | null;
  authorAgentId: string | null;
};

export type InitiativeFinding = {
  findingRef: string;
  severity: "critical" | "important";
  issue: string;
};

export type InitiativeGateReceiptContext = {
  receiptId: string;
  policyVersion: string;
  allowedGates: readonly InitiativeGateKey[];
  subject: InitiativeSubject;
  resolvedArtifact: ResolvedInitiativeArtifact;
  reviewerPrincipalId: string | null;
  reviewerAgentId: string | null;
  authorityDecisionId: string;
  authoritySnapshot: InitiativeAuthoritySnapshot;
  openFindingRefs: readonly string[];
  resolvedFindings: readonly InitiativeFinding[];
  requiresIndependentReviewer?: boolean;
  authoritativeProfile?: ReadinessProfile | null;
};

export type InitiativeGateReceiptDraft = {
  gate: InitiativeGateKey;
  decision: InitiativeGateDecision;
  artifactRef: InitiativeArtifactRef;
  reason: string;
  findingRefs: string[];
  resolvedFindingRefs: string[];
  selectedProfile?: ReadinessProfile;
};

export type InitiativeGateReceipt = {
  schemaVersion: 1;
  receiptId: string;
  policyVersion: string;
  gate: InitiativeGateKey;
  decision: InitiativeGateDecision;
  subject: InitiativeSubject;
  artifactRef: InitiativeArtifactRef;
  artifactDigest: string;
  artifactAuthorRef: string;
  reviewerPrincipalId: string;
  reviewerAgentId: string;
  authorityDecisionId: string;
  authoritySnapshot: InitiativeAuthoritySnapshot;
  reason: string;
  findingRefs: string[];
  resolvedFindingRefs: string[];
  selectedProfile?: ReadinessProfile;
};

export type InitiativeGateReceiptValidationResult =
  | { ok: true; receipt: InitiativeGateReceipt }
  | {
    ok: false;
    code:
      | "artifact-mismatch"
      | "blocking-findings-open"
      | "finding-resolution-invalid"
      | "gate-not-authorized"
      | "malformed-receipt"
      | "reason-required"
      | "reviewer-not-independent";
    error: string;
  };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isArtifactRef(value: unknown): value is InitiativeArtifactRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  if (ref.kind === "feature-build-revision") return isNonEmptyString(ref.revisionId);
  if (ref.kind === "document-version") return isNonEmptyString(ref.versionId);
  return ref.kind === "repo-blob-at-commit"
    && isNonEmptyString(ref.repositoryFullName)
    && isNonEmptyString(ref.commitSha)
    && isNonEmptyString(ref.path)
    && isNonEmptyString(ref.providerBlobId);
}

function artifactRefsMatch(left: InitiativeArtifactRef, right: InitiativeArtifactRef): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "feature-build-revision" && right.kind === left.kind) {
    return left.revisionId === right.revisionId;
  }
  if (left.kind === "document-version" && right.kind === left.kind) {
    return left.versionId === right.versionId;
  }
  if (left.kind === "repo-blob-at-commit" && right.kind === left.kind) {
    return left.repositoryFullName === right.repositoryFullName
      && left.commitSha === right.commitSha
      && left.path === right.path
      && left.providerBlobId === right.providerBlobId;
  }
  return false;
}

function reject(
  code: Exclude<InitiativeGateReceiptValidationResult, { ok: true }>["code"],
  error: string,
): InitiativeGateReceiptValidationResult {
  return { ok: false, code, error };
}

export function validateInitiativeGateReceiptDraft(
  draft: InitiativeGateReceiptDraft,
  context: InitiativeGateReceiptContext,
): InitiativeGateReceiptValidationResult {
  if (!draft || typeof draft !== "object"
    || !INITIATIVE_GATE_KEYS.includes(draft.gate)
    || !(["pass", "fail", "not-applicable"] as const).includes(draft.decision)
    || !isArtifactRef(draft.artifactRef)
    || typeof draft.reason !== "string"
    || !isStringArray(draft.findingRefs)
    || !isStringArray(draft.resolvedFindingRefs)) {
    return reject("malformed-receipt", "The reviewer payload does not match the governed receipt schema.");
  }
  const resolvedFindingRefs = context.resolvedFindings.map((finding) => finding.findingRef);
  if (resolvedFindingRefs.length !== draft.findingRefs.length
    || resolvedFindingRefs.some((findingRef, index) => findingRef !== draft.findingRefs[index])
    || context.resolvedFindings.some((finding) => !finding.issue.trim()
      || (finding.severity !== "critical" && finding.severity !== "important"))) {
    return reject("malformed-receipt", "Finding identities and issue metadata must be server-derived and aligned.");
  }

  if (!context.allowedGates.includes(draft.gate)) {
    return reject("gate-not-authorized", `This reviewer tool cannot record the ${draft.gate} lane.`);
  }
  if (draft.gate === "classification" && draft.decision === "pass") {
    if (!draft.selectedProfile || draft.selectedProfile !== context.authoritativeProfile) {
      return reject("malformed-receipt", "Classification must record the server-reconciled authoritative profile.");
    }
  } else if (draft.selectedProfile !== undefined) {
    return reject("malformed-receipt", "Only a passing classification receipt can select a profile.");
  }
  if (!draft.reason.trim()) {
    return reject("reason-required", "A review reason is required.");
  }
  if (!artifactRefsMatch(draft.artifactRef, context.resolvedArtifact.ref)) {
    return reject("artifact-mismatch", "The submitted locator is not the server-resolved immutable artifact.");
  }

  // Separation of duties is enforced between PRINCIPALS, which is the
  // accountable identity on both sides. Agent identity is optional context and is
  // compared only when both sides carry one — requiring an author agent locked
  // out every externally-authored artifact regardless of who reviewed it
  // (BI-B9403248). The independence rule itself is unchanged: an author still
  // cannot approve their own artifact.
  const { authorPrincipalId, authorAgentId } = context.resolvedArtifact;
  if (!authorPrincipalId || !context.reviewerPrincipalId || !context.reviewerAgentId) {
    return reject("reviewer-not-independent", "Author and reviewer identities must both be known.");
  }
  if (context.requiresIndependentReviewer !== false && (
    context.reviewerPrincipalId === authorPrincipalId
    || (authorAgentId !== null && context.reviewerAgentId === authorAgentId)
  )) {
    // BI-72F368BC: the old text named the rule and nothing else — not the
    // author, not the reviewer, and not the one route that exists. On a
    // single-human-principal install this refusal is the whole reason no
    // scope baseline and therefore no v2 plan-coverage receipt was reachable,
    // and the message gave no way to learn that.
    return reject("reviewer-not-independent", independentReviewerRemedy({
      gate: draft.gate,
      grant: context.authoritySnapshot.effectiveAgentGrant,
      authorPrincipalId,
      reviewerPrincipalId: context.reviewerPrincipalId,
      reviewerKind: context.reviewerPrincipalId === authorPrincipalId ? "human" : "coworker",
    }));
  }

  const openFindings = new Set(context.openFindingRefs);
  if (draft.resolvedFindingRefs.some((finding) => !openFindings.has(finding))) {
    return reject("finding-resolution-invalid", "A resolution can name only a currently open finding.");
  }
  if (draft.findingRefs.some((finding) => draft.resolvedFindingRefs.includes(finding))) {
    return reject("finding-resolution-invalid", "A receipt cannot introduce and resolve the same finding.");
  }
  const dispositionError = validateInitiativeDisposition(draft.decision, draft.findingRefs, draft.resolvedFindingRefs);
  if (dispositionError) return reject("malformed-receipt", dispositionError);
  for (const resolved of draft.resolvedFindingRefs) openFindings.delete(resolved);
  if (draft.decision !== "fail" && openFindings.size > 0) {
    return reject("blocking-findings-open", "A passing or not-applicable receipt cannot leave findings open.");
  }

  return {
    ok: true,
    receipt: {
      schemaVersion: 1,
      receiptId: context.receiptId,
      policyVersion: context.policyVersion,
      gate: draft.gate,
      decision: draft.decision,
      subject: context.subject,
      artifactRef: context.resolvedArtifact.ref,
      artifactDigest: context.resolvedArtifact.digest,
      artifactAuthorRef: `principal:${authorPrincipalId}|agent:${authorAgentId}`,
      reviewerPrincipalId: context.reviewerPrincipalId,
      reviewerAgentId: context.reviewerAgentId,
      authorityDecisionId: context.authorityDecisionId,
      authoritySnapshot: context.authoritySnapshot,
      reason: draft.reason.trim(),
      findingRefs: [...draft.findingRefs],
      resolvedFindingRefs: [...draft.resolvedFindingRefs],
      ...(draft.selectedProfile ? { selectedProfile: draft.selectedProfile } : {}),
    },
  };
}

export function buildStableInitiativeFindingId(input: {
  artifactDigest: string;
  gate: InitiativeGateKey;
  issue: string;
}): string {
  const normalizedIssue = input.issue.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  const digest = createHash("sha256")
    .update(`${input.artifactDigest}\0${input.gate}\0${normalizedIssue}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `IF-${digest}`;
}

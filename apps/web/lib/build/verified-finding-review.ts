// Verified-finding review — ultrareview-class discipline for Build Studio gates.
//
// BI-269922A4 (EP-27FD96BC). Industry data (2026): AI-coauthored PRs carry ~1.7x
// more issues, and the durable answer is not "more reviewers" but *verified*
// findings — a finding is only allowed to BLOCK (fail the gate / trigger a
// rework round) once an independent, fresh-context verifier has reproduced it.
// This is the separation-of-duties consensus (generate vs verify) and mirrors
// Claude Code's ultrareview, which reproduces every finding before reporting it.
//
// Mechanism (deliberately the same shape as build-reviewers' test-first
// downgrade): take the merged ReviewResult, run each *critical* finding through
// a verifier that is prompted to REFUTE it against the actual artifact, and
// downgrade any finding the verifier could not reproduce to a non-blocking
// advisory `minor`. Verified criticals keep failing the gate. The decision is
// then recomputed from the surviving severities. Important/minor findings are
// already non-blocking, so only criticals are worth the verifier spend.
//
// The pure verdict-application (`applyFindingVerdicts`) is separated from the
// dispatch (`verifyReviewFindings`, dependency-injected) so the gate logic is
// trivially unit-testable without any inference. The env flag lives in the
// caller (build-studio-config) so this module stays pure of process.env.

import type { ReviewResult } from "@/lib/feature-build-types";

type ReviewIssue = ReviewResult["issues"][number];

export type VerifiedFindingArtifact = string | {
  kind: "plan" | "code-change";
  content: string;
};

function normalizeArtifact(artifact: VerifiedFindingArtifact): { label: string; content: string } {
  if (typeof artifact === "string") return { label: "ARTIFACT", content: artifact };
  return {
    label: artifact.kind === "code-change" ? "CODE CHANGE" : "PLAN",
    content: artifact.content,
  };
}

/** One verifier's judgment on one finding. `verified=false` means the verifier
 *  could not reproduce the finding against the artifact — it is downgraded to
 *  advisory rather than allowed to block. */
export type FindingVerdict = {
  /** Index into the ReviewResult.issues array this verdict is for. */
  index: number;
  verified: boolean;
  rationale: string;
};

/** Note appended to a downgraded finding so the reason stays in the review trail. */
export const UNVERIFIED_FINDING_NOTE =
  "[advisory — an independent verifier could not reproduce this finding; not blocking]";

const CRITICAL: ReviewIssue["severity"] = "critical";

/** Recompute the pass/fail decision from the surviving severities — a gate fails
 *  iff a *critical* remains. Identical rule to build-reviewers' downgrade path. */
function decisionFromIssues(issues: ReviewResult["issues"]): "pass" | "fail" {
  return issues.some((i) => i.severity === "critical") ? "fail" : "pass";
}

/**
 * PURE. Apply verifier verdicts to a review: every *critical* finding whose
 * verdict is `verified === false` is downgraded to a non-blocking `minor` with
 * `UNVERIFIED_FINDING_NOTE` appended; verified criticals are untouched; then the
 * decision is recomputed. A critical with NO verdict (verifier didn't run for
 * it, e.g. dispatch error) is left as-is — fail-closed: an unverified verifier
 * never weakens a real blocker. Side-effect-free; safe to unit test directly.
 */
export function applyFindingVerdicts(
  review: ReviewResult,
  verdicts: readonly FindingVerdict[],
): ReviewResult {
  if (verdicts.length === 0) return review;
  const refutedIdx = new Set(
    verdicts.filter((v) => v.verified === false).map((v) => v.index),
  );
  if (refutedIdx.size === 0) return review;

  let changed = false;
  const issues = review.issues.map((issue, i) => {
    if (issue.severity === CRITICAL && refutedIdx.has(i)) {
      changed = true;
      return {
        ...issue,
        severity: "minor" as const,
        description: `${issue.description} ${UNVERIFIED_FINDING_NOTE}`,
      };
    }
    return issue;
  });
  if (!changed) return review;
  return { ...review, issues, decision: decisionFromIssues(issues) };
}

/** Build the adversarial verifier prompt for a single finding. The verifier
 *  gets a FRESH context (no reviewer transcript) and is told to default to
 *  refuted — the burden of proof is on the finding, which is what keeps a
 *  plausible-but-wrong critical from triggering a wasted rework round. */
export function buildFindingVerifierPrompt(
  finding: ReviewIssue,
  artifact: VerifiedFindingArtifact,
): string {
  const loc = finding.location ? `\nClaimed location: ${finding.location}` : "";
  const normalized = normalizeArtifact(artifact);
  return `You are an INDEPENDENT verifier. A reviewer flagged the finding below as CRITICAL (blocking). Your job is to try to REFUTE it against the actual artifact — not to agree with it.

FINDING (severity: ${finding.severity}): ${finding.description}${loc}

${normalized.label} UNDER REVIEW:
${normalized.content}

Decide whether this finding is REAL and BLOCKING — i.e. you can concretely reproduce it in the artifact above (point to the exact place and explain the concrete failure it causes). If you cannot concretely reproduce it, or it is vague/speculative/stylistic, it is NOT verified. Default to NOT verified when uncertain — the burden of proof is on the finding.

Respond with ONLY this JSON: {"verified": true|false, "rationale": "<one sentence>"}`;
}

/** Parse a verifier response. Fail-closed the SAFE way for a verifier: an
 *  unparseable/empty verifier response means "could not refute" → treat as
 *  verified (leave the critical blocking), never silently clear a real finding. */
export function parseVerifierResponse(raw: string): { verified: boolean; rationale: string } {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no json");
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    return {
      verified: parsed.verified === false ? false : true,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch {
    return { verified: true, rationale: "verifier response unparseable — finding left blocking (fail-closed)" };
  }
}

export type VerifyFindingsDeps = {
  /** Dispatch one verifier turn. Injected so the module is inference-free in
   *  tests. Returns the raw verifier text; the caller closes over routed
   *  inference (a cheap fresh-context call, no reviewer history). */
  dispatch: (prompt: string) => Promise<string>;
  /** Cap on how many criticals to verify in one review (cost guard). Default 6. */
  maxFindings?: number;
};

/**
 * Verify the blocking (critical) findings of a merged review and return the
 * adjusted review plus the per-finding verdict trail. Only runs when the review
 * currently FAILS on at least one critical — a passing review has nothing to
 * verify. Each verifier runs concurrently in its own fresh context. A dispatch
 * error for a given finding yields NO verdict for it (left blocking, fail-closed).
 */
export async function verifyReviewFindings(
  review: ReviewResult,
  artifact: VerifiedFindingArtifact,
  deps: VerifyFindingsDeps,
): Promise<{ review: ReviewResult; verdicts: FindingVerdict[] }> {
  const criticalIdx = review.issues
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue }) => issue.severity === CRITICAL);
  if (criticalIdx.length === 0) return { review, verdicts: [] };

  const cap = deps.maxFindings ?? 6;
  const toVerify = criticalIdx.slice(0, cap);

  const settled = await Promise.allSettled(
    toVerify.map(async ({ issue, index }) => {
      const raw = await deps.dispatch(buildFindingVerifierPrompt(issue, artifact));
      const parsed = parseVerifierResponse(raw);
      return { index, verified: parsed.verified, rationale: parsed.rationale } satisfies FindingVerdict;
    }),
  );

  const verdicts: FindingVerdict[] = [];
  settled.forEach((r) => {
    if (r.status === "fulfilled") verdicts.push(r.value);
    // rejected → no verdict for that finding → it stays blocking (fail-closed).
  });

  return { review: applyFindingVerdicts(review, verdicts), verdicts };
}

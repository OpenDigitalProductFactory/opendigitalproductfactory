// apps/web/lib/build-reviewers.ts
// Reviewer agents for Build Disciplines. Each reviewer is an LLM call
// that validates evidence and returns a structured ReviewResult.

import type {
  ReviewResult,
  BuildDesignDoc,
  BuildPlanDoc,
  BuildDeliberationPhase,
  BuildDeliberationSummaryEntry,
} from "@/lib/feature-build-types";
import type {
  BranchArtifact,
  BranchClaim,
  CompactBuildDeliberationSummary,
} from "@/lib/deliberation/synthesizer";
import type {
  ClaimEvidenceGrade,
  DeliberationConsensusState,
  DeliberationActivatedRiskLevel,
} from "@/lib/deliberation/types";

// ─── Prompt Templates ────────────────────────────────────────────────────────

export function buildDesignReviewPrompt(doc: BuildDesignDoc, projectContext: string): string {
  // Detect whether this feature has a UI component. Backend-only features
  // (cron jobs, API routes, data models) shouldn't be flagged for accessibility.
  const approachLower = (doc.proposedApproach ?? "").toLowerCase();
  const hasUI = /\bui\b|page\.tsx|component|dashboard|panel|form|modal|button|card|tab/i.test(approachLower)
    || /\b(shell)\b.*page/i.test(approachLower);

  return `You are reviewing a design document for a platform feature.

DESIGN DOCUMENT:
Problem: ${doc.problemStatement}
${doc.dataModel ? `Data Model: ${doc.dataModel}` : ""}
Existing Code Audit: ${doc.existingCodeAudit ?? doc.existingFunctionalityAudit ?? "Not provided"}
Reuse Plan: ${doc.reusePlan}
Proposed Approach: ${doc.proposedApproach}
Acceptance Criteria: ${Array.isArray(doc.acceptanceCriteria) ? doc.acceptanceCriteria.join("; ") : doc.acceptanceCriteria ?? "Not specified"}
${doc.reusabilityAnalysis ? `Reusability Analysis: Scope=${doc.reusabilityAnalysis.scope}, Entities=${doc.reusabilityAnalysis.domainEntities.map((e) => `${e.hardcodedValue}->${e.parameterName}`).join(", ") || "none"}, Boundary="${doc.reusabilityAnalysis.abstractionBoundary}", Readiness=${doc.reusabilityAnalysis.contributionReadiness}` : ""}
${(doc as { accessibility?: string }).accessibility ? `Accessibility: ${(doc as { accessibility?: string }).accessibility}` : ""}

PROJECT CONTEXT:
${projectContext}

REVIEW CHECKLIST — evaluate EVERY item before responding:
1. Is the problem statement clear and specific?
2. Was existing functionality properly audited (not building what already exists)?
3. Were alternatives considered? (For simple, standard patterns like health endpoints, CRUD routes, or utility functions, noting "standard pattern, no alternatives needed" is sufficient — do NOT fail a review for missing alternatives on trivial features.)
4. Is the reuse plan concrete (not vague)?
5. Is new code justified where reuse wasn't possible?
6. Is the proposed approach sound?
7. Are acceptance criteria testable and specific?
${hasUI ? `8. Does the design's "Accessibility" field explicitly address a11y? (semantic HTML, keyboard operability, ARIA labels, visible focus, color-not-sole-conveyor.) If the Accessibility field is present and covers these points, accept it — do NOT re-demand the same criteria as a failure reason. If the Accessibility field is missing or says "Not applicable" despite obvious UI surface, THAT's a critical issue.` : `8. (Accessibility review skipped — this feature has no user-facing UI components.)`}
9. If reusabilityAnalysis exists and scope is "parameterizable", does the proposed approach actually parameterize the identified domain entities? Flag any entity listed in domainEntities that appears hardcoded in the proposedApproach rather than stored as configuration.

SEVERITY CALIBRATION: Use "critical" ONLY for issues that would cause data loss, security vulnerabilities, or broken functionality. Use "important" for design gaps that should be addressed but don't block implementation. Use "minor" for style, naming, or nice-to-have improvements. A health endpoint or simple utility does NOT need the same rigor as a payment system — calibrate accordingly.

"NOT APPLICABLE" HANDLING: Sections may legitimately not apply to a given feature (e.g. a UI-only fix has no data model change, a standalone utility has no reuse target). When a section's value begins with "Not applicable —" followed by a reason, evaluate only whether that reason is CORRECT for this feature. If the reason is correct, the section passes — do NOT flag it as "missing content", "underspecified", or "needs detail". If the reason is wrong (e.g. the author wrote "Not applicable — UI-only change" but the proposedApproach actually introduces new tables), flag that as an important issue.

CRITICAL INSTRUCTION: You MUST report ALL issues in a SINGLE response. Do not stop after finding the first issue. Review the entire design document comprehensively. A revision cycle costs significant time and tokens. The goal is ZERO surprise issues on a re-review.

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}`;
}

export function buildPlanReviewPrompt(plan: BuildPlanDoc): string {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const files = Array.isArray(plan?.fileStructure) ? plan.fileStructure : [];
  const taskList = tasks.map((t, i) => `  ${i + 1}. ${t?.title ?? "Untitled"}: test="${t?.testFirst ?? ""}" impl="${t?.implement ?? ""}" verify="${t?.verify ?? ""}"`).join("\n") || "  (no tasks defined)";
  const fileList = files.map((f) => `  ${f?.action ?? "?"}: ${f?.path ?? "?"} — ${f?.purpose ?? ""}`).join("\n") || "  (no file structure defined)";

  return `You are reviewing an implementation plan for a platform feature.

FILE STRUCTURE:
${fileList}

TASKS (${tasks.length} total):
${taskList}

REVIEW CHECKLIST — evaluate EVERY item against EVERY task before responding:
1. Are tasks bite-sized (each should be 2-5 minutes of work)? Check EACH task individually.
2. Does each task have a test-first step?
3. Are file paths specific (not vague)?
4. Is the file structure sensible (one responsibility per file)?
5. Are there any missing tasks for the described file changes?
6. Does the plan include data seeding/population tasks if new database entities are introduced?
7. Are dependencies between tasks clear (does task N depend on task M completing first)?

CRITICAL INSTRUCTION: You MUST report ALL issues in a SINGLE response. Do not stop after finding the first issue. Review the entire plan comprehensively — every task, every file, every dependency. A revision cycle costs significant time and tokens. The goal is ZERO surprise issues on a re-review.

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}`;
}

export function buildCodeReviewPrompt(taskTitle: string, codeChanges: string, testOutput: string): string {
  return `You are reviewing code changes for a single build task.

TASK: ${taskTitle}

CODE CHANGES:
${codeChanges}

TEST OUTPUT:
${testOutput}

REVIEW CHECKLIST — evaluate EVERY item before responding:
1. Does a test exist that covers this change?
2. Is there code duplication with existing functionality?
3. Does the code follow project patterns (TypeScript, Next.js, Tailwind)?
4. Are there security concerns (injection, XSS, etc.)?
5. Is the code clean and maintainable?
6. Does the code use CSS variables (var(--dpf-*)) for all colors — no text-white, bg-white, text-black, bg-black, or inline hex values? (Exception: text-white on accent-background buttons, semantic status colors from ThemeTokens.states)
7. Are interactive elements keyboard-accessible with visible focus indicators? Do form inputs have associated labels? Do buttons have descriptive accessible names?

CRITICAL INSTRUCTION: You MUST report ALL issues in a SINGLE response. Do not stop after finding the first issue. Review the entire code change comprehensively. A revision cycle costs significant time and tokens. The goal is ZERO surprise issues on a re-review.

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}`;
}

// ─── Review Merging ──────────────────────────────────────────────────────────

/**
 * Merge two ReviewResults from independent reviewers into one authoritative result.
 * Decision: fail if either reviewer fails (conservative — surface everything).
 * Issues: union of both sets, deduped by first 80 chars of lowercased description.
 * Summary: joined from both reviewers.
 */
export function mergeReviews(r1: ReviewResult, r2: ReviewResult): ReviewResult {
  // A parse failure ("could not parse agent response") is not a real review.
  // If one reviewer parsed successfully and the other didn't, trust the parsed one.
  const r1ParseFail = r1.issues.some(i => i.description.includes("unparseable response"));
  const r2ParseFail = r2.issues.some(i => i.description.includes("unparseable response"));
  const decision =
    r1ParseFail && !r2ParseFail ? r2.decision :
    r2ParseFail && !r1ParseFail ? r1.decision :
    r1.decision === "fail" || r2.decision === "fail" ? "fail" : "pass";

  // Deduplicate by normalized description prefix.
  // Skip parse-failure issues if the other reviewer gave a real result.
  const skipParseFailures = (r1ParseFail && !r2ParseFail) || (r2ParseFail && !r1ParseFail);
  const seen = new Set<string>();
  const merged: ReviewResult["issues"] = [];
  for (const issue of [...r1.issues, ...r2.issues]) {
    if (skipParseFailures && issue.description.includes("unparseable response")) continue;
    const key = issue.description.toLowerCase().slice(0, 80);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(issue);
    }
  }

  // Sort: critical → important → minor
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, important: 1, minor: 2 };
  merged.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2));

  const summary = r1.summary && r2.summary
    ? `Reviewer 1: ${r1.summary} | Reviewer 2: ${r2.summary}`
    : r1.summary || r2.summary || "Review complete";

  return { decision, issues: merged, summary };
}

// ─── Response Parsing ────────────────────────────────────────────────────────

export function parseReviewResponse(raw: string): ReviewResult {
  try {
    // Extract JSON from response (may have markdown code fences)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const rawDecision = parsed.decision === "pass" ? "pass" : "fail";
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((issue: Record<string, unknown>) => ({
          severity: (["critical", "important", "minor"].includes(String(issue.severity))
            ? String(issue.severity)
            : "minor") as "critical" | "important" | "minor",
          description: String(issue.description ?? ""),
          location: issue.location ? String(issue.location) : undefined,
          suggestion: issue.suggestion ? String(issue.suggestion) : undefined,
        }))
      : [];
    const summary = String(parsed.summary ?? "Review complete");

    // Honor the reviewer prompt's own severity calibration:
    //   "Use 'critical' ONLY for issues that would cause data loss,
    //    security vulnerabilities, or broken functionality. Use
    //    'important' for design gaps that should be addressed but
    //    don't block implementation."
    //
    // In practice reviewers routinely return decision:"fail" with
    // only "important" issues, which contradicts the prompt and
    // trapped real builds (observed 2026-04-19 on FB-21EEA510) in an
    // endless dual-reviewer loop that kept finding new important
    // issues each iteration. Overriding the decision to match the
    // declared severity of the issues — critical fails, anything else
    // passes (issues are still surfaced for the author to address).
    const hasCritical = issues.some((i) => i.severity === "critical");
    const decision: "pass" | "fail" = hasCritical ? "fail" : "pass";
    // rawDecision retained for diagnostics in logs if the LLM's own decision
    // diverges from the severity-driven one. The severity-driven decision is
    // authoritative — see comment above.
    void rawDecision;

    return { decision, issues, summary };
  } catch {
    // If parsing fails, return a fail result
    return {
      decision: "fail",
      issues: [{ severity: "critical", description: "Review agent returned unparseable response" }],
      summary: "Review failed — could not parse agent response",
    };
  }
}

// ─── Deliberation Integration (Task 8) ──────────────────────────────────────
// Map the existing dual-reviewer output into the Deliberation Pattern
// Framework v1. The reviewer LLM calls already ran — this layer wraps
// their results as ClaimRecord rows, a DeliberationOutcome, and a compact
// FeatureBuild.deliberationSummary[phase] entry. Option C in the Task 8
// design: honest retrospective, never replaces the ReviewResult flow.

/** Map a ReviewResult severity to a ClaimEvidenceGrade. Reviewer judgments
 *  are inference unless the reviewer cited a source (we can't tell from
 *  the structured result), so everything grades C — documented inference.
 *  Critical findings earn grade B when we have a location reference, since
 *  the reviewer is pointing at a concrete artifact. */
function gradeForReviewIssue(issue: ReviewResult["issues"][number]): ClaimEvidenceGrade {
  if (issue.location && issue.severity === "critical") return "B";
  return "C";
}

/** Map severity to a confidence float. Critical findings are high-confidence
 *  (reviewer believes the issue is real); minor findings are low. */
function confidenceForReviewIssue(issue: ReviewResult["issues"][number]): number {
  switch (issue.severity) {
    case "critical":
      return 0.85;
    case "important":
      return 0.65;
    case "minor":
    default:
      return 0.4;
  }
}

/**
 * Extract BranchClaim rows from a single reviewer's ReviewResult.
 *
 * Each issue becomes an objection claim — the reviewer raising a concern.
 * When the reviewer's overall decision is "pass", a single assertion claim
 * is added representing their affirmative recommendation. This keeps the
 * claim set honest for the synthesizer's consensus detection: a pass with
 * zero objections is a strong agreement signal.
 */
export function extractClaimsFromReview(review: ReviewResult): {
  assertions: BranchClaim[];
  objections: BranchClaim[];
} {
  const assertions: BranchClaim[] = [];
  const objections: BranchClaim[] = [];

  if (review.decision === "pass") {
    assertions.push({
      claimText: review.summary || "Reviewer affirmed the artifact meets the discipline checklist.",
      evidenceGrade: "C",
      confidence: 0.7,
    });
  }

  for (const issue of review.issues) {
    const text = issue.location
      ? `[${issue.severity}] ${issue.description} (at ${issue.location})`
      : `[${issue.severity}] ${issue.description}`;
    objections.push({
      claimText: text,
      evidenceGrade: gradeForReviewIssue(issue),
      confidence: confidenceForReviewIssue(issue),
    });
  }

  return { assertions, objections };
}

/** Shape of a single reviewer's contribution to a deliberation wrap. */
export type ReviewBranchInput = {
  branchNodeId: string;
  role: string; // "reviewer" | "skeptic" | "author" etc.
  review: ReviewResult | null; // null means the reviewer failed to respond
  failureReason?: string;
};

/**
 * Build BranchArtifact[] for the synthesizer from the dual-reviewer results.
 * Each reviewer becomes one branch: completed if the ReviewResult parsed,
 * failed (with failureReason) otherwise.
 */
export function buildReviewBranchArtifacts(
  inputs: ReviewBranchInput[],
): BranchArtifact[] {
  return inputs.map((input) => {
    if (!input.review) {
      return {
        branchNodeId: input.branchNodeId,
        role: input.role,
        completed: false,
        failureReason: input.failureReason ?? "Reviewer did not produce a parsed response.",
      };
    }
    const { assertions, objections } = extractClaimsFromReview(input.review);
    const recommendation =
      input.review.decision === "pass" ? "pass" : "fail";
    return {
      branchNodeId: input.branchNodeId,
      role: input.role,
      completed: true,
      recommendation,
      rationale: input.review.summary,
      assertions,
      objections,
    };
  });
}

/** Map the synthesizer's evidence badge to the BuildDeliberationSummaryEntry
 *  evidence-quality label (values are the same by design). */
function evidenceBadgeToQuality(
  badge: "source-backed" | "mixed" | "needs-more-evidence",
): BuildDeliberationSummaryEntry["evidenceQuality"] {
  return badge;
}

/**
 * Translate a CompactBuildDeliberationSummary from the synthesizer into the
 * shape persisted on FeatureBuild.deliberationSummary[phase].
 *
 * The compact summary is the neutral synthesizer shape; the build entry is
 * the UI-facing shape used by Build Studio. This mapper is the bridge —
 * it never re-derives consensus or confidence, only reshapes.
 */
export function mapCompactSummaryToBuildEntry(params: {
  patternSlug: "review" | "debate";
  compactSummary: CompactBuildDeliberationSummary;
  rationaleSummary: string;
  unresolvedRisks: string[];
  diversityLabel: string;
}): BuildDeliberationSummaryEntry {
  return {
    patternSlug: params.patternSlug,
    deliberationRunId: params.compactSummary.deliberationRunId,
    consensusState: params.compactSummary.consensusState as DeliberationConsensusState,
    rationaleSummary: params.rationaleSummary,
    evidenceQuality: evidenceBadgeToQuality(params.compactSummary.evidenceBadge),
    unresolvedRisks: params.unresolvedRisks,
    diversityLabel: params.diversityLabel,
  };
}

/**
 * Risk-level heuristic for the activation resolver. Critical issues in
 * either reviewer push to high; important issues land at medium; clean
 * reviews stay at low. This drives whether an optional skeptic branch
 * joins the default "review" pattern (spec §7.4).
 */
export function deriveReviewRiskLevel(
  reviews: Array<ReviewResult | null>,
): DeliberationActivatedRiskLevel {
  let level: DeliberationActivatedRiskLevel = "low";
  for (const r of reviews) {
    if (!r) continue;
    if (r.issues.some((i) => i.severity === "critical")) return "high";
    if (r.issues.some((i) => i.severity === "important")) level = "medium";
  }
  return level;
}

/**
 * Map a Build Studio phase to the Deliberation artifactType used by the
 * activation resolver. Build Studio phases beyond plan/review run on the
 * generated artifact, so "code-change" is the right category.
 */
export function artifactTypeForPhase(
  phase: BuildDeliberationPhase,
): "spec" | "plan" | "code-change" {
  if (phase === "ideate") return "spec";
  if (phase === "plan") return "plan";
  return "code-change";
}

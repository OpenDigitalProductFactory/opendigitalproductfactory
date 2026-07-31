// apps/web/lib/build-reviewers.ts
// Reviewer agents for Build Disciplines. Each reviewer is an LLM call
// that validates evidence and returns a structured ReviewResult.

import type {
  ReviewResult,
  ReviewerVerdict,
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
import { ENTERPRISE_ARCHITECT_DISPLAY_NAME } from "@dpf/db/agent-identity";
import {
  buildSemanticChangeReviewPrompt,
  parseSemanticReviewResponse,
} from "@/lib/change-review/semantic-change-review";

// ─── Prompt Templates ────────────────────────────────────────────────────────

export function buildDesignReviewPrompt(
  doc: BuildDesignDoc,
  projectContext: string,
  prior?: ReviewPriorContext | null,
): string {
  // Detect whether this feature has a UI component. Backend-only features
  // (cron jobs, API routes, data models) shouldn't be flagged for accessibility.
  const approachLower = (doc.proposedApproach ?? "").toLowerCase();
  const hasUI = /\bui\b|page\.tsx|component|dashboard|panel|form|modal|button|card|tab/i.test(approachLower)
    || /\b(shell)\b.*page/i.test(approachLower);

  // BI-CE49D82E — Delta-aware design review prompt, mirror of the plan path
  // added in BI-4396EFEC (D38). Live repro: FB-5E20E793 (Voice Slice 1.6)
  // looped on the same "missing accessibility section" complaint round after
  // round because the reviewer re-evaluated from scratch each call. With the
  // prior issues injected, round 2+ judges resolution instead of re-litigating.
  const priorSection = prior && prior.issues.length > 0
    ? `\n\nPRIOR REVIEW CONTEXT (this is review round ${prior.round + 1}):\nThe immediately-prior review of this design surfaced these ${prior.issues.length} issues:\n${prior.issues.map((i, idx) => `  ${idx + 1}. [${i.severity}] ${i.description}`).join("\n")}\n\nDelta-aware review protocol:\n- For each prior issue, judge whether the new design addresses it. If yes, do NOT re-surface it.\n- If a prior issue is still present, re-surface it but reuse the SAME description so the operator sees persistence.\n- Only add NEW issues that this revision genuinely introduces or that the prior round missed.\n- Goal: convergence, not re-litigation. Avoid trading one set of issues for another.\n`
    : "";

  // BI-699EA362 — null-guard the reusabilityAnalysis section. designDoc comes
  // from a loosely-typed JSON column, so reusabilityAnalysis can be a string or
  // an object missing its domainEntities array (an operator-saved, migrated, or
  // partial doc). Mapping domainEntities unguarded threw "Cannot read properties
  // of undefined (reading 'map')"; executeTool swallowed it, so reviewDesignDoc
  // persisted no verdict and the build wedged in ideate with a watchdog stall.
  // The value is read from a JSON column (`build.designDoc as unknown as
  // BuildDesignDoc`), so its real runtime shape is unknown — model that here so
  // every guard below is genuinely load-bearing rather than `unknown`-narrowed.
  const ra = doc.reusabilityAnalysis as unknown as
    | {
        scope?: string;
        domainEntities?: ReadonlyArray<{ hardcodedValue?: string; parameterName?: string }>;
        abstractionBoundary?: string;
        contributionReadiness?: string;
      }
    | string
    | null
    | undefined;
  const reusabilitySection =
    ra && typeof ra === "object"
      ? `Reusability Analysis: Scope=${ra.scope ?? "?"}, Entities=${
          (Array.isArray(ra.domainEntities) ? ra.domainEntities : [])
            .map((e) => `${e.hardcodedValue ?? "?"}->${e.parameterName ?? "?"}`)
            .join(", ") || "none"
        }, Boundary="${ra.abstractionBoundary ?? ""}", Readiness=${ra.contributionReadiness ?? "?"}`
      : "";

  return `You are reviewing a design document for a platform feature.

DESIGN DOCUMENT:
Problem: ${doc.problemStatement ?? "Not provided"}
${doc.dataModel ? `Data Model: ${doc.dataModel}` : ""}
Existing Code Audit: ${doc.existingCodeAudit ?? doc.existingFunctionalityAudit ?? "Not provided"}
Reuse Plan: ${doc.reusePlan ?? "Not provided"}
Proposed Approach: ${doc.proposedApproach ?? "Not provided"}
Acceptance Criteria: ${Array.isArray(doc.acceptanceCriteria) ? doc.acceptanceCriteria.join("; ") : (doc.acceptanceCriteria ?? "Not specified")}
${reusabilitySection}
${(doc as { accessibility?: string }).accessibility ? `Accessibility: ${(doc as { accessibility?: string }).accessibility}` : ""}

PROJECT CONTEXT:
${projectContext}${priorSection}

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
10. WHOLE-OUTCOME ALIGNMENT (per the "Optimize for the Whole" commandment): does the design name the end-to-end outcome — the user objective or value stream — it serves, and is the proposed approach the right thing for that whole, not a local optimization that advances one step at the whole's expense? A small or local change can state its served outcome briefly. Reserve "critical" only for a design that demonstrably degrades the broader objective in order to win locally; use "important" when the served outcome is simply unstated or only weakly connected to the approach.

SEVERITY CALIBRATION: Use "critical" ONLY for issues that would cause data loss, security vulnerabilities, or broken functionality. Use "important" for design gaps that should be addressed but don't block implementation. Use "minor" for style, naming, or nice-to-have improvements. A health endpoint or simple utility does NOT need the same rigor as a payment system — calibrate accordingly.

"NOT APPLICABLE" HANDLING: Sections may legitimately not apply to a given feature (e.g. a UI-only fix has no data model change, a standalone utility has no reuse target). When a section's value begins with "Not applicable —" followed by a reason, evaluate only whether that reason is CORRECT for this feature. If the reason is correct, the section passes — do NOT flag it as "missing content", "underspecified", or "needs detail". If the reason is wrong (e.g. the author wrote "Not applicable — UI-only change" but the proposedApproach actually introduces new tables), flag that as an important issue.

DECISION DISCIPLINE: report the genuine BLOCKING issues in a single response — be comprehensive about real blockers so there are no surprises on re-review, but do NOT pad the list with nice-to-haves. Reserve "critical" for issues that would cause data loss, security holes, or broken functionality; "important"/"minor" do not block. If the design meets the checklist at a level appropriate to its scope, return "pass". A short, converging review beats an exhaustive one.

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}`;
}

/** Optional prior-round context passed to design / plan review on iterations 2+.
 *  Lets the reviewer judge which prior issues the new artifact addresses, so
 *  the operator sees converging trajectory instead of issue-set churn.
 *  BI-4396EFEC (D38) introduced this for plan review; BI-CE49D82E generalized
 *  the type so design review uses the same shape. */
export type ReviewPriorContext = {
  round: number;
  issues: ReadonlyArray<{ severity: string; description: string }>;
};

export function buildPlanReviewPrompt(
  plan: BuildPlanDoc,
  prior?: ReviewPriorContext | null,
): string {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const files = Array.isArray(plan?.fileStructure) ? plan.fileStructure : [];
  const taskList = tasks.map((t, i) => `  ${i + 1}. ${t?.title ?? "Untitled"}: test="${t?.testFirst ?? ""}" impl="${t?.implement ?? ""}" verify="${t?.verify ?? ""}"`).join("\n") || "  (no tasks defined)";
  const fileList = files.map((f) => `  ${f?.action ?? "?"}: ${f?.path ?? "?"} — ${f?.purpose ?? ""}`).join("\n") || "  (no file structure defined)";

  // BI-4396EFEC (D38) — Delta-aware review prompt. When prior issues exist,
  // tell the reviewer to judge resolution rather than re-evaluate from
  // scratch. The goal is convergence: the reviewer's job on iteration N>1
  // is to (a) honor genuinely-addressed prior findings, (b) re-surface
  // anything still present using the SAME description so the operator sees
  // persistence, (c) flag only NEW issues the prior round didn't catch.
  const priorSection = prior && prior.issues.length > 0
    ? `\n\nPRIOR REVIEW CONTEXT (this is review round ${prior.round + 1}):\nThe immediately-prior review of this plan surfaced these ${prior.issues.length} issues:\n${prior.issues.map((i, idx) => `  ${idx + 1}. [${i.severity}] ${i.description}`).join("\n")}\n\nDelta-aware review protocol (CONVERGENCE-ENFORCING — the issue set must shrink each round, never trade one set for another):\n- For each prior issue, judge whether the new plan addresses it. If yes, do NOT re-surface it.\n- If a prior issue is still present, re-surface it with the SAME description.\n- Do NOT introduce NEW important/minor issues on a re-review. The bar was set in round 1; later rounds VERIFY that bar is met — they do not raise it. (Surfacing fresh nit-level findings each round is the oscillation this protocol exists to stop.)\n- The ONLY new issue you may add on a re-review is a genuine CRITICAL regression THIS revision introduced (e.g. it deleted an error guard). Name exactly what changed.\n- DECISION on a re-review: return "pass" as soon as no CRITICAL issues remain — even if important/minor issues are still open. Those are caught downstream at the build + code-review gates; they must not block plan convergence here. This guarantees the loop converges instead of trading 4 issues for 8.\n`
    : "";

  return `You are reviewing an implementation plan for a platform feature.

FILE STRUCTURE:
${fileList}

TASKS (${tasks.length} total):
${taskList}${priorSection}

REVIEW CHECKLIST — judge the plan against THIS list and ONLY this list. It is the SAME standard the planner was given, so a plan that meets it MUST pass. Do not invent requirements beyond these, and do not escalate the bar across review rounds:
1. REAL TEST-FIRST: does every task that adds/changes LOGIC (server action, API route handler, data transform, permission/auth check) name a real failing test to write first — a unit test for action/transform logic (incl. error + permission cases), an integration test for an API route (unauth, unauthorized, invalid input, success + status codes)? \`tsc --noEmit\` / "validate types" / "manual: read X" are NOT tests for a logic task (schema-only tasks may use validate_schema; pure presentational tasks may use a component/interaction test). DOCUMENTATION-ONLY changes — adding/editing a comment, JSDoc/docstring, README, or other prose that changes NO executable behavior — are NOT logic changes: they require NO test-first step, and the absence of a test is NEVER a critical (or blocking) issue for such a task. Accept a content/presence check (or no test at all) for a comment/doc task and PASS it.
2. BITE-SIZED: is each task ~2-5 min / one responsibility? Flag a task ONLY if it clearly bundles >~5 distinct sub-steps.
3. ERROR PATHS: does each logic task state failure handling, not just the happy path?
4. DEPENDENCIES + PATHS: are task ordering dependencies stated and file paths specific?
5. COMPLETENESS: any file with no task, or any task missing for the described changes (incl. data seeding if new entities are introduced)?

SIZE-AWARENESS (prevents over-strict oscillation): scale expectations to the change. A one-file presentational tweak needs ONE small interaction test, not a full suite; a feature touching server action + API + UI needs a test for each of those surfaces. Do NOT demand integration/E2E ceremony a small change doesn't warrant.

DECISION DISCIPLINE: reserve "critical" for a genuine blocking gap (a logic change with NO real test, a clearly oversized task, a missing error path on a risky action). Use "important"/"minor" for everything else — they do NOT block. If the plan meets the checklist at a level appropriate to its scope, return "pass" even if more tests could theoretically be added. Report the genuine blocking issues concisely — do NOT pad the list to be exhaustive; a short, converging review beats a long one.

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}`;
}

export function buildCodeReviewPrompt(taskTitle: string, codeChanges: string, testOutput: string): string {
  return buildSemanticChangeReviewPrompt({
    title: taskTitle,
    artifact: codeChanges,
    verificationEvidence: testOutput,
    promptProfile: "build-studio-v1",
  });
}

// ─── Architecture Alignment Review (advisory) ────────────────────────────────
// The chief-architect lens, attributed to the Enterprise Architect persona
// (AGT-WS-EA). It reviews the design doc (Ideate gate) and the implementation
// plan (Plan gate) for architectural ALIGNMENT against DPF's canonical
// standards — never re-running the checklist reviewers, never gating pass/fail.
// Findings join the deliberation trail as the `architect` branch and surface
// back to the build coworker so it can fold them into the spec.

/** The reference standards the architecture reviewer measures a spec against.
 *  Single source of truth for "what we research/check first" — kept here so the
 *  in-portal reviewer prompt and the external dpf-architecture-review skill
 *  stay aligned. Paths are repo-relative. */
export const ARCHITECTURE_REVIEW_REFERENCES: ReadonlyArray<{
  label: string;
  path: string;
  covers: string;
}> = [
  {
    label: "Agent rulebook",
    path: "AGENTS.md",
    covers:
      "project architecture, canonical contracts, strongly-typed enums, data-model stewardship, deployment doctrine",
  },
  {
    label: "Kernel principles",
    path: "docs/founder-kernel/wiki/principles/",
    covers:
      "optimize-for-the-whole, architecture-over-shortcuts, single-source-of-truth, schema-audit-before-features, organization-canonical-identity, principal-convergence",
  },
  {
    label: "Platform usability standards",
    path: "docs/platform-usability-standards.md",
    covers: "theme-aware styling, progressive disclosure, wizard-first setup",
  },
  {
    label: "Deployment contracts",
    path: "docs/superpowers/specs/2026-05-09-deployment-contracts.md",
    covers: "the canonical deployment contracts every substrate must wrap",
  },
  {
    label: "Archetype value streams",
    path: "docs/architecture/archetype-business-value-streams.md",
    covers:
      "per-archetype operational value streams + load-bearing stages — the whole outcome each archetype design must serve; stage names stay stable across portal rebuilds, so this is the rebuild-surviving measure of whole-vs-local for storefront/archetype work",
  },
];

function formatArchitectureReferences(): string {
  return ARCHITECTURE_REVIEW_REFERENCES.map(
    (ref) => `- ${ref.label} (${ref.path}) — ${ref.covers}`,
  ).join("\n");
}

export type ArchitectureReviewInput =
  | { kind: "design"; doc: BuildDesignDoc }
  | { kind: "plan"; plan: BuildPlanDoc };

function describeArchitectureArtifact(input: ArchitectureReviewInput): string {
  if (input.kind === "design") {
    const doc = input.doc;
    const acceptance = Array.isArray(doc.acceptanceCriteria)
      ? doc.acceptanceCriteria.join("; ")
      : (doc.acceptanceCriteria ?? "Not specified");
    return [
      `Problem: ${doc.problemStatement ?? "Not provided"}`,
      doc.dataModel ? `Data Model: ${doc.dataModel}` : "",
      `Existing Code Audit: ${doc.existingCodeAudit ?? doc.existingFunctionalityAudit ?? "Not provided"}`,
      `Reuse Plan: ${doc.reusePlan ?? "Not provided"}`,
      `Proposed Approach: ${doc.proposedApproach ?? "Not provided"}`,
      `Acceptance Criteria: ${acceptance}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const plan = input.plan;
  const files = Array.isArray(plan?.fileStructure) ? plan.fileStructure : [];
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const fileList =
    files.map((f) => `  ${f?.action ?? "?"}: ${f?.path ?? "?"} — ${f?.purpose ?? ""}`).join("\n") ||
    "  (no file structure defined)";
  const taskList =
    tasks.map((t, i) => `  ${i + 1}. ${t?.title ?? "Untitled"}: ${t?.implement ?? ""}`).join("\n") ||
    "  (no tasks defined)";
  return `FILE STRUCTURE:\n${fileList}\n\nTASKS:\n${taskList}`;
}

/**
 * Build the architecture-alignment reviewer prompt. The reviewer reads the
 * artifact against the DPF reference standards and returns the same
 * ReviewResult JSON shape the other reviewers use — but its decision is
 * ADVISORY and is dropped by the caller (it never enters mergeReviews).
 */
export function buildArchitectureReviewPrompt(
  input: ArchitectureReviewInput,
  projectContext: string,
): string {
  const artifactLabel = input.kind === "design" ? "design document" : "implementation plan";
  const focus =
    input.kind === "design"
      ? `- Does this serve the end-to-end outcome / value stream it belongs to, rather than locally optimizing one step at the whole's expense? The design should name the broader objective it advances (Optimize for the Whole).
- If the change touches an archetype/storefront surface, does it serve that archetype's LOAD-BEARING value-stream stage(s) (per docs/architecture/archetype-business-value-streams.md), not just a generic step? Strengthening a non-load-bearing stage while weakening the load-bearing one fails the whole — and those stage names stay stable across portal rebuilds, so they are the durable measure.
- Does the data model EXTEND canonical models (Organization for identity, Principal/PrincipalAlias for identity-bearing entities) rather than create parallel tables?
- Does the proposed approach respect single-source-of-truth (no rule/fact/decision duplicated)?
- Does it choose the architecturally sound shape over a shortcut that creates debt?
- Are string-enum columns aligned with the canonical enum registry (hyphens, not underscores)?
- Does it sit on the right substrate (existing route/lib/tool) instead of a bespoke parallel one?`
      : `- Does the file structure place each responsibility in its canonical home (schema in packages/db, routes under apps/web/app/api, etc.)?
- Does the plan EXTEND existing files where the domain already lives instead of duplicating them?
- Are migrations/backfills modeled per the deployment doctrine (inline backfill, immutable committed migrations)?
- Does the decomposition keep coupling intentional and blast radius contained?`;

  return `You are the ${ENTERPRISE_ARCHITECT_DISPLAY_NAME} performing an ADVISORY architectural-alignment review of a Build Studio ${artifactLabel}. You are the "chief architect" lens: you do NOT re-run the design/plan checklist (other reviewers own that) and you do NOT gate the build. Your job is to surface architectural alignment and concerns, and to propose concrete edits the author can fold into the spec.

${artifactLabel.toUpperCase()}:
${describeArchitectureArtifact(input)}

PROJECT CONTEXT:
${projectContext || "(none provided)"}

MEASURE THE SPEC AGAINST THESE DPF REFERENCE STANDARDS (research the topic further when the spec touches an area these do not cover):
${formatArchitectureReferences()}

ARCHITECTURAL FOCUS — evaluate each:
${focus}

SEVERITY (advisory weight, NOT a gate): "critical" = would entrench architectural debt or violate a commandment-tier principle (e.g. duplicates a canonical model, breaks single-source-of-truth); "important" = a misalignment worth fixing before building; "minor" = a nicety or stylistic alignment note. For EACH finding, put a concrete spec edit in the "suggestion" field.

REFERENCE-DOC FEEDBACK: if your research surfaces a standard the reference docs above do not yet capture and that would help future specs, add ONE issue with severity "minor" whose description begins with "[reference-doc]" naming the doc to update and the gap. This is how architectural learning flows back into the standards.

If the spec is well-aligned, return decision "pass" with an empty (or minor-only) issues list and say so in the summary. Report ALL findings in a single response.

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "...", "suggestion": "concrete spec edit"}],
  "summary": "one sentence architectural-alignment summary"
}`;
}

// ─── Per-reviewer verdicts ───────────────────────────────────────────────────

/** The three reviewers a dual-review run produces, in deliberation-branch order.
 *  Source ids match the branchNodeIds emitted to runBuildReviewDeliberation, so
 *  the persisted verdicts and the deliberation trail name reviewers identically.
 *  This is the COMPLETE roster — there is no security/accessibility/governance
 *  reviewer as a distinct agent; those are focus areas inside reviewer-2. */
const REVIEWER_VERDICT_META = [
  { source: "reviewer-1", label: "Primary review", role: "reviewer" },
  { source: "reviewer-2", label: "Independent review", role: "reviewer" },
  { source: "architect", label: "Architecture", role: "architect" },
] as const;

function countIssuesBySeverity(
  issues: ReviewResult["issues"],
): ReviewerVerdict["issueCounts"] {
  const counts = { critical: 0, important: 0, minor: 0 };
  for (const issue of issues) counts[issue.severity]++;
  return counts;
}

/**
 * Capture the individual reviewer verdicts BEFORE mergeReviews() collapses them,
 * so they can be nested on the persisted ReviewResult.reviewers for the UI.
 *
 * Inputs are the same r1 / r2 / archReview the deliberation trail consumes; a
 * null input means that reviewer did not respond and is simply omitted (it never
 * appears as a passing verdict). A parse-error review is preserved with its
 * parseError flag so the UI can show "unavailable" rather than a false pass.
 */
export function collectReviewerVerdicts(
  r1: ReviewResult | null,
  r2: ReviewResult | null,
  archReview: ReviewResult | null,
): ReviewerVerdict[] {
  const inputs = [r1, r2, archReview];
  const verdicts: ReviewerVerdict[] = [];
  REVIEWER_VERDICT_META.forEach((meta, i) => {
    const review = inputs[i];
    if (!review) return;
    verdicts.push({
      source: meta.source,
      label: meta.label,
      role: meta.role,
      decision: review.decision,
      issueCounts: countIssuesBySeverity(review.issues),
      ...(review.parseError ? { parseError: true } : {}),
    });
  });
  return verdicts;
}

// ─── Review Merging ──────────────────────────────────────────────────────────

/**
 * Merge two ReviewResults from independent reviewers into one authoritative result.
 * Decision: fail if either reviewer fails (conservative — surface everything).
 * Issues: union of both sets, deduped by first 80 chars of lowercased description.
 * Summary: joined from both reviewers.
 */
export function mergeReviews(r1: ReviewResult, r2: ReviewResult): ReviewResult {
  // A parse failure is not a real review — treat it as an absent reviewer.
  // Use the parseError flag first; fall back to text-matching for results
  // produced before the flag existed.
  const r1ParseFail = r1.parseError ?? r1.issues.some(i => i.description.includes("unparseable response"));
  const r2ParseFail = r2.parseError ?? r2.issues.some(i => i.description.includes("unparseable response"));
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

/** Build kinds for which a missing test-first step must not block the plan gate.
 *  Test-first is a feature-grade discipline; a chore, fix, or docs build changes
 *  little or no logic, so a "write a real failing test first" complaint is not a
 *  genuine blocker for it. */
const TEST_FIRST_LENIENT_KINDS: ReadonlySet<string> = new Set(["chore", "fix", "docs", "doc"]);

/** Matches a reviewer issue that complains about a missing/weak test-first step. */
const TEST_FIRST_ISSUE_RE = /test[\s-]?first|(?:failing|real|actual)\s+test|test for (?:logic|behavior)|write (?:a |the )?(?:real |failing )?test/i;

/** Also catch the test-first complaint by its ORDERING essence: a test that
 *  should exist BEFORE implementation. Reviewer phrasings vary widely ("an
 *  actual test that would verify X before the mapping is implemented", "a test
 *  case verifying Y before implementing that logic", "a test ... before such
 *  handling is coded") and the alternation above misses them — this cue does
 *  not. Together they make the chore/fix/docs lenience phrasing-robust instead
 *  of leaking criticals that are worded differently from the seen examples. */
const TEST_BEFORE_IMPL_RE = /\btest\b[^.]*\bbefore\b[^.]*(?:implement|cod(?:e|ed|ing)|mapping)/i;

/**
 * Deterministic kind-aware lenience for the plan-review gate.
 *
 * The plan-review rubric already scopes the test-first requirement to LOGIC
 * changes and exempts documentation-only work, but a reviewer model — notably a
 * small local model running the build on-host — over-applies TDD and marks a
 * comment/chore task "critical" for lacking a test, wedging the gate across
 * rounds. Rather than depend on the model honoring the prose exemption, enforce
 * it in code: for a chore/fix/docs build, downgrade any test-first critical to
 * minor (non-blocking) and recompute the severity-driven decision. Genuine
 * blockers (missing files, broken logic, oversized tasks) are untouched.
 *
 * Pure + side-effect-free so it is trivially unit-testable.
 */
export function applyTestFirstLenienceForKind(
  review: ReviewResult,
  kind: string | null | undefined,
): ReviewResult {
  if (!kind || !TEST_FIRST_LENIENT_KINDS.has(kind)) return review;
  return downgradeTestFirstCriticals(
    review,
    `[non-blocking for a ${kind} build — test-first is a feature-grade gate]`,
  );
}

/**
 * Core downgrade: turn every test-first *critical* into a non-blocking *minor*
 * and recompute the severity-driven decision. `note` is appended to each
 * downgraded issue so the reason stays visible in the review trail. Genuine
 * blockers (missing files, broken logic, oversized tasks) never match the
 * test-first matchers and are left untouched. Pure + side-effect-free.
 */
function downgradeTestFirstCriticals(review: ReviewResult, note: string): ReviewResult {
  let changed = false;
  const issues = review.issues.map((i) => {
    if (i.severity === "critical" && (TEST_FIRST_ISSUE_RE.test(i.description) || TEST_BEFORE_IMPL_RE.test(i.description))) {
      changed = true;
      return { ...i, severity: "minor" as const, description: `${i.description} ${note}` };
    }
    return i;
  });
  if (!changed) return review;
  const decision: "pass" | "fail" = issues.some((i) => i.severity === "critical") ? "fail" : "pass";
  return { ...review, issues, decision };
}

/**
 * BI-5ED28E2D — Round-aware test-first relaxation (kind-agnostic).
 *
 * applyTestFirstLenienceForKind above EXCLUDES feature builds by design —
 * features should carry tests. But a weak reviewer (notably the on-host local
 * model) over-applies test-first to feature *plans* and invents non-requirements
 * ("add a test that a function is exported"), wedging the plan gate so a feature
 * can never converge and escalates to a human forever.
 *
 * This relaxes test-first criticals for ANY kind. The CALLER gates it on round:
 * only after a plan has cycled through its genuine fix rounds and the ONLY
 * remaining blockers are test-first complaints does it apply — and the test-first
 * requirement is still enforced downstream at the build/build-review gates (which
 * review the actual code, not the plan's prose). Real (non-test-first) blockers
 * never match the matchers, so they keep failing the gate and the build still
 * escalates. Pure + side-effect-free so it is trivially unit-testable.
 */
export function relaxTestFirstAfterRounds(review: ReviewResult, round: number): ReviewResult {
  return downgradeTestFirstCriticals(
    review,
    `[downgraded after ${round} plan-review rounds — only test-first complaints remained; downstream build + review gates still enforce tests]`,
  );
}

// ─── Response Parsing ────────────────────────────────────────────────────────

export function parseReviewResponse(raw: string): ReviewResult {
  return parseSemanticReviewResponse(raw);
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
    // Treat both null reviews and parse-error results as absent reviewers.
    // A parse-error branch is not a dissenting vote — it is infra noise and
    // must not contribute a "fail" recommendation to consensusState detection.
    if (!input.review || input.review.parseError) {
      return {
        branchNodeId: input.branchNodeId,
        role: input.role,
        completed: false,
        failureReason: input.review?.parseError
          ? "parse-error: reviewer returned unparseable output"
          : (input.failureReason ?? "Reviewer did not produce a parsed response."),
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

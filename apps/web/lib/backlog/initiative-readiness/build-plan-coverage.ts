// apps/web/lib/backlog/initiative-readiness/build-plan-coverage.ts
//
// BI-6F2872FC — plan coverage for a Build Studio build.
//
// A large item owes PLAN_REQUIRED, PLAN_COVERAGE_REQUIRED and
// TRACEABILITY_INCOMPLETE. The only coverage the readiness projection read was a
// v2 record naming a committed plan under docs/superpowers/plans. A Build Studio
// build keeps its plan as FeatureBuild.buildPlan, so no Build Studio build whose
// shape is large (or raised to large by the files its plan touches) could ever
// cross plan -> build. Live 2026-10-21: 78 of 110 plan-phase builds refused on
// exactly those codes, and no large Build Studio build had ever been allowed.
//
// WWMD DI-92328629F6E2 (option A): keep the large gates and make them
// reachable. The platform records the coverage from the plan itself, bound to
// the plan's accepted BuildArtifactRevision by id and digest. Traceability is
// checked, never assumed: each plan task names the acceptance ids it satisfies,
// and every acceptance id on the item's current scope baseline must be named by
// some task. A plan that names none is a legacy plan and stays uncovered.
//
// Pure. The writer is apps/web/lib/build/record-build-plan-coverage.ts; the
// reader is projectPlanCoverage in entry-adapter.ts.

import type { ReadinessEvidenceState } from "./types";

export const BUILD_PLAN_COVERAGE_SCHEMA_VERSION = 3;
export const BUILD_PLAN_COVERAGE_SOURCE = "build-studio-plan";

export type BuildPlanTaskTrace = { index: number; title: string; satisfies: string[] };

export type BuildPlanTrace =
  | { complete: true; tasks: BuildPlanTaskTrace[] }
  | {
    complete: false;
    reason:
      | "no-plan-tasks"
      | "baseline-without-acceptance"
      | "plan-untraced"
      | "unknown-acceptance-ref"
      | "acceptance-uncovered";
    uncovered: string[];
    unknownRefs: string[];
  };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function satisfiesOf(task: Record<string, unknown>): string[] {
  const raw = task.satisfies;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((ref): ref is string => typeof ref === "string").map((ref) => ref.trim()).filter(Boolean))];
}

/** Trace a Build Studio plan's tasks to the acceptance ids on the scope baseline. */
export function traceBuildPlanToAcceptance(plan: unknown, acceptanceIds: readonly string[]): BuildPlanTrace {
  const incomplete = (reason: Extract<BuildPlanTrace, { complete: false }>["reason"], uncovered: string[] = [], unknownRefs: string[] = []) =>
    ({ complete: false as const, reason, uncovered, unknownRefs });
  const tasks = record(plan)?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return incomplete("no-plan-tasks");
  if (acceptanceIds.length === 0) return incomplete("baseline-without-acceptance");
  const traced: BuildPlanTaskTrace[] = tasks.map((entry, index) => {
    const task = record(entry) ?? {};
    return { index, title: typeof task.title === "string" ? task.title : `Task ${index + 1}`, satisfies: satisfiesOf(task) };
  });
  const named = new Set(traced.flatMap((task) => task.satisfies));
  if (named.size === 0) return incomplete("plan-untraced", [...acceptanceIds]);
  const known = new Set(acceptanceIds);
  const unknownRefs = [...named].filter((ref) => !known.has(ref));
  if (unknownRefs.length > 0) return incomplete("unknown-acceptance-ref", [], unknownRefs);
  const uncovered = acceptanceIds.filter((id) => !named.has(id));
  if (uncovered.length > 0) return incomplete("acceptance-uncovered", uncovered);
  return { complete: true, tasks: traced };
}

export type BuildPlanCoverageBaseline = { baselineId: string; artifactDigest: string };

/** The plan_backlog_coverage payload the platform records for a traced Build Studio plan. */
export function buildPlanCoveragePayload(args: {
  itemId: string;
  buildId: string;
  revisionId: string;
  planDigest: string;
  baseline: BuildPlanCoverageBaseline;
  acceptanceIds: readonly string[];
  trace: Extract<BuildPlanTrace, { complete: true }>;
  recordedAt: string;
}) {
  return {
    schemaVersion: BUILD_PLAN_COVERAGE_SCHEMA_VERSION,
    source: BUILD_PLAN_COVERAGE_SOURCE,
    decision: "atomic" as const,
    planPath: null,
    planArtifactRef: { kind: "feature-build-revision" as const, field: "buildPlan" as const, revisionId: args.revisionId, buildId: args.buildId },
    planArtifactDigest: args.planDigest,
    scopeBaselineId: args.baseline.baselineId,
    scopeBaselineArtifactDigest: args.baseline.artifactDigest,
    mappedItemIds: [args.itemId],
    sourceBuildId: args.buildId,
    deliverables: [{
      key: "build-plan",
      title: `Build Studio plan for ${args.buildId}`,
      backlogItemId: args.itemId,
      dependsOn: [],
      independentlyShippable: true,
      verificationRefs: [...args.acceptanceIds],
      taskTrace: args.trace.tasks,
    }],
    recordedAt: args.recordedAt,
  };
}

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/i;

function bareHex(digest: string): string {
  return digest.replace(/^sha256:/i, "").toLowerCase();
}

/**
 * Read a Build Studio plan coverage record. Null when the record is not one
 * (a repository plan), so the caller keeps its own rules for those.
 *
 * `currentPlanDigest`, when the caller knows the build's current plan, makes a
 * record covering an earlier plan stale: coverage covers one plan, not "the
 * plan, whatever it later becomes".
 */
export function projectBuildPlanCoverage(
  payload: unknown,
  baseline: BuildPlanCoverageBaseline | null,
  currentPlanDigest?: string | null,
): { state: ReadinessEvidenceState; planDigest: string | null } | null {
  const row = record(payload);
  const artifact = record(row?.planArtifactRef);
  if (!row || artifact?.kind !== "feature-build-revision") return null;
  const malformed = { state: "malformed" as const, planDigest: null };
  const deliverables = Array.isArray(row.deliverables) ? row.deliverables.map(record) : [];
  if (row.schemaVersion !== BUILD_PLAN_COVERAGE_SCHEMA_VERSION
    || row.source !== BUILD_PLAN_COVERAGE_SOURCE
    || row.decision !== "atomic"
    || artifact.field !== "buildPlan"
    || typeof artifact.revisionId !== "string" || !artifact.revisionId
    || typeof row.planArtifactDigest !== "string" || !DIGEST_RE.test(row.planArtifactDigest)
    || typeof row.scopeBaselineId !== "string" || typeof row.scopeBaselineArtifactDigest !== "string"
    || deliverables.length === 0
    || deliverables.some((deliverable) => !deliverable
      || !Array.isArray(deliverable.verificationRefs) || deliverable.verificationRefs.length === 0)) {
    return malformed;
  }
  const planDigest = row.planArtifactDigest;
  if (!baseline
    || row.scopeBaselineId !== baseline.baselineId
    || row.scopeBaselineArtifactDigest !== baseline.artifactDigest
    || (currentPlanDigest && bareHex(currentPlanDigest) !== bareHex(planDigest))) {
    return { state: "stale", planDigest };
  }
  return { state: "pass", planDigest };
}

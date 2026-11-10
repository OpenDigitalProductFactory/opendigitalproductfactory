// apps/web/lib/build/record-build-plan-coverage.ts
//
// BI-6F2872FC — the platform records a Build Studio build's plan coverage.
//
// A Build Studio build whose shape is large owes a plan with live backlog
// coverage and traceability before plan -> build. Nothing in Build Studio could
// produce one: record_plan_backlog_coverage takes a committed plan document, and
// a build's plan lives on FeatureBuild.buildPlan. This writer closes that gap
// (WWMD DI-92328629F6E2, option A) without weakening the gate:
//
//   - only a plan whose own Build Studio review passed is covered;
//   - the coverage binds the plan's accepted BuildArtifactRevision by id and
//     digest, minting that revision from the stored plan when none holds it;
//   - every acceptance id on the item's current scope baseline must be named by
//     some task's `satisfies` (traceBuildPlanToAcceptance). A plan that names
//     none, or misses one, is not covered — the refusal says which.
//
// The independent plan review is still owed. It is routed by the Build Studio
// owed-review dispatcher, which now finds the accepted plan revision to bind.
//
// Never throws: the caller is the plan -> build transition, and a coverage
// failure must leave that transition's own refusal intact.

import type { Prisma } from "@dpf/db";

import { buildPlanCoveragePayload, projectBuildPlanCoverage, traceBuildPlanToAcceptance } from "@/lib/backlog/initiative-readiness/build-plan-coverage";
import { BUILD_STUDIO_ASSISTANT_AGENT_ID } from "@/lib/backlog/initiative-readiness/build-studio-owed-routes";
import { parseReadinessBaselines, type InitiativeReadinessActivity } from "@/lib/backlog/initiative-readiness/entry-adapter";
import { digestBuildArtifactValue, type PersistArtifactRevisionResult } from "./build-artifact-provenance";

type ActivityRow = InitiativeReadinessActivity;

type BuildRow = {
  buildId: string;
  phase: string;
  buildPlan: unknown;
  planReview: unknown;
  createdById: string;
  originator: { id: string; itemId: string; activities: ActivityRow[] } | null;
};

type CoverageTx = {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  backlogItemActivity: {
    findFirst(args: unknown): Promise<{ payload: unknown } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
};

export type RecordBuildPlanCoverageDb = {
  featureBuild: { findUnique(args: unknown): Promise<BuildRow | null> };
  buildArtifactRevision: { findFirst(args: unknown): Promise<{ id: string; valueDigest: string } | null> };
  saveRevision(args: {
    buildId: string;
    field: "buildPlan";
    value: unknown;
    savedByUserId: string;
    savedByAgentId: string;
  }): Promise<Pick<PersistArtifactRevisionResult, "revisionId" | "status">>;
  $transaction<T>(work: (tx: CoverageTx) => Promise<T>): Promise<T>;
};

export type RecordBuildPlanCoverageOutcome =
  | { recorded: true; activityId: string; revisionId: string }
  | { recorded: false; reason: string; detail?: string };

const COVERAGE_INPUT_KINDS = ["initiative_scope_baseline", "plan_backlog_coverage"] as const;

async function defaultDb(): Promise<RecordBuildPlanCoverageDb> {
  const { prisma } = await import("@dpf/db");
  const { saveBuildArtifactRevision } = await import("./build-artifact-provenance");
  return {
    featureBuild: prisma.featureBuild as unknown as RecordBuildPlanCoverageDb["featureBuild"],
    buildArtifactRevision: prisma.buildArtifactRevision as unknown as RecordBuildPlanCoverageDb["buildArtifactRevision"],
    saveRevision: (args) => saveBuildArtifactRevision(args),
    $transaction: (work) => prisma.$transaction((tx) => work(tx as unknown as CoverageTx)),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function acceptanceIdsOf(activities: readonly ActivityRow[], baselineId: string): string[] {
  const row = activities.find((activity) => activity.kind === "initiative_scope_baseline"
    && record(activity.payload)?.baselineId === baselineId);
  const statements = record(row?.payload)?.acceptanceStatements;
  if (!Array.isArray(statements)) return [];
  return statements
    .map((statement) => record(statement)?.acceptanceId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function latestCoverage(activities: readonly ActivityRow[]): ActivityRow | null {
  return [...activities]
    .filter((activity) => activity.kind === "plan_backlog_coverage")
    .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime() || right.id.localeCompare(left.id))[0] ?? null;
}

/** Record platform plan coverage for a Build Studio build whose plan passed its review. Never throws. */
export async function recordBuildPlanCoverage(args: {
  buildId: string;
  db?: RecordBuildPlanCoverageDb;
  now?: () => Date;
}): Promise<RecordBuildPlanCoverageOutcome> {
  try {
    const db = args.db ?? await defaultDb();
    const build = await db.featureBuild.findUnique({
      where: { buildId: args.buildId },
      select: {
        buildId: true, phase: true, buildPlan: true, planReview: true, createdById: true,
        originator: { select: { id: true, itemId: true, activities: {
          where: { kind: { in: [...COVERAGE_INPUT_KINDS] } },
          orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
          select: { id: true, kind: true, gateKey: true, recordedAt: true, payload: true },
        } } },
      },
    });
    if (!build) return { recorded: false, reason: "build-not-found" };
    if (build.phase !== "plan") return { recorded: false, reason: "not-in-plan" };
    const review = record(build.planReview);
    if (review?.decision !== "pass" || review.reviewIncomplete === true) return { recorded: false, reason: "plan-review-not-passed" };
    const item = build.originator;
    if (!item) return { recorded: false, reason: "no-backlog-subject" };

    // The item's OWN current baseline: an inherited parent scope is judged on
    // the parent's coverage, which this build does not own.
    const baseline = parseReadinessBaselines(item.activities, item.itemId).current;
    if (!baseline) return { recorded: false, reason: "no-own-scope-baseline" };
    const acceptanceIds = acceptanceIdsOf(item.activities, baseline.baselineId);
    const trace = traceBuildPlanToAcceptance(build.buildPlan, acceptanceIds);
    if (!trace.complete) {
      const detail = [...trace.uncovered, ...trace.unknownRefs].join(", ");
      return { recorded: false, reason: trace.reason, ...(detail ? { detail } : {}) };
    }

    const planHex = digestBuildArtifactValue(build.buildPlan);
    const planDigest = `sha256:${planHex}`;
    const scope = { baselineId: baseline.baselineId, artifactDigest: baseline.artifactDigest };
    const existing = latestCoverage(item.activities);
    if (existing && projectBuildPlanCoverage(existing.payload, scope, planDigest)?.state === "pass") {
      return { recorded: false, reason: "already-covered" };
    }

    const accepted = await db.buildArtifactRevision.findFirst({
      where: { buildId: build.buildId, field: "buildPlan", status: "accepted" },
      orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
      select: { id: true, valueDigest: true },
    });
    let revisionId = accepted && accepted.valueDigest.replace(/^sha256:/i, "") === planHex ? accepted.id : null;
    if (!revisionId) {
      // The plan Build Studio generated and its reviewers passed. Its author is
      // the Build Studio build coworker that runs the plan phase.
      const saved = await db.saveRevision({
        buildId: build.buildId,
        field: "buildPlan",
        value: build.buildPlan,
        savedByUserId: build.createdById,
        savedByAgentId: BUILD_STUDIO_ASSISTANT_AGENT_ID,
      });
      if (saved.status !== "accepted") return { recorded: false, reason: "plan-revision-not-accepted" };
      revisionId = saved.revisionId;
    }

    const payload = buildPlanCoveragePayload({
      itemId: item.itemId,
      buildId: build.buildId,
      revisionId,
      planDigest,
      baseline: scope,
      acceptanceIds,
      trace,
      recordedAt: (args.now ?? (() => new Date()))().toISOString(),
    });
    const activityId = await db.$transaction(async (tx) => {
      // Coverage writers serialize on the item row, as the other coverage and
      // baseline writers do.
      await tx.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "id" = ${item.id} FOR UPDATE`;
      const latest = await tx.backlogItemActivity.findFirst({
        where: { backlogItemId: item.id, kind: "plan_backlog_coverage" },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        select: { payload: true },
      });
      if (latest && projectBuildPlanCoverage(latest.payload, scope, planDigest)?.state === "pass") return null;
      const row = await tx.backlogItemActivity.create({
        data: {
          backlogItemId: item.id,
          kind: "plan_backlog_coverage",
          summary: `Build Studio plan for ${build.buildId} covers ${acceptanceIds.length} acceptance criteria across ${trace.tasks.length} task(s).`,
          payload: payload as unknown as Prisma.InputJsonValue,
          recordedById: build.createdById,
          recordedByAgentId: BUILD_STUDIO_ASSISTANT_AGENT_ID,
        },
      });
      return row.id;
    });
    if (!activityId) return { recorded: false, reason: "already-covered" };
    return { recorded: true, activityId, revisionId };
  } catch (error) {
    return { recorded: false, reason: "error", detail: String(error instanceof Error ? error.message : error).slice(0, 200) };
  }
}

/** Outcomes worth telling the build's owner about; the rest are routine no-ops. */
const REPORTED_REFUSALS = new Set([
  "baseline-without-acceptance", "plan-untraced", "unknown-acceptance-ref", "acceptance-uncovered",
  "plan-revision-not-accepted", "error",
]);

export function describeBuildPlanCoverageOutcome(outcome: RecordBuildPlanCoverageOutcome): string | null {
  if (outcome.recorded) return `Plan coverage recorded from the reviewed plan (revision ${outcome.revisionId}); the independent plan review can now bind it.`;
  if (!REPORTED_REFUSALS.has(outcome.reason)) return null;
  const detail = outcome.detail ? ` (${outcome.detail})` : "";
  switch (outcome.reason) {
    case "plan-untraced":
      return "Plan coverage not recorded: no plan task names the acceptance criteria it satisfies, so the plan cannot be traced to the approved scope.";
    case "acceptance-uncovered":
      return `Plan coverage not recorded: no plan task satisfies${detail}.`;
    case "unknown-acceptance-ref":
      return `Plan coverage not recorded: plan tasks name acceptance ids the approved scope does not hold${detail}.`;
    case "baseline-without-acceptance":
      return "Plan coverage not recorded: the approved scope baseline carries no acceptance ids to trace the plan to.";
    default:
      return `Plan coverage not recorded: ${outcome.reason}${detail}.`;
  }
}

/**
 * Record coverage, and tell the owner what happened once per distinct outcome
 * (the resume loop calls this on every due tick). Never throws.
 */
export async function ensureBuildPlanCoverage(buildId: string): Promise<RecordBuildPlanCoverageOutcome> {
  const outcome = await recordBuildPlanCoverage({ buildId });
  const summary = describeBuildPlanCoverageOutcome(outcome);
  if (!summary) return outcome;
  try {
    const { prisma } = await import("@dpf/db");
    const last = await prisma.buildActivity.findFirst({
      where: { buildId, tool: "plan-coverage" },
      orderBy: { createdAt: "desc" },
      select: { summary: true },
    });
    if (last?.summary !== summary) {
      await prisma.buildActivity.create({ data: { buildId, tool: "plan-coverage", summary } });
    }
  } catch {
    /* best-effort visibility */
  }
  return outcome;
}

// apps/web/lib/build/plan-gate-stall-invariant.ts
//
// BI-9FA1F9CF — invariant: a Build Studio plan that passed its own review does
// not sit refused on PLAN_REQUIRED.
//
// The plan -> build transition records the plan's coverage before readiness
// judges it (BI-6F2872FC). When that recording cannot happen, the refusal tells
// the owner "nothing here is waiting on your input" and the build waits on a
// receipt nobody will write. On 2026-11-13, 19 builds sat like that for 12
// hours and nothing noticed. This invariant raises one platform signal per
// stalled build once the stall is older than STALL_THRESHOLD_MS; the
// PlatformIssueReport dedupeKey keeps it to one open report per build.
//
// It observes and reports. It never records a receipt or moves a phase.

export const STALL_THRESHOLD_MS = 15 * 60 * 1000;
export const PLAN_GATE_STALL_SOURCE = "plan-gate-stall-invariant";
export const PLAN_GATE_STALL_TRIGGER = "plan-passed-plan-required";

export type PlanGateStallActivity = { tool: string; summary: string; createdAt: Date };

export type PlanGateStallBuild = {
  id: string;
  buildId: string;
  title: string;
  /** reviewBuildPlan and phase:gate-blocked rows, any order. */
  activities: PlanGateStallActivity[];
};

export type PlanGateStall = {
  id: string;
  buildId: string;
  title: string;
  planPassedAt: Date;
  blockedSince: Date;
  lastBlockedAt: Date;
  lastReason: string;
};

const PLAN_REVIEW_PASS = /^Plan review: pass\b/;
const PLAN_REQUIRED = /\bPLAN_REQUIRED\b/;

/**
 * A build is stalled when its latest plan review passed, every gate refusal
 * since then names PLAN_REQUIRED (so the latest one still does), and the first
 * of them is at least `thresholdMs` old.
 */
export function findPlanGateStall(
  build: PlanGateStallBuild,
  now: Date,
  thresholdMs = STALL_THRESHOLD_MS,
): PlanGateStall | null {
  const ordered = [...build.activities].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const reviews = ordered.filter((activity) => activity.tool === "reviewBuildPlan");
  const latestReview = reviews[reviews.length - 1];
  if (!latestReview || !PLAN_REVIEW_PASS.test(latestReview.summary)) return null;
  const since = latestReview.createdAt.getTime();
  const blocks = ordered.filter((activity) => activity.tool === "phase:gate-blocked" && activity.createdAt.getTime() >= since);
  const last = blocks[blocks.length - 1];
  if (!last || !PLAN_REQUIRED.test(last.summary)) return null;
  // The stall started at the first refusal of the unbroken PLAN_REQUIRED run
  // that ends at the latest one; an earlier, different refusal is a different wait.
  let first = last;
  for (let index = blocks.length - 1; index >= 0 && PLAN_REQUIRED.test(blocks[index]!.summary); index -= 1) first = blocks[index]!;
  if (now.getTime() - first.createdAt.getTime() < thresholdMs) return null;
  return {
    id: build.id,
    buildId: build.buildId,
    title: build.title,
    planPassedAt: latestReview.createdAt,
    blockedSince: first.createdAt,
    lastBlockedAt: last.createdAt,
    lastReason: last.summary,
  };
}

export type PlanGateStallDeps = {
  now: () => Date;
  /** Plan-phase builds whose stored plan review passed, with their review and refusal rows. */
  loadCandidates: () => Promise<PlanGateStallBuild[]>;
  fileReport: (stall: PlanGateStall) => Promise<void>;
};

function minutes(ms: number): number {
  return Math.round(ms / 60000);
}

export function describePlanGateStall(stall: PlanGateStall, now: Date) {
  return {
    title: `Build ${stall.buildId} passed plan review but is still refused on PLAN_REQUIRED`,
    description: [
      `Invariant breached: a Build Studio plan that passed its own review must not stay refused on PLAN_REQUIRED (BI-9FA1F9CF).`,
      ``,
      `- Build: ${stall.buildId} — ${stall.title}`,
      `- Plan review passed: ${stall.planPassedAt.toISOString()}`,
      `- Refused on PLAN_REQUIRED since: ${stall.blockedSince.toISOString()} (${minutes(now.getTime() - stall.blockedSince.getTime())} min)`,
      `- Latest refusal: ${stall.lastBlockedAt.toISOString()} — ${stall.lastReason}`,
      ``,
      `The plan coverage writer (apps/web/lib/build/record-build-plan-coverage.ts) did not record the coverage the gate reads. Its outcome is on the build's "plan-coverage" activity.`,
    ].join("\n"),
  };
}

async function defaultDeps(): Promise<PlanGateStallDeps> {
  const { prisma } = await import("@dpf/db");
  return {
    now: () => new Date(),
    loadCandidates: async () => {
      const builds = await prisma.featureBuild.findMany({
        where: { phase: "plan", planReview: { path: ["decision"], equals: "pass" } },
        select: { id: true, buildId: true, title: true },
        take: 500,
      });
      if (builds.length === 0) return [];
      const rows = await prisma.buildActivity.findMany({
        where: { buildId: { in: builds.map((build) => build.buildId) }, tool: { in: ["reviewBuildPlan", "phase:gate-blocked"] } },
        select: { buildId: true, tool: true, summary: true, createdAt: true },
      });
      return builds.map((build) => ({
        ...build,
        activities: rows.filter((row) => row.buildId === build.buildId),
      }));
    },
    fileReport: async (stall) => {
      const { createPlatformIssueReport } = await import("@/lib/quality/platform-issue-reports");
      const now = new Date();
      await createPlatformIssueReport({
        type: "regression",
        source: PLAN_GATE_STALL_SOURCE,
        triggerKind: PLAN_GATE_STALL_TRIGGER,
        severity: "high",
        dedupeKey: `${PLAN_GATE_STALL_TRIGGER}:${stall.buildId}`,
        featureBuildId: stall.id,
        routeContext: "/build",
        ...describePlanGateStall(stall, now),
      });
    },
  };
}

/** Run the invariant once. Returns the build ids it reported. */
export async function runPlanGateStallInvariant(deps?: Partial<PlanGateStallDeps>): Promise<{ checked: number; stalled: string[] }> {
  const resolved = { ...(await defaultDeps()), ...deps };
  const now = resolved.now();
  const candidates = await resolved.loadCandidates();
  const stalled: string[] = [];
  for (const build of candidates) {
    const stall = findPlanGateStall(build, now);
    if (!stall) continue;
    await resolved.fileReport(stall);
    stalled.push(stall.buildId);
  }
  return { checked: candidates.length, stalled };
}

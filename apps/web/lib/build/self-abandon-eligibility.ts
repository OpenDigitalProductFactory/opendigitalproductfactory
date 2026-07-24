// apps/web/lib/build/self-abandon-eligibility.ts
//
// Governed agent self-abandon: let the agent driving a build free its OWN
// stalled/superseded WIP slot without operator intervention, without letting
// agents bypass the WIP cap's intent by abandoning at will.
//
// Background: an agent driving Build Studio autonomously has no path to
// abandon its own stalled/superseded build — the only abandon path was the UI
// Delete flow, gated behind a native confirm() dialog that blocks browser
// automation. When the WIP cap is hit by dead builds, an autonomous agent
// could not free a slot without a human clicking OK.
//
// Guardrails (deliberate, mirroring the system watchdog's non-terminal-phase
// vocabulary in inert-build-reaper.ts / resume-pre-build-phase.ts, but scoped
// to self-service):
//   - ownership: only the build's own creator may abandon it;
//   - a live TaskRun is NEVER abandonable, even by the owner — this tool frees
//     dead WIP, it does not let an agent yank a build out from under itself
//     mid-turn;
//   - epic-decomposed children are coordinated by the parent Epic, not this
//     tool;
//   - stalled/superseded, not "any non-terminal build": either the build has
//     had no observable activity for at least the minimum staleness window, or
//     it carries an explicit supersession marker (supersededByEpicId);
//   - a non-empty evidence reason is mandatory — it becomes the audited
//     abandonReason, so a human reviewing history sees WHY the agent abandoned
//     its own work, not a bare status flip.
//
// This module is the pure decision layer (no DB) — see
// apps/web/lib/mcp/build-lifecycle-handlers.ts's callers for the transactional
// DB wrapper wired to the `abandon_stalled_build` MCP tool.

const TERMINAL_BUILD_PHASES = new Set<string>(["complete", "failed", "abandoned"]);

/**
 * Minimum time since the build's last observed activity (or its creation, if
 * it never had any) before an owner-initiated self-abandon is honored.
 * Deliberately short relative to the system watchdog's 3h/6h/7d windows
 * (inert-build-reaper.ts, resume-pre-build-phase.ts): those sweep blindly and
 * must wait out a conservative margin before concluding a build is dead;
 * self-abandon is agent-initiated with a cited reason, so it doesn't need the
 * same margin — it just needs enough headroom that a build the agent is
 * actively mid-turn on (activity seconds old) can never be pulled out from
 * under it by a stray call. Override with BUILD_SELF_ABANDON_MIN_STALE_MS.
 */
export const SELF_ABANDON_MIN_STALE_MS =
  Number(process.env.BUILD_SELF_ABANDON_MIN_STALE_MS) || 10 * 60 * 1000;

export type SelfAbandonIneligibleReason =
  | "missing_reason"
  | "not_owner"
  | "epic_child"
  | "already_terminal"
  | "live_task_run"
  | "not_stale_enough";

export type SelfAbandonEligibility =
  | { eligible: true }
  | { eligible: false; reason: SelfAbandonIneligibleReason; detail: string };

/**
 * Pure decision: may `callerId` self-abandon this build right now? No DB;
 * unit-tested. Checks are ordered cheapest/most-fundamental first so the
 * caller gets the most actionable rejection reason.
 */
export function evaluateSelfAbandonEligibility(args: {
  callerId: string;
  createdById: string;
  phase: string;
  abandonedAt: Date | null;
  parentEpicId: string | null;
  supersededByEpicId: string | null;
  liveTaskRunCount: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  reason: string | undefined | null;
  now: Date;
  minStaleMs?: number;
}): SelfAbandonEligibility {
  const {
    callerId,
    createdById,
    phase,
    abandonedAt,
    parentEpicId,
    supersededByEpicId,
    liveTaskRunCount,
    lastActivityAt,
    createdAt,
    reason,
    now,
    minStaleMs = SELF_ABANDON_MIN_STALE_MS,
  } = args;

  if (!reason || !reason.trim()) {
    return {
      eligible: false,
      reason: "missing_reason",
      detail:
        "A reason citing evidence is required (e.g. \"shipped elsewhere in PR #X\" or \"superseded by FB-Y\").",
    };
  }
  if (callerId !== createdById) {
    return {
      eligible: false,
      reason: "not_owner",
      detail: "Only the build's own creator may self-abandon it.",
    };
  }
  if (parentEpicId) {
    return {
      eligible: false,
      reason: "epic_child",
      detail: "Epic-decomposed child builds are coordinated by the parent Epic, not self-abandon.",
    };
  }
  if (abandonedAt || TERMINAL_BUILD_PHASES.has(phase)) {
    return {
      eligible: false,
      reason: "already_terminal",
      detail: `Build is already terminal (phase=${phase}).`,
    };
  }
  if (liveTaskRunCount > 0) {
    return {
      eligible: false,
      reason: "live_task_run",
      detail: "Build has an active task run in progress — never abandon a build that is actively working.",
    };
  }

  // Explicit supersession always satisfies the stalled/superseded guard
  // regardless of freshness: the parent Epic already marked this build
  // superseded, which is a stronger signal than an activity timer.
  if (supersededByEpicId) return { eligible: true };

  const referenceTime = lastActivityAt ?? createdAt;
  const staleMs = now.getTime() - referenceTime.getTime();
  if (staleMs < minStaleMs) {
    return {
      eligible: false,
      reason: "not_stale_enough",
      detail:
        `Build had activity ${Math.round(staleMs / 60_000)}m ago — must be stalled for at least ` +
        `${Math.round(minStaleMs / 60_000)}m before self-abandon.`,
    };
  }
  return { eligible: true };
}

export type SelfAbandonOutcome =
  | { kind: "abandoned"; buildId: string }
  | { kind: "not_found" }
  | { kind: "ineligible"; reason: SelfAbandonIneligibleReason; detail: string };

/**
 * DB wrapper: validate ownership + stalled/superseded eligibility, then
 * transactionally flip the build to `abandoned` with a full audit trail
 * (BuildActivity row + abandonReason carrying the caller's cited evidence),
 * and best-effort release the sandbox git branch back to the client branch.
 *
 * Re-checks eligibility under the transaction row so a build that changed
 * state between the read and the write (e.g. it just gained activity, or a
 * concurrent call already abandoned it) is never double-abandoned.
 */
export async function abandonOwnStalledBuild(params: {
  buildId: string;
  callerId: string;
  reason: string;
  now?: Date;
}): Promise<SelfAbandonOutcome> {
  const { buildId, callerId, reason } = params;
  const now = params.now ?? new Date();

  const { prisma } = await import("@dpf/db");
  const { TASK_LIVE_STATES } = await import("@/lib/tak/task-states");

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      buildId: true,
      phase: true,
      abandonedAt: true,
      createdById: true,
      parentEpicId: true,
      supersededByEpicId: true,
      createdAt: true,
    },
  });
  if (!build) return { kind: "not_found" };

  const [liveTaskRunCount, lastActivity] = await Promise.all([
    prisma.taskRun.count({ where: { buildId, status: { in: [...TASK_LIVE_STATES] } } }),
    prisma.buildActivity.findFirst({
      where: { buildId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const eligibility = evaluateSelfAbandonEligibility({
    callerId,
    createdById: build.createdById,
    phase: build.phase,
    abandonedAt: build.abandonedAt,
    parentEpicId: build.parentEpicId,
    supersededByEpicId: build.supersededByEpicId,
    liveTaskRunCount,
    lastActivityAt: lastActivity?.createdAt ?? null,
    createdAt: build.createdAt,
    reason,
    now,
  });
  if (!eligibility.eligible) {
    return { kind: "ineligible", reason: eligibility.reason, detail: eligibility.detail };
  }

  const abandoned = await prisma.$transaction(async (tx) => {
    // Re-check under the row: don't double-abandon a build that changed state
    // between the eligibility read above and this write.
    const fresh = await tx.featureBuild.findUnique({
      where: { buildId },
      select: { phase: true, abandonedAt: true },
    });
    if (!fresh || fresh.abandonedAt || TERMINAL_BUILD_PHASES.has(fresh.phase)) return false;

    await tx.featureBuild.update({
      where: { buildId },
      data: {
        phase: "abandoned",
        abandonedAt: now,
        abandonReason: `Self-abandoned by owning agent via governed tool: ${reason}`,
      },
    });
    await tx.buildActivity.create({
      data: {
        buildId,
        tool: "abandon_stalled_build",
        summary: `Self-abandoned (stalled/superseded, agent-cited evidence): ${reason}`,
      },
    });
    return true;
  });

  if (!abandoned) {
    return {
      kind: "ineligible",
      reason: "already_terminal",
      detail: "Build became terminal since the eligibility check (concurrent abandon or completion).",
    };
  }

  // Best-effort sandbox/git cleanup — never blocks the abandon on a sandbox
  // hiccup; the FeatureBuild row is already the source of truth once the
  // transaction above commits.
  const { abandonBuildBranch } = await import("@/lib/integrate/sandbox/build-branch");
  await abandonBuildBranch(buildId).catch(() => {});

  return { kind: "abandoned", buildId };
}

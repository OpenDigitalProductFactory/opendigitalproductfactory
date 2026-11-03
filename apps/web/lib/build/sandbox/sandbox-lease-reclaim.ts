// apps/web/lib/build/sandbox/sandbox-lease-reclaim.ts
//
// Reclaim sandbox slots whose lease outlived its work (AC-8 of
// docs/superpowers/specs/2026-10-21-agent-sandbox-containment-and-grader-integrity-design.md).
//
// A SandboxSlot lease is released only by the pipeline's `finally`
// (build-pipeline.ts) and by build-execute. The terminal-build cleanup,
// releaseSandboxForTerminalBuild, tears down the worktree but leaves the slot
// row `in_use`, so a build the inert/stalled reaper abandons keeps its slot
// until the portal restarts and initializePool resets every row. Two cases are
// reclaimed here:
//   - orphan: the lease names a build that is gone, terminal or abandoned;
//   - idle:   the build is still open, no TaskRun is live, and nothing has
//             happened for longer than the idle window.
// Releasing an idle lease leaves the build itself alone: acquireSandboxLease is
// idempotent per build, so the build's next pipeline step takes a slot again.
//
// Liveness reuses the inert/stalled reaper's signals (BuildActivity, live
// TaskRuns) plus FeatureBuild.updatedAt and the lease's own acquiredAt, so a
// pipeline that is still writing state is never idle. The default window
// (60 min) is longer than the longest single agent CLI task (OpenCode schema
// tasks, 40 min), which can run without writing any of those signals.
//
// Observe-only by default, like the other reapers: it reports what it would
// release. DPF_SANDBOX_LEASE_RECLAIM_ENABLED=1 makes it release.

import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { TASK_LIVE_STATES } from "@/lib/tak/task-states";

/** Master switch: release reclaimable leases (default OFF = observe only). */
export const SANDBOX_LEASE_RECLAIM_ENABLED_FLAG = "DPF_SANDBOX_LEASE_RECLAIM_ENABLED";

/** Idle window override, in milliseconds. */
export const SANDBOX_LEASE_IDLE_MS_ENV = "DPF_SANDBOX_LEASE_IDLE_MS";

/** Default idle window: 60 min with no signal and no live TaskRun. */
export const DEFAULT_SANDBOX_LEASE_IDLE_MS = 60 * 60 * 1000;

const TERMINAL_BUILD_PHASES = ["complete", "failed", "abandoned"];

export type SandboxLeaseDecision = "keep" | "release-orphan" | "release-idle";

export type SandboxLeaseLiveness = {
  /** null when no FeatureBuild row exists for the lease's buildId. */
  build: { phase: string; abandonedAt: Date | null } | null;
  /** Newest of the build's latest BuildActivity and FeatureBuild.updatedAt. */
  lastSignalAt: Date | null;
  liveTaskRunCount: number;
};

/** Pure decision for one held lease. No DB. */
export function classifySandboxLease(args: SandboxLeaseLiveness & {
  acquiredAt: Date | null;
  now: Date;
  idleMs: number;
}): SandboxLeaseDecision {
  const { build } = args;
  if (!build || build.abandonedAt || TERMINAL_BUILD_PHASES.includes(build.phase)) {
    return "release-orphan";
  }
  if (args.liveTaskRunCount > 0) return "keep";
  const newest = [args.acquiredAt, args.lastSignalAt]
    .filter((d): d is Date => d instanceof Date)
    .reduce<Date | null>((a, b) => (a && a.getTime() >= b.getTime() ? a : b), null);
  if (!newest) return "keep"; // unknown freshness: stay conservative
  return args.now.getTime() - newest.getTime() > args.idleMs ? "release-idle" : "keep";
}

export function sandboxLeaseIdleMs(env: Record<string, string | undefined>): number {
  const parsed = Number(env[SANDBOX_LEASE_IDLE_MS_ENV]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SANDBOX_LEASE_IDLE_MS;
}

export type HeldSandboxLease = { buildId: string; containerId: string; acquiredAt: Date | null };

export type SandboxLeaseReclaimDeps = {
  listHeldLeases: () => Promise<HeldSandboxLease[]>;
  readLiveness: (buildId: string) => Promise<SandboxLeaseLiveness>;
  releaseLease: (buildId: string) => Promise<void>;
  recordActivity: (buildId: string, summary: string) => Promise<void>;
};

export type SandboxLeaseReclaimCandidate = HeldSandboxLease & {
  decision: Exclude<SandboxLeaseDecision, "keep">;
};

export type SandboxLeaseReclaimResult = {
  mode: "observe" | "enforce";
  idleMs: number;
  candidates: SandboxLeaseReclaimCandidate[];
  released: string[];
};

async function defaultListHeldLeases(): Promise<HeldSandboxLease[]> {
  const { prisma } = await import("@dpf/db");
  const rows = await prisma.sandboxSlot.findMany({
    where: { status: "in_use", buildId: { not: null } },
    select: { buildId: true, containerId: true, acquiredAt: true },
  });
  return rows.flatMap((r) => (r.buildId ? [{ buildId: r.buildId, containerId: r.containerId, acquiredAt: r.acquiredAt }] : []));
}

async function defaultReadLiveness(buildId: string): Promise<SandboxLeaseLiveness> {
  const { prisma } = await import("@dpf/db");
  const [build, lastActivity, liveTaskRunCount] = await Promise.all([
    prisma.featureBuild.findUnique({
      where: { buildId },
      select: { phase: true, abandonedAt: true, updatedAt: true },
    }),
    prisma.buildActivity.findFirst({
      where: { buildId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.taskRun.count({ where: { buildId, status: { in: [...TASK_LIVE_STATES] } } }),
  ]);
  const signals = [build?.updatedAt, lastActivity?.createdAt].filter((d): d is Date => d instanceof Date);
  const lastSignalAt = signals.length
    ? new Date(Math.max(...signals.map((d) => d.getTime())))
    : null;
  return {
    build: build ? { phase: build.phase, abandonedAt: build.abandonedAt } : null,
    lastSignalAt,
    liveTaskRunCount,
  };
}

async function defaultReleaseLease(buildId: string): Promise<void> {
  const { releaseSandboxLease } = await import("./sandbox-pool");
  await releaseSandboxLease({ buildId });
}

async function defaultRecordActivity(buildId: string, summary: string): Promise<void> {
  const { prisma } = await import("@dpf/db");
  await prisma.buildActivity.create({
    data: { buildId, tool: "watchdog:sandbox-lease-reclaim", summary },
  });
}

// Observe mode runs every watchdog tick; log each candidate once per process.
const observedOnce = new Set<string>();

/**
 * Find held leases that are orphaned or idle and, when enabled, release them.
 * Best-effort per lease: one failure never aborts the pass. Each release
 * re-reads liveness first so a build that came alive since the scan keeps its
 * slot.
 */
export async function reclaimSandboxLeases(options: {
  env?: Record<string, string | undefined>;
  now?: Date;
  deps?: Partial<SandboxLeaseReclaimDeps>;
} = {}): Promise<SandboxLeaseReclaimResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const idleMs = sandboxLeaseIdleMs(env);
  const mode = envFlagEnabled(env, SANDBOX_LEASE_RECLAIM_ENABLED_FLAG) ? "enforce" : "observe";
  const deps: SandboxLeaseReclaimDeps = {
    listHeldLeases: options.deps?.listHeldLeases ?? defaultListHeldLeases,
    readLiveness: options.deps?.readLiveness ?? defaultReadLiveness,
    releaseLease: options.deps?.releaseLease ?? defaultReleaseLease,
    recordActivity: options.deps?.recordActivity ?? defaultRecordActivity,
  };

  const result: SandboxLeaseReclaimResult = { mode, idleMs, candidates: [], released: [] };
  const leases = await deps.listHeldLeases();
  for (const lease of leases) {
    try {
      const liveness = await deps.readLiveness(lease.buildId);
      const decision = classifySandboxLease({ ...liveness, acquiredAt: lease.acquiredAt, now, idleMs });
      if (decision === "keep") continue;
      result.candidates.push({ ...lease, decision });

      if (mode === "observe") {
        const key = `${lease.buildId}:${decision}`;
        if (!observedOnce.has(key)) {
          observedOnce.add(key);
          console.info(
            `[sandbox-lease-reclaim] would release ${decision.replace("release-", "")} lease ${lease.buildId} on ${lease.containerId} (observe only; set ${SANDBOX_LEASE_RECLAIM_ENABLED_FLAG}=1 to release)`,
          );
        }
        continue;
      }

      const fresh = await deps.readLiveness(lease.buildId);
      if (classifySandboxLease({ ...fresh, acquiredAt: lease.acquiredAt, now, idleMs }) === "keep") continue;
      await deps.releaseLease(lease.buildId);
      result.released.push(lease.buildId);
      if (fresh.build) {
        const minutes = Math.round(idleMs / 60_000);
        await deps.recordActivity(
          lease.buildId,
          decision === "release-orphan"
            ? `Released sandbox slot ${lease.containerId}: the build is ${fresh.build.abandonedAt ? "abandoned" : fresh.build.phase} and no longer needs it.`
            : `Released sandbox slot ${lease.containerId} after ${minutes} min with no activity and no live task run. The build keeps its phase and takes a slot again on its next step.`,
        );
      }
      console.warn(`[sandbox-lease-reclaim] released ${decision.replace("release-", "")} lease ${lease.buildId} on ${lease.containerId}`);
    } catch (err) {
      console.warn(`[sandbox-lease-reclaim] failed for build ${lease.buildId}:`, err);
    }
  }
  return result;
}

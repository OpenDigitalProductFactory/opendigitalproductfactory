/**
 * Build Studio Stall Detection watchdog cron (BI-4ab6be39 slices C3-C5).
 *
 * Fires every minute. Strategy: coarse-fetch in SQL using the SMALLEST
 * threshold across phases, then filter per-phase in app code — keeps the
 * threshold rows operator-editable at runtime without re-deploying SQL.
 *
 * For each detected stall, in one transaction per row:
 *   - TaskRun.status = "stalled", completedAt = now
 *   - StallEvent row written with reason + observed values + thresholds
 *   - BuildActivity row (when buildId present) so the Build Studio panel reflects it
 *   - Notification to the build owner (or platform admin fallback)
 *
 * After each successful tx, emits a "taskrun:stalled" AgentEvent so live UIs
 * update without polling.
 *
 * See docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md §5.7, §6.2.
 */
import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { decideStall, type WatchdogCandidate, type StallDecision } from "@/lib/observability/watchdog-detect";
import { isStallWatchdogEnabled } from "@/lib/shared/feature-flags";

export const taskrunWatchdog = inngest.createFunction(
  {
    id: "ops/taskrun-watchdog",
    retries: 0,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("* * * * *")],
  },
  async () => {
    if (!(await isStallWatchdogEnabled())) {
      return { skipped: true, reason: "flag-off" };
    }

    const { prisma } = await import("@dpf/db");

    const thresholds = await prisma.buildStudioStallThreshold.findMany();
    if (thresholds.length === 0) {
      return { skipped: true, reason: "no-thresholds-seeded" };
    }

    // Coarse SQL filter using the smallest applicable thresholds across all
    // phases. Anything stricter is filtered out in app code below.
    const minHeartbeatS = Math.min(...thresholds.map((t) => t.heartbeatTimeoutSeconds));
    const minTotalS = Math.min(...thresholds.map((t) => t.totalPhaseTimeoutSeconds));

    const candidates = await prisma.$queryRaw<WatchdogCandidate[]>`
      SELECT tr."taskRunId" AS "taskRunId",
             tr."buildId" AS "buildId",
             fb.phase AS "phase",
             tr."startedAt" AS "startedAt",
             tr."lastHeartbeatAt" AS "lastHeartbeatAt"
      FROM "TaskRun" tr
      LEFT JOIN "FeatureBuild" fb ON tr."buildId" = fb."buildId"
      -- Catches both the canonical "working" state AND the legacy "active"
      -- value still written by deliberation-run.ts and any other paths that
      -- haven't been migrated. They mean the same thing semantically (work
      -- in flight, not terminal). Audited 2026-05-20.
      WHERE tr.status IN ('working', 'active')
        AND (
          tr."lastHeartbeatAt" IS NULL
          OR now() - tr."lastHeartbeatAt" > make_interval(secs => ${minHeartbeatS})
          OR now() - tr."startedAt" > make_interval(secs => ${minTotalS})
        )
    `;

    const now = new Date();
    const thresholdByScope = new Map(thresholds.map((t) => [t.scope, t]));
    const defaultRow = thresholdByScope.get("default");

    const decisions: StallDecision[] = [];
    for (const c of candidates) {
      const scope = c.phase ? `phase.${c.phase}` : "default";
      const t = thresholdByScope.get(scope) ?? defaultRow;
      if (!t) continue; // Unreachable given the seed invariant; skip defensively.
      const decision = decideStall(
        c,
        {
          scope,
          heartbeatTimeoutSeconds: t.heartbeatTimeoutSeconds,
          totalPhaseTimeoutSeconds: t.totalPhaseTimeoutSeconds,
        },
        now,
      );
      if (decision) decisions.push(decision);
    }

    if (decisions.length === 0) {
      return { processed: 0 };
    }

    // Batch id-resolution: business taskRunId → cuid id for FK writes.
    const businessIds = decisions.map((d) => d.candidate.taskRunId);
    const idRows = await prisma.taskRun.findMany({
      where: { taskRunId: { in: businessIds } },
      select: { id: true, taskRunId: true, userId: true },
    });
    const idMap = new Map(idRows.map((r) => [r.taskRunId, { id: r.id, userId: r.userId }]));

    let processed = 0;
    for (const d of decisions) {
      const idEntry = idMap.get(d.candidate.taskRunId);
      if (!idEntry) continue; // row deleted between fetch and tx — safe to skip
      const cuid = idEntry.id;

      // Resolve notification recipient: build owner if buildId present, else
      // task user. If neither resolves, skip notification — the StallEvent
      // row is the durable record.
      let notifyUserId: string | null = idEntry.userId ?? null;
      if (d.candidate.buildId) {
        const fb = await prisma.featureBuild.findUnique({
          where: { buildId: d.candidate.buildId },
          select: { createdById: true },
        });
        if (fb?.createdById) notifyUserId = fb.createdById;
      }

      await prisma.$transaction(async (tx) => {
        // 1. Transition TaskRun.
        await tx.taskRun.update({
          where: { taskRunId: d.candidate.taskRunId },
          data: { status: "stalled", completedAt: now },
        });

        // 2. StallEvent audit row.
        await tx.stallEvent.create({
          data: {
            taskRunId: cuid,
            buildId: d.candidate.buildId,
            phase: d.candidate.phase,
            reason: d.reason,
            lastHeartbeatAt: d.candidate.lastHeartbeatAt,
            startedAt: d.candidate.startedAt,
            thresholdHeartbeatS: d.threshold.heartbeatTimeoutSeconds,
            thresholdTotalS: d.threshold.totalPhaseTimeoutSeconds,
          },
        });

        // 3. BuildActivity row when this stall is tied to a build.
        if (d.candidate.buildId) {
          await tx.buildActivity.create({
            data: {
              buildId: d.candidate.buildId,
              tool: "watchdog:stall",
              summary: `Watchdog detected stall (${d.reason}) in phase ${d.candidate.phase ?? "—"}`,
            },
          });
        }

        // 4. Notification.
        if (notifyUserId) {
          await tx.notification.create({
            data: {
              userId: notifyUserId,
              type: "taskrun.stalled",
              title: `Task stalled in ${d.candidate.phase ?? "unknown"} phase`,
              body: `Watchdog detected ${d.reason} after ${d.threshold.heartbeatTimeoutSeconds}s heartbeat / ${d.threshold.totalPhaseTimeoutSeconds}s total budget.`,
              deepLink: d.candidate.buildId ? `/build` : `/platform/ai/operations`,
            },
          });
        }
      });

      // 5. Emit AgentEvent for live-UI subscribers (outside the tx — best
      //    effort; failure to emit must not roll back the audit row).
      try {
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        agentEventBus.emit("watchdog", {
          type: "taskrun:stalled",
          taskRunId: d.candidate.taskRunId,
          buildId: d.candidate.buildId,
          phase: d.candidate.phase,
          reason: d.reason,
        });
      } catch (err) {
        console.warn("[taskrun-watchdog] event emit failed:", err);
      }

      processed += 1;
    }

    return { processed };
  },
);

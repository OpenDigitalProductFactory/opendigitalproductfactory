/**
 * Heartbeat substrate for BI-4ab6be39 (stall detection).
 *
 * Three exports:
 *   - heartbeat(taskRunId): cooperative write of lastHeartbeatAt by long-running
 *     loops. Returns false if the row is no longer in "working" — caller can
 *     treat that as cooperative cancellation.
 *   - markTaskRunWorking(taskRunId): canonical sanctioned entry point for new
 *     code to transition a TaskRun into the working state. Sets lastHeartbeatAt
 *     atomically so the watchdog's "never_started" branch doesn't false-positive
 *     on the gap between transition and first work.
 *   - withHeartbeatTicker(taskRunId, fn): wrapper for opaque long calls that
 *     have no natural emission boundary. Runs fn while emitting heartbeats at
 *     (resolved heartbeatTimeoutSeconds / 3) cadence so three ticks fit inside
 *     a timeout window (one missed = jitter, two missed = suspicious, three
 *     missed trips the watchdog).
 *
 * See docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md §5.6, §6.1.
 */
import { prisma, type Prisma } from "@dpf/db";
import { TASK_LIVE_STATES } from "@/lib/tak/task-states";
import { resolveThresholdForTaskRun } from "./threshold-lookup";

export async function heartbeat(taskRunId: string): Promise<boolean> {
  // Best-effort. The heartbeat is observability plumbing — a transient DB
  // hiccup or an incomplete test mock must not crash the long-running loop
  // that called us. Failure is logged and surfaces as "alive=true" so the
  // caller doesn't treat it as a cooperative-cancel signal.
  //
  // Filter accepts both "working" (canonical A2A) and "active" (legacy
  // value still written by deliberation-run.ts and a couple of paths that
  // haven't been migrated). The watchdog uses the same dual-state filter.
  try {
    const result = await prisma.taskRun.updateMany({
      where: { taskRunId, status: { in: [...TASK_LIVE_STATES] } },
      data: { lastHeartbeatAt: new Date() },
    });
    return result.count > 0;
  } catch (err) {
    // Pass taskRunId as a separate console arg (not interpolated into the
    // format string) to satisfy CodeQL's externally-controlled-format-string
    // rule. console APIs treat the first arg as a format string in some
    // runtimes; keeping it a literal avoids the warning.
    console.warn("[heartbeat] write failed for %s: %s",
      JSON.stringify(taskRunId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)));
    return true;
  }
}

export async function markTaskRunWorking(taskRunId: string): Promise<void> {
  await prisma.taskRun.update({
    where: { taskRunId },
    data: { status: "working", lastHeartbeatAt: new Date() },
  });
}

/**
 * Reserve one exact submitted TaskRun generation for work. The compare-and-set
 * and first heartbeat share one write so the watchdog can never observe a new
 * working state without liveness evidence.
 */
export async function reserveSubmittedTaskRunWorking(input: {
  taskRunId: string;
  updatedAt: Date;
  progressPayload: Prisma.InputJsonValue;
}): Promise<boolean> {
  const result = await prisma.taskRun.updateMany({
    where: {
      taskRunId: input.taskRunId,
      status: "submitted",
      updatedAt: input.updatedAt,
    },
    data: {
      status: "working",
      lastHeartbeatAt: new Date(),
      completedAt: null,
      progressPayload: input.progressPayload,
    },
  });
  return result.count === 1;
}

export async function withHeartbeatTicker<T>(
  taskRunId: string,
  fn: () => Promise<T>,
  _intervalMsForTests?: number,
): Promise<T> {
  // Best-effort threshold lookup — same resilience contract as heartbeat().
  // A transient DB hiccup or incomplete test mock must not crash the
  // long-running loop this wraps. Fall back to a safe default (60s tick)
  // so the wrapper still emits heartbeats even when the lookup fails.
  let intervalMs = _intervalMsForTests ?? 60_000;
  if (_intervalMsForTests === undefined) {
    try {
      const threshold = await resolveThresholdForTaskRun(taskRunId);
      intervalMs = Math.floor(threshold.heartbeatTimeoutSeconds * 1000 / 3);
    } catch (err) {
      console.warn(
        "[withHeartbeatTicker] threshold lookup failed for %s using 60s default — %s",
        JSON.stringify(taskRunId),
        err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
      );
    }
  }
  const handle = setInterval(() => {
    void heartbeat(taskRunId);
  }, intervalMs);
  try {
    return await fn();
  } finally {
    clearInterval(handle);
  }
}

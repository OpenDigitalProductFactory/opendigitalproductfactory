// Agent-task dispatch lanes (BI-6DBA2238).
//
// The agent-task dispatcher used to run due tasks one at a time, so neither a
// coworker's concurrency limit (AgentExecutionConfig.concurrencyLimit, seeded
// from agent_registry `concurrency_limit`) nor the shared CLI slot pool
// (DPF_CLI_MAX_CONCURRENCY, default 4) was ever reached. This module turns a
// batch of due tasks into concurrent lanes: lanes run in parallel, each lane runs
// its tasks in order, and a coworker's tasks are confined to at most
// `concurrencyLimit` lanes, so at most that many of them run at once.
//
// Lane assignment is a pure, deterministic function of the batch. A durable job
// replays its handler from the top, so the same input must give the same lanes
// for step ids to line up.

import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import { isWeeklyQuotaFresh } from "@/lib/routing/weekly-quota";
import type { CliPoolState } from "@/lib/routing/cli-pool-status";

/** Due tasks taken per dispatcher run — unchanged from the serial dispatcher. */
export const AGENT_TASK_DISPATCH_BATCH = 20;

export type DueAgentTask = { taskId: string; agentId: string };

export type CliSlotStats = { inFlight: number; queued: number; max: number };

/**
 * Provider slots free for new agent tasks, from the existing capacity signals:
 * the CLI rate-limit pool rows (getAllCliPoolStatuses — the same rows the
 * capacity drain reads) and the in-process CLI slot gate (cliConcurrencyStats).
 *
 * A pool the signal reports exhausted — rate-limited now, or a fresh weekly
 * reading at or past its allocation — gives ONE slot: the serial behaviour this
 * dispatcher always had, so a constrained provider is never fanned into. The
 * floor of one keeps today's progress when the gate is saturated; that task
 * queues for its CLI slot as it always did.
 *
 * A pool with a known dated reset (a Codex "try again at <date>" cap or a
 * Claude "resets Oct 20, 4pm (UTC)" weekly limit) reads exhausted until that
 * reset, not for a one-hour cooldown (BI-0319EE11): getAllCliPoolStatuses
 * reconciles the pool row with the provider's quota_resets_at capacity.
 */
export function providerSlotsFromCapacity(input: {
  pools: Array<Pick<CliPoolState, "isExhausted" | "weeklyUtilization" | "weeklyObservedAt">>;
  cli: CliSlotStats;
  now: Date;
}): number {
  const exhausted = input.pools.some(
    (p) =>
      p.isExhausted ||
      (p.weeklyUtilization != null &&
        p.weeklyObservedAt != null &&
        p.weeklyUtilization >= 1 &&
        isWeeklyQuotaFresh(
          { utilization: p.weeklyUtilization, observedAt: p.weeklyObservedAt, resetAt: null, source: "anthropic-unified-headers" },
          input.now,
        )),
  );
  if (exhausted) return 1;
  return Math.max(1, Math.floor(input.cli.max - input.cli.inFlight - input.cli.queued));
}

function validLimit(limit: number): number {
  return Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
}

/**
 * Assign due tasks (in due order) to at most `providerSlots` lanes. Each task
 * goes to the least-loaded lane it may use: any lane while its coworker is
 * below its limit, otherwise one of the lanes that coworker already occupies.
 * Ties go to the lowest lane index, so the result is deterministic.
 */
export function planDispatchLanes(
  tasks: DueAgentTask[],
  opts: { providerSlots: number; agentLimit: (agentId: string) => number },
): string[][] {
  const laneCount = Math.min(validLimit(opts.providerSlots), tasks.length);
  const lanes: string[][] = Array.from({ length: laneCount }, () => []);
  const lanesByAgent = new Map<string, Set<number>>();
  for (const task of tasks) {
    const used = lanesByAgent.get(task.agentId) ?? new Set<number>();
    const candidates = used.size < validLimit(opts.agentLimit(task.agentId))
      ? lanes.map((_, i) => i)
      : [...used];
    let best = candidates[0]!;
    for (const i of candidates) {
      if (lanes[i]!.length < lanes[best]!.length || (lanes[i]!.length === lanes[best]!.length && i < best)) best = i;
    }
    lanes[best]!.push(task.taskId);
    used.add(best);
    lanesByAgent.set(task.agentId, used);
  }
  return lanes.filter((lane) => lane.length > 0);
}

type AgentLimitReader = {
  agent: {
    findMany(args: {
      where: { agentId: { in: string[] } };
      select: { agentId: true; executionConfig: { select: { concurrencyLimit: true } } };
    }): Promise<Array<{ agentId: string; executionConfig: { concurrencyLimit: number } | null }>>;
  };
};

/**
 * Each task agent's concurrency limit. A task names its coworker by slug
 * (build-specialist) while the execution config hangs off the canonical AGT-*
 * row (AGT-WS-BUILD), so the slug's own config wins and the canonical row's is
 * the fallback. No config anywhere means 1 — the serial behaviour.
 */
export async function loadAgentConcurrencyLimits(
  db: AgentLimitReader,
  agentIds: string[],
): Promise<Record<string, number>> {
  const unique = [...new Set(agentIds)];
  const canonicalOf = new Map(unique.map((id) => [id, resolveCanonicalAgentId(id)]));
  const lookup = [...new Set([...unique, ...canonicalOf.values()])];
  const rows = await db.agent.findMany({
    where: { agentId: { in: lookup } },
    select: { agentId: true, executionConfig: { select: { concurrencyLimit: true } } },
  });
  const configured = new Map(
    rows.filter((r) => r.executionConfig).map((r) => [r.agentId, r.executionConfig!.concurrencyLimit]),
  );
  return Object.fromEntries(
    unique.map((id) => [id, validLimit(configured.get(id) ?? configured.get(canonicalOf.get(id)!) ?? 1)]),
  );
}

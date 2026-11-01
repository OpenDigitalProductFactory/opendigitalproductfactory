// A per-tick dispatch cap for the Workroom drive (BI-7C0B2BD6, WWMD DI-7109D22D4812).
//
// Releasing the writeback latch made about 340 rooms dispatchable at once on
// the live install (2026-10-14), each a model-backed agent run. The cap is the
// provider slot count the agent-task dispatcher already derives from the CLI
// pool rows the capacity drain reads and the in-process CLI slot gate
// (agent-task-dispatch-lanes.ts providerSlotsFromCapacity). No new capacity source.
//
// Rooms past the cap stay dispatchable. Their plan becomes do_not_wake /
// awaiting_agent_capacity, which concludes in motion ("waiting for agent
// capacity") and dispatches on a later tick. ORDER: the drive has no hook into
// the demand start ranking (lib/demand/start-ranking.ts ranks backlog items
// for the governed tee-up; drive rooms carry no demand score in hand), so the
// drive goes oldest-waiting first: by when each room entered its current hold,
// never-driven rooms first, then by capsule id.
//
// Pure: the caller reads the pools and passes them in.

import { providerSlotsFromCapacity, type CliSlotStats } from "@/lib/queue/agent-task-dispatch-lanes";
import type { CliPoolState } from "@/lib/routing/cli-pool-status";
import { isRecord } from "@/lib/shared/coerce";

import type { DrivePlan } from "./drive-resolution";

export const AWAITING_AGENT_CAPACITY_REASON = "awaiting_agent_capacity" as const;

export type DriveDispatchCapacity = { cap: number; reason: string };

/**
 * How many agent dispatches this tick may start, and why: the provider slots
 * the agent-task dispatcher itself runs with (providerSlotsFromCapacity,
 * BI-6DBA2238), so the drive never queues faster than tasks can run. One
 * derivation, shared: an exhausted pool gives the dispatcher's serial one.
 */
export function driveDispatchCapacity(input: {
  pools: ReadonlyArray<Pick<CliPoolState, "isExhausted" | "weeklyUtilization" | "weeklyObservedAt">>;
  cli: CliSlotStats;
  now: Date;
}): DriveDispatchCapacity {
  const cap = providerSlotsFromCapacity({ pools: [...input.pools], cli: input.cli, now: input.now });
  const limited = input.pools.some((pool) => pool.isExhausted);
  return {
    cap,
    reason: limited
      ? "an agent pool is rate-limited, so one at a time"
      : `${cap} free agent slot(s) of ${input.cli.max}`,
  };
}

/**
 * An admission gate for one tick: dispatch plans pass until the cap is used,
 * then become a wait for agent capacity. Every other plan passes untouched.
 */
export function createDispatchAdmission(capacity: DriveDispatchCapacity): (plan: DrivePlan) => DrivePlan {
  let admitted = 0;
  return (plan) => {
    // A graph room's plan dispatches per token and is not capped here; graph rooms are few.
    if (plan.action !== "dispatch_agent" || plan.tokens) return plan;
    if (admitted < capacity.cap) {
      admitted += 1;
      return plan;
    }
    return {
      ...plan,
      action: "do_not_wake",
      reason: AWAITING_AGENT_CAPACITY_REASON,
      taskId: null,
      agentId: null,
      ledger: [
        `Stage ${plan.stageKey ?? "unknown"} is ready to dispatch, waiting for agent capacity: this tick allowed ${capacity.cap} (${capacity.reason}). It goes on a later tick, oldest-waiting rooms first.`,
      ],
    };
  };
}

function holdSince(workspaceState: unknown): string {
  const drive = isRecord(workspaceState) && isRecord(workspaceState.workroomDrive) ? workspaceState.workroomDrive : null;
  const hold = isRecord(drive?.hold) ? drive.hold : null;
  return typeof hold?.since === "string" ? hold.since : "";
}

/** Rooms ordered oldest-waiting first: by when each entered its current hold (never-driven first), then by id. */
export function orderRoomsOldestWaitingFirst<R extends { capsuleId: string; workspaceState: unknown }>(rooms: readonly R[]): R[] {
  return [...rooms].sort((left, right) => {
    const a = holdSince(left.workspaceState);
    const b = holdSince(right.workspaceState);
    if (a !== b) return a < b ? -1 : 1;
    return left.capsuleId.localeCompare(right.capsuleId);
  });
}

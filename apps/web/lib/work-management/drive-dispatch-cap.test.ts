// A per-tick dispatch cap for the drive (BI-7C0B2BD6, WWMD DI-7109D22D4812).
//
// Releasing the writeback latch makes about 340 rooms dispatchable at once on
// the live install. The cap is the provider slot count the agent-task
// dispatcher already runs with; rooms past it stay dispatchable and go on
// later ticks, oldest-waiting first.

import { describe, expect, it } from "vitest";

import type { CliPoolState } from "@/lib/routing/cli-pool-status";

import {
  AWAITING_AGENT_CAPACITY_REASON,
  createDispatchAdmission,
  driveDispatchCapacity,
  orderRoomsOldestWaitingFirst,
} from "./drive-dispatch-cap";
import type { DrivePlan } from "./drive-resolution";

const NOW = new Date("2026-10-14T05:00:00.000Z");

function pool(over: Partial<CliPoolState> = {}): CliPoolState {
  return {
    adapterType: "claude-cli", providerId: "p", rateLimitedAt: NOW, resetAt: null, retryAfterSeconds: null, errorSnippet: null,
    isExhausted: false, secondsUntilReset: null, weeklyUtilization: null, weeklyResetAt: null, weeklySource: null, weeklyObservedAt: null,
    ...over,
  };
}

function dispatch(roomId: string): DrivePlan {
  return {
    action: "dispatch_agent", reason: "agent_stage", roomId, shapeKey: "delivery-small", shapeVersion: "1.0.0", definition: null,
    stageKey: "implement", accountablePrincipalRef: "agent:a", agentId: "a", attentionPrincipalRef: null,
    taskId: `workroom-${roomId}-delivery-small`, conformance: null, cycle: null, deviations: [], ledger: ["Dispatch agent:a for stage implement."],
  };
}

describe("driveDispatchCapacity (the dispatcher's own provider slots, BI-6DBA2238)", () => {
  const cli = (over: Partial<{ inFlight: number; queued: number; max: number }> = {}) => ({ inFlight: 0, queued: 0, max: 4, ...over });

  it("allows the free CLI slots when the pools are healthy", () => {
    expect(driveDispatchCapacity({ pools: [pool()], cli: cli({ inFlight: 1 }), now: NOW }).cap).toBe(3);
  });

  it("allows one at a time while any CLI pool is rate-limited, as the dispatcher does", () => {
    const capacity = driveDispatchCapacity({ pools: [pool(), pool({ adapterType: "codex-cli", isExhausted: true })], cli: cli(), now: NOW });
    expect(capacity.cap).toBe(1);
    expect(capacity.reason).toMatch(/rate-limited/);
  });

  it("never drops below one, so a saturated gate still moves", () => {
    expect(driveDispatchCapacity({ pools: [], cli: cli({ inFlight: 4, queued: 3 }), now: NOW }).cap).toBe(1);
  });
});

describe("createDispatchAdmission", () => {
  it("admits dispatches up to the cap and turns the rest into an honest wait for agent capacity", () => {
    const admit = createDispatchAdmission({ cap: 2, reason: "pools healthy" });
    const plans = ["A", "B", "C"].map((id) => admit(dispatch(id)));
    expect(plans.slice(0, 2).map((plan) => plan.action)).toEqual(["dispatch_agent", "dispatch_agent"]);
    expect(plans[2]).toMatchObject({ action: "do_not_wake", reason: AWAITING_AGENT_CAPACITY_REASON, taskId: null, agentId: null, stageKey: "implement" });
    expect(plans[2]!.ledger[0]).toMatch(/waiting for agent capacity/i);
  });

  it("passes every other plan through untouched and does not count it", () => {
    const admit = createDispatchAdmission({ cap: 1, reason: "pools healthy" });
    const pause = { ...dispatch("P"), action: "pause", reason: "executor_writeback_unavailable" } as DrivePlan;
    expect(admit(pause)).toBe(pause);
    expect(admit(dispatch("A")).action).toBe("dispatch_agent");
  });

  it("keeps the writeback retry record on a capped plan", () => {
    const admit = createDispatchAdmission({ cap: 0, reason: "an agent pool is rate-limited" });
    const retry = { stageKey: "implement", cycleKey: null, failures: 1, lastError: "x", lastFailedAt: NOW.toISOString(), countedRunAt: NOW.toISOString() };
    expect(admit({ ...dispatch("A"), writebackRetry: retry }).writebackRetry).toEqual(retry);
  });
});

describe("orderRoomsOldestWaitingFirst", () => {
  it("orders by how long each room has held its current state, never-driven rooms first, then by id", () => {
    const room = (capsuleId: string, since?: string) => ({ capsuleId, workspaceState: since ? { workroomDrive: { hold: { key: "k", since } } } : {} });
    const ordered = orderRoomsOldestWaitingFirst([
      room("WC-3", "2026-10-14T03:00:00.000Z"), room("WC-2", "2026-10-14T01:00:00.000Z"), room("WC-NEW"), room("WC-1", "2026-10-14T01:00:00.000Z"),
    ]);
    expect(ordered.map((r) => r.capsuleId)).toEqual(["WC-NEW", "WC-1", "WC-2", "WC-3"]);
  });
});

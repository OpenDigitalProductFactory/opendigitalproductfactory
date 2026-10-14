// BI-6DBA2238: due agent tasks run in concurrent lanes bounded by the lower of
// the coworker's concurrency limit and the provider slots the capacity signal
// reports free — not one at a time.
import { describe, expect, it } from "vitest";
import { planDispatchLanes, providerSlotsFromCapacity } from "./agent-task-dispatch-lanes";

const NOW = new Date("2026-10-14T06:00:00Z");
const idle = { inFlight: 0, queued: 0, max: 4 };
const healthy = { isExhausted: false, weeklyUtilization: null, weeklyObservedAt: null };

/** How many lanes carry each agent — the most of its tasks that can run at once. */
function maxConcurrentPerAgent(lanes: string[][], agentOf: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const lane of lanes) {
    for (const agent of new Set(lane.map((t) => agentOf[t]!))) out[agent] = (out[agent] ?? 0) + 1;
  }
  return out;
}

describe("providerSlotsFromCapacity", () => {
  it("offers the CLI pool's free slots when no pool is exhausted", () => {
    expect(providerSlotsFromCapacity({ pools: [healthy], cli: idle, now: NOW })).toBe(4);
    expect(providerSlotsFromCapacity({ pools: [], cli: { inFlight: 1, queued: 0, max: 4 }, now: NOW })).toBe(3);
  });

  it("never drops below one slot, so a saturated pool still makes today's serial progress", () => {
    expect(providerSlotsFromCapacity({ pools: [], cli: { inFlight: 4, queued: 3, max: 4 }, now: NOW })).toBe(1);
  });

  it("runs serially when the pool reports a provider exhausted", () => {
    expect(providerSlotsFromCapacity({ pools: [{ ...healthy, isExhausted: true }], cli: idle, now: NOW })).toBe(1);
  });

  it("treats a fresh weekly reading at or past the allocation as exhausted, and ignores a stale one", () => {
    const spent = { isExhausted: false, weeklyUtilization: 1, weeklyObservedAt: new Date(NOW.getTime() - 60_000) };
    expect(providerSlotsFromCapacity({ pools: [spent], cli: idle, now: NOW })).toBe(1);
    const stale = { ...spent, weeklyObservedAt: new Date(NOW.getTime() - 3 * 60 * 60_000) };
    expect(providerSlotsFromCapacity({ pools: [stale], cli: idle, now: NOW })).toBe(4);
  });
});

describe("planDispatchLanes", () => {
  it("returns no lanes for no tasks", () => {
    expect(planDispatchLanes([], { providerSlots: 4, agentLimit: () => 4 })).toEqual([]);
  });

  it("spreads independent agents across every provider slot", () => {
    const tasks = ["a", "b", "c", "d", "e", "f"].map((id) => ({ taskId: id, agentId: `agent-${id}` }));
    const lanes = planDispatchLanes(tasks, { providerSlots: 4, agentLimit: () => 4 });
    expect(lanes).toHaveLength(4);
    expect(lanes.flat().sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("caps one coworker at its concurrency limit even when more slots are free", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({ taskId: `t${i}`, agentId: "build-specialist" }));
    const lanes = planDispatchLanes(tasks, { providerSlots: 4, agentLimit: () => 2 });
    const agentOf = Object.fromEntries(tasks.map((t) => [t.taskId, t.agentId]));
    expect(maxConcurrentPerAgent(lanes, agentOf)["build-specialist"]).toBe(2);
    expect(lanes.flat()).toHaveLength(10);
  });

  it("caps the whole batch at the provider slots", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({ taskId: `t${i}`, agentId: `agent-${i}` }));
    expect(planDispatchLanes(tasks, { providerSlots: 3, agentLimit: () => 8 })).toHaveLength(3);
  });

  it("is serial with one provider slot, preserving due order", () => {
    const tasks = [
      { taskId: "x", agentId: "a" },
      { taskId: "y", agentId: "b" },
      { taskId: "z", agentId: "a" },
    ];
    expect(planDispatchLanes(tasks, { providerSlots: 1, agentLimit: () => 4 })).toEqual([["x", "y", "z"]]);
  });

  it("lets other coworkers use the slots one coworker's limit leaves free", () => {
    const tasks = [
      ...Array.from({ length: 6 }, (_, i) => ({ taskId: `b${i}`, agentId: "build-specialist" })),
      { taskId: "f0", agentId: "finance-controller" },
      { taskId: "f1", agentId: "finance-controller" },
    ];
    const lanes = planDispatchLanes(tasks, { providerSlots: 4, agentLimit: (a) => (a === "build-specialist" ? 2 : 4) });
    const agentOf = Object.fromEntries(tasks.map((t) => [t.taskId, t.agentId]));
    expect(maxConcurrentPerAgent(lanes, agentOf)["build-specialist"]).toBe(2);
    expect(lanes).toHaveLength(4);
    expect(lanes.flat()).toHaveLength(8);
  });

  it("treats a missing or invalid limit as one", () => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({ taskId: `t${i}`, agentId: "x" }));
    expect(planDispatchLanes(tasks, { providerSlots: 4, agentLimit: () => 0 })).toEqual([["t0", "t1", "t2"]]);
    expect(planDispatchLanes(tasks, { providerSlots: 4, agentLimit: () => Number.NaN })).toEqual([["t0", "t1", "t2"]]);
  });
});

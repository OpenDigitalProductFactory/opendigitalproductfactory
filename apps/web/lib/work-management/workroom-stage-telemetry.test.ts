import { describe, expect, it } from "vitest";

import { reconstructTimelines, buildSnapshotRow } from "@/lib/queue/queue-metrics-rollup";

import {
  planStageTransitions,
  readDriveObservation,
  workroomStageLiveCounts,
  workroomStageQueueKey,
  type DriveObservation,
} from "./workroom-stage-telemetry";

const SHAPE = "dependency-advisory-watch@1.0.0";
const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 10, minute));
const obs = (action: string, reason: string, stageKey: string | null, cycleKey = "2026-10-07"): DriveObservation => ({
  action,
  reason,
  stageKey,
  cycleKey,
});
const plan = (prior: DriveObservation | null, next: DriveObservation, minute = 0) =>
  planStageTransitions({ capsuleId: "WC-1", shapeRef: SHAPE, prior, next, at: at(minute) });
const compact = (transitions: ReturnType<typeof plan>) =>
  transitions.map((t) => [t.queueKey.split(":").pop(), t.transition, t.outcome ?? t.laneKey ?? null]);

describe("planStageTransitions — a stage is a queue", () => {
  it("enters a stage being worked: enqueued then started, under the shape-version stage key", () => {
    const out = plan(null, obs("dispatch_agent", "agent_stage", "sweep"));
    expect(compact(out)).toEqual([["sweep", "enqueued", null], ["sweep", "started", null]]);
    expect(out[0]!.queueKey).toBe("wr:dependency-advisory-watch@1.0.0:sweep");
    expect(out[0]!.itemId).toBe("WC-1:2026-10-07");
    expect(out[1]!.actorType).toBe("ai-agent");
  });

  it("enters a stage waiting on a person as a held item, attributed to a human", () => {
    const out = plan(null, obs("attention", "role_stage", "decide"));
    expect(compact(out)).toEqual([["decide", "enqueued", null], ["decide", "held", "awaiting-person"]]);
    expect(out[1]!.actorType).toBe("human");
  });

  it("moving to the next stage finishes the last one and enters the next", () => {
    const out = plan(obs("dispatch_agent", "agent_stage", "sweep"), obs("dispatch_agent", "agent_stage", "raise"));
    expect(compact(out)).toEqual([
      ["sweep", "finished", "success"],
      ["raise", "enqueued", null],
      ["raise", "started", null],
    ]);
  });

  it("releases a hold before leaving a stage that was waiting", () => {
    const out = plan(obs("attention", "governed_decision", "decide"), obs("stop", "success", null));
    expect(compact(out)).toEqual([["decide", "released", null], ["decide", "finished", "success"]]);
  });

  it("records a refusal routed to a stop as a failed finish", () => {
    const out = plan(obs("attention", "governed_decision", "decide"), obs("stop", "refused_to_stop", null));
    expect(compact(out).at(-1)).toEqual(["decide", "finished", "failed"]);
  });

  it("holds the current stage when the drive pauses without naming one, with the cause", () => {
    const out = plan(obs("dispatch_agent", "agent_stage", "raise"), obs("pause", "conformance_pause", null));
    expect(compact(out)).toEqual([["raise", "held", "conformance_pause"]]);
  });

  it("switches hold cause as a release and a new hold", () => {
    const out = plan(obs("pause", "conformance_pause", "raise"), obs("pause", "executor_writeback_unavailable", "raise"));
    expect(compact(out)).toEqual([["raise", "released", null], ["raise", "held", "executor_writeback_unavailable"]]);
  });

  it("resumes work after a hold: released then started", () => {
    const out = plan(obs("pause", "conformance_pause", "raise"), obs("dispatch_agent", "agent_stage", "raise"));
    expect(compact(out)).toEqual([["raise", "released", null], ["raise", "started", null]]);
  });

  it("emits nothing when the state did not change", () => {
    expect(plan(obs("dispatch_agent", "agent_stage", "raise"), obs("dispatch_agent", "lease_held", "raise"))).toEqual([]);
  });

  it("a finished cycle completes its stage; the idle gap after it is not measured", () => {
    const done = plan(obs("dispatch_agent", "agent_stage", "raise"), obs("do_not_wake", "cycle_complete", null));
    expect(compact(done)).toEqual([["raise", "finished", "success"]]);
    expect(plan(obs("do_not_wake", "cycle_complete", null), obs("do_not_wake", "quiet", null))).toEqual([]);
  });

  it("a new cycle is a new item even on the same stage", () => {
    const out = plan(obs("dispatch_agent", "agent_stage", "sweep", "2026-10-06"), obs("dispatch_agent", "agent_stage", "sweep", "2026-10-07"));
    expect(out.map((t) => t.itemId)).toEqual(["WC-1:2026-10-06", "WC-1:2026-10-07", "WC-1:2026-10-07"]);
  });

  it("refuses to guess: no shape, an unknown reason, or no stage to name means no transition", () => {
    expect(planStageTransitions({ capsuleId: "WC-1", shapeRef: null, prior: null, next: obs("dispatch_agent", "agent_stage", "sweep"), at: at(0) })).toEqual([]);
    expect(plan(null, obs("pause", "not_a_reason", "sweep"))).toEqual([]);
    expect(plan(null, obs("pause", "conformance_pause", null))).toEqual([]);
  });
});

describe("the queue math reads the stage's time correctly", () => {
  it("separates touch time from holds and reports wait as the rest of the dwell", () => {
    // Enter at :00 working; held on a person :10–:40; resumed; left at :50.
    const transitions = [
      ...plan(null, obs("dispatch_agent", "agent_stage", "decide"), 0),
      ...plan(obs("dispatch_agent", "agent_stage", "decide"), obs("attention", "role_stage", "decide"), 10),
      ...plan(obs("attention", "role_stage", "decide"), obs("dispatch_agent", "agent_stage", "decide"), 40),
      ...plan(obs("dispatch_agent", "agent_stage", "decide"), obs("stop", "success", null), 50),
    ];
    const rows = transitions.map((t) => ({ ...t, outcome: t.outcome }));
    const [timeline] = reconstructTimelines(rows);
    expect(timeline!.startedAt).toEqual(at(0)); // the first start wins
    const row = buildSnapshotRow(transitions[0]!.queueKey, "2026-10-07", rows, { depth: 0, wip: 0 });
    expect(row.cycleP50Ms).toBe(50 * 60_000);
    expect(row.processP50Ms).toBe(20 * 60_000);
    expect(row.waitP50Ms).toBe(30 * 60_000);
    expect(row.heldP50Ms).toBe(30 * 60_000);
    expect(row.processShare).toBeCloseTo(0.4);
  });

  it("counts a multi-day stage once, in the window it finished, over its whole life", () => {
    const enter = plan(null, obs("attention", "role_stage", "decide"), 0).map((t) => ({ ...t, occurredAt: new Date(Date.UTC(2026, 9, 5, 9)) }));
    const leave = plan(obs("attention", "role_stage", "decide"), obs("stop", "success", null), 0);
    const window = { start: new Date(Date.UTC(2026, 9, 7)), end: new Date(Date.UTC(2026, 9, 8)) };
    const row = buildSnapshotRow(enter[0]!.queueKey, "2026-10-07", [...enter, ...leave], { depth: 0, wip: 0 }, window);
    expect(row.arrivals).toBe(0); // it arrived two days earlier
    expect(row.throughput).toBe(1);
    expect(row.cycleP50Ms).toBe(at(0).getTime() - Date.UTC(2026, 9, 5, 9));
  });
});

describe("workroomStageLiveCounts", () => {
  const room = (action: string, reason: string, stageKey: string | null, shape = `${SHAPE}`) => ({
    scopeClaims: [{ workShape: shape }],
    workspaceState: { workroomDrive: { action, reason, stageKey, lastCycleKey: "c" } },
  });

  it("counts rooms at each stage: WIP is all of them, depth is the ones not being worked", () => {
    const counts = workroomStageLiveCounts([
      room("dispatch_agent", "agent_stage", "raise"),
      room("pause", "conformance_pause", "raise"),
      room("attention", "role_stage", "decide"),
      room("do_not_wake", "cycle_complete", null),
      room("stop", "success", "decide"),
      { scopeClaims: [], workspaceState: { workroomDrive: { action: "dispatch_agent", reason: "agent_stage", stageKey: "x" } } },
    ]);
    expect(Object.fromEntries(counts)).toEqual({
      [workroomStageQueueKey(SHAPE, "raise")]: { depth: 1, wip: 2 },
      [workroomStageQueueKey(SHAPE, "decide")]: { depth: 1, wip: 1 },
    });
  });
});

describe("readDriveObservation", () => {
  it("reads the persisted drive snapshot and tolerates its absence", () => {
    expect(readDriveObservation({ workroomDrive: { action: "pause", reason: "conformance_pause", stageKey: null, lastCycleKey: "c" } }))
      .toEqual({ action: "pause", reason: "conformance_pause", stageKey: null, cycleKey: "c", detail: null });
    expect(readDriveObservation({})).toBeNull();
    expect(readDriveObservation(null)).toBeNull();
  });
});

describe("emitStageTelemetryForDriveWrite", () => {
  it("is a no-op for graph rooms and never throws", async () => {
    const { emitStageTelemetryForDriveWrite } = await import("./workroom-stage-telemetry");
    await expect(emitStageTelemetryForDriveWrite({
      room: { capsuleId: "WC-1", scopeClaims: [{ workShape: SHAPE }], workspaceState: {} },
      snapshot: { action: "dispatch_agent", reason: "agent_stage", stageKey: "sweep" },
      graphShape: true,
      at: at(0),
    })).resolves.toBeUndefined();
  });
});

describe("a conformance hold names its deviation", () => {
  it("narrows the cause to the first deviation code and describes it in plain words", async () => {
    const { readDriveObservation, describeHoldCause } = await import("./workroom-stage-telemetry");
    const obs = readDriveObservation({ workroomDrive: {
      action: "pause", reason: "conformance_pause", stageKey: "reproduce", lastCycleKey: null,
      conformance: { deviations: [{ code: "missing_explicit_coordinator", summary: "No coordinator" }] },
    } });
    expect(obs?.detail).toBe("missing_explicit_coordinator");
    const out = planStageTransitions({ capsuleId: "WC-1", shapeRef: SHAPE, prior: obs!, next: { ...obs!, stageKey: "reproduce" }, at: at(0) });
    expect(out).toEqual([]); // unchanged hold
    const entered = planStageTransitions({ capsuleId: "WC-1", shapeRef: SHAPE, prior: null, next: obs!, at: at(0) });
    expect(entered.at(-1)!.laneKey).toBe("conformance_pause:missing_explicit_coordinator");
    expect(describeHoldCause("conformance_pause:missing_explicit_coordinator")).toBe("missing explicit coordinator (conformance pause)");
    expect(describeHoldCause("awaiting-person")).toBe("waiting on a person");
    expect(describeHoldCause("executor_writeback_unavailable")).toBe("executor writeback unavailable");
  });

  it("ignores deviation codes on holds that are not conformance holds", async () => {
    const { readDriveObservation } = await import("./workroom-stage-telemetry");
    const obs = readDriveObservation({ workroomDrive: { action: "pause", reason: "executor_writeback_unavailable", conformance: { deviations: [{ code: "x" }] } } });
    expect(obs?.detail).toBeNull();
  });
});


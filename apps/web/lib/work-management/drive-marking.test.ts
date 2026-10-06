// The drive marking (BI-8875C9DF, GPP Phase 3c PR-3c-1). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §4; plan: docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-1, drive-marking.test.ts).
//
// 1. Reading: absent (derived from stageKey, or the start), stored, from
//    another cycle (fresh start), and malformed (marking_unreadable, verbatim).
// 2. The iteration predicate and the per-token latch prior.
// 3. The forward move on a two-stage flow equals nextStageKey on its
//    sequential twin, over seeded receipt sequences.
// 4. Every construct-specific branch throws construct_not_implemented.

import { describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "./work-shape-prior-versions";
import { listWorkShapes, readWorkShapeDefinitionContract } from "./work-shapes";
import { nextStageKey } from "./drive-resolution";
import {
  DEADLINE_FIXTURE,
  FLOW_TWIN,
  GRAPH_FIXTURES,
  PARALLEL_FIXTURE,
  REFUSE_FIXTURE,
  REWORK_FIXTURE,
  SEQUENTIAL_TWIN,
  SUB_SHAPE_FIXTURE,
} from "./__fixtures__/graph-shape-fixtures";
import {
  DRIVE_MARKING_FORMAT,
  DriveConstructNotImplementedError,
  enabledStages,
  isCompletingAt,
  latchPriorFor,
  markedKeysWithIteration,
  markedStageKeys,
  readStoredDriveMarking,
  startDriveMarking,
  stepDriveMarking,
  usesGraphConstructs,
  type DriveMarking,
} from "./drive-marking";

const NOW = new Date("2026-03-01T09:00:00.000Z");
const CYCLE = "graph-fixture-flow@1.0.0:2026-03-01";

function marking(over: Partial<DriveMarking> = {}): DriveMarking {
  return {
    format: DRIVE_MARKING_FORMAT,
    cycleKey: CYCLE,
    tokens: [{ node: "stage:a", enteredAt: "2026-03-01T08:00:00.000Z" }],
    iterations: {},
    reworkTaken: {},
    deadlines: {},
    children: {},
    ...over,
  };
}

/** mulberry32, as in interpreter-parity.test.ts. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("usesGraphConstructs: the structural branch", () => {
  it("is false for every registry definition", () => {
    for (const shape of [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS]) {
      expect(usesGraphConstructs(readWorkShapeDefinitionContract(shape)), `${shape.key}@${shape.version}`).toBe(false);
    }
    expect(usesGraphConstructs(SEQUENTIAL_TWIN)).toBe(false);
  });

  it("is true for a flow, a deadline, a sub-shape and a refuse route", () => {
    for (const fixture of GRAPH_FIXTURES) expect(usesGraphConstructs(fixture), fixture.key).toBe(true);
  });
});

describe("readStoredDriveMarking", () => {
  it("derives one token from the stored stageKey when no marking is stored", () => {
    const read = readStoredDriveMarking({ workroomDrive: { stageKey: "b", lastRunAt: "2026-03-01T08:30:00.000Z" } }, FLOW_TWIN, CYCLE, NOW);
    expect(read).toEqual({ ok: true, source: "derived", marking: marking({ tokens: [{ node: "stage:b", enteredAt: "2026-03-01T08:30:00.000Z" }] }) });
  });

  it("derives the start when no stage is stored, or the stored stage is not on the shape", () => {
    for (const workspaceState of [{}, { workroomDrive: { stageKey: null } }, { workroomDrive: { stageKey: "gone" } }]) {
      const read = readStoredDriveMarking(workspaceState, FLOW_TWIN, CYCLE, NOW);
      expect(read).toEqual({ ok: true, source: "derived", marking: marking({ tokens: [{ node: "stage:a", enteredAt: NOW.toISOString() }] }) });
    }
  });

  it("returns a valid stored marking of this cycle as stored", () => {
    const stored = marking({ iterations: { a: 1 }, reworkTaken: { "edge:b->a": 1 } });
    expect(readStoredDriveMarking({ workroomDrive: { stageKey: "a", marking: stored } }, FLOW_TWIN, CYCLE, NOW))
      .toEqual({ ok: true, source: "stored", marking: stored });
  });

  it("discards a marking from another cycle and starts fresh at the shape's start", () => {
    const stored = marking({ cycleKey: "graph-fixture-flow@1.0.0:2026-02-28", tokens: [{ node: "stage:b", enteredAt: "2026-02-28T08:00:00.000Z" }], iterations: { b: 2 } });
    const read = readStoredDriveMarking({ workroomDrive: { marking: stored } }, FLOW_TWIN, CYCLE, NOW);
    expect(read).toEqual({ ok: true, source: "new-cycle", marking: marking({ tokens: [{ node: "stage:a", enteredAt: NOW.toISOString() }] }) });
  });

  it("with no current cycle (the runner's receipt earning) keeps the stored cycle", () => {
    const stored = marking({ cycleKey: "graph-fixture-flow@1.0.0:2026-02-28" });
    expect(readStoredDriveMarking({ workroomDrive: { marking: stored } }, FLOW_TWIN, null, NOW)).toMatchObject({ ok: true, source: "stored" });
  });

  it("refuses a malformed marking with marking_unreadable and returns it verbatim", () => {
    const malformed: unknown[] = [
      null,
      "drive-marking/1",
      { ...marking(), format: "drive-marking/2" },
      { ...marking(), cycleKey: 7 },
      { ...marking(), tokens: "stage:a" },
      { ...marking(), tokens: [{ node: "stage:nowhere", enteredAt: NOW.toISOString() }] },
      { ...marking(), tokens: [{ node: "stage:a", enteredAt: "not a date" }] },
      { ...marking(), tokens: [{ node: "stage:a", enteredAt: NOW.toISOString() }, { node: "stage:a", enteredAt: NOW.toISOString() }] },
      { ...marking(), tokens: [{ node: "stage:a", from: "stage:b", enteredAt: NOW.toISOString() }] },
      { ...marking(), iterations: { a: -1 } },
      { ...marking(), reworkTaken: { "edge:b->a": 1.5 } },
      { ...marking(), deadlines: { k: { raisedAt: NOW.toISOString(), notifiedAt: 3 } } },
      { ...marking(), children: { k: { capsuleId: "WC-1" } } },
      { ...marking(), tokens: [{ node: "stage:a", enteredAt: NOW.toISOString(), lastAction: 1 }] },
    ];
    for (const raw of malformed) {
      const read = readStoredDriveMarking({ workroomDrive: { stageKey: "a", marking: raw } }, FLOW_TWIN, CYCLE, NOW);
      expect(read, JSON.stringify(raw)).toEqual({ ok: false, reason: "marking_unreadable", raw });
      if (!read.ok) expect(read.raw).toBe(raw);
    }
  });
});

describe("iterations, enabled stages and the per-token latch", () => {
  it("a receipt completes a stage only at the stage's current iteration", () => {
    const current = marking({ tokens: [{ node: "stage:b", enteredAt: NOW.toISOString() }], iterations: { b: 1 } });
    expect(enabledStages(FLOW_TWIN, current, [{ stageKey: "b", kind: "stage-evidence-recorded" }])).toEqual([]);
    expect(enabledStages(FLOW_TWIN, current, [{ stageKey: "b", kind: "stage-evidence-recorded", iteration: 1 }])).toEqual(["b"]);
    expect(enabledStages(FLOW_TWIN, current, [{ stageKey: "b", kind: "blocked", iteration: 1 }])).toEqual([]);
    expect(isCompletingAt({ stageKey: "b", kind: "k" }, "b", 0)).toBe(true);
  });

  it("marked keys carry the iteration, sorted", () => {
    const current = marking({ tokens: [{ node: "stage:b", enteredAt: NOW.toISOString() }, { node: "stage:c", enteredAt: NOW.toISOString() }], iterations: { c: 2 } });
    expect(markedStageKeys(PARALLEL_FIXTURE, current)).toEqual(["b", "c"]);
    expect(markedKeysWithIteration(PARALLEL_FIXTURE, current)).toEqual(["b#0", "c#2"]);
  });

  it("latchPriorFor builds the latch prior from the token's own last tick, on its own stage", () => {
    expect(latchPriorFor({ node: "stage:c", enteredAt: NOW.toISOString() }, "c")).toBeNull();
    expect(latchPriorFor({ node: "stage:c", enteredAt: NOW.toISOString(), lastAction: "dispatch_agent", lastReason: "agent_stage", lastCycleKey: CYCLE }, "c"))
      .toEqual({ action: "dispatch_agent", reason: "agent_stage", stageKey: "c", cycleKey: CYCLE });
  });
});

describe("stepDriveMarking: the forward move", () => {
  it("fires the marked stage with a completing receipt and places the next token with a fresh enteredAt", () => {
    const result = stepDriveMarking(FLOW_TWIN, marking(), { receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }] }, NOW);
    expect(result).toEqual({ fired: "a", stopped: null, marking: marking({ tokens: [{ node: "stage:b", enteredAt: NOW.toISOString() }] }) });
  });

  it("fires nothing without a completing receipt, and returns the same marking", () => {
    const start = marking();
    const result = stepDriveMarking(FLOW_TWIN, start, { receipts: [{ stageKey: "a", kind: "blocked" }, { stageKey: "b", kind: "k" }] }, NOW);
    expect(result).toEqual({ fired: null, stopped: null, marking: start });
    expect(result.marking).toBe(start);
  });

  it("the last stage reaches the success stop and consumes every token", () => {
    const onB = marking({ tokens: [{ node: "stage:b", enteredAt: NOW.toISOString() }] });
    expect(stepDriveMarking(FLOW_TWIN, onB, { receipts: [{ stageKey: "b", kind: "k" }] }, NOW))
      .toEqual({ fired: "b", stopped: { stopId: "stop:success:1", kind: "success", disposition: "proceed" }, marking: { ...onB, tokens: [] } });
  });

  it("on the two-stage flow equals nextStageKey on its sequential twin, over 200 seeded receipt sequences", () => {
    for (let n = 0; n < 200; n += 1) {
      const random = mulberry32(0x8875c9df + n);
      const receipts: Array<{ stageKey: string; kind: string }> = [];
      let sequential: string | null = nextStageKey(SEQUENTIAL_TWIN, null, receipts);
      let graph = startDriveMarking(FLOW_TWIN, CYCLE, NOW);
      let stopped = false;
      for (let step = 0; step < 12 && !stopped; step += 1) {
        expect(markedStageKeys(FLOW_TWIN, graph), `seed ${n} step ${step}`).toEqual(sequential ? [sequential] : []);
        const roll = random();
        const stageKey = roll < 0.5 ? sequential ?? "a" : random() < 0.5 ? "a" : "b";
        receipts.push({ stageKey, kind: random() < 0.25 ? "blocked" : "stage-evidence-recorded" });
        const result = stepDriveMarking(FLOW_TWIN, graph, { receipts }, NOW);
        graph = result.marking;
        sequential = nextStageKey(SEQUENTIAL_TWIN, sequential, receipts);
        stopped = result.stopped !== null;
        if (stopped) expect(sequential, `seed ${n}`).toBeNull();
      }
    }
  });
});

describe("stepDriveMarking: construct-specific branches throw construct_not_implemented", () => {
  const throwsFor = (run: () => unknown, construct: string) => {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(DriveConstructNotImplementedError);
      expect((error as DriveConstructNotImplementedError).construct).toBe(construct);
      expect((error as DriveConstructNotImplementedError).code).toBe("construct_not_implemented");
      return;
    }
    throw new Error(`expected ${construct} to throw`);
  };
  const done = (stageKey: string) => ({ receipts: [{ stageKey, kind: "stage-evidence-recorded" }] });

  it("a parallel split", () => {
    throwsFor(() => stepDriveMarking(PARALLEL_FIXTURE, marking(), done("a"), NOW), "parallel-split-join");
  });
  it("a marked join arrival", () => {
    throwsFor(() => stepDriveMarking(PARALLEL_FIXTURE, marking({ tokens: [{ node: "node:j", from: "stage:b", enteredAt: NOW.toISOString() }] }), done("c"), NOW), "parallel-split-join");
  });
  it("a rework edge", () => {
    throwsFor(() => stepDriveMarking(REWORK_FIXTURE, marking({ tokens: [{ node: "stage:b", enteredAt: NOW.toISOString() }] }), done("b"), NOW), "rework-edge");
  });
  it("a refuse route", () => {
    throwsFor(() => stepDriveMarking(REFUSE_FIXTURE, marking({ tokens: [{ node: "stage:decide", enteredAt: NOW.toISOString() }] }), done("decide"), NOW), "rework-edge");
  });
  it("entering, or holding, a stage with a deadline", () => {
    throwsFor(() => stepDriveMarking(DEADLINE_FIXTURE, marking(), done("a"), NOW), "stage-deadline");
    throwsFor(() => stepDriveMarking(DEADLINE_FIXTURE, marking({ tokens: [{ node: "stage:b", enteredAt: NOW.toISOString() }] }), { receipts: [] }, NOW), "stage-deadline");
  });
  it("entering a sub-shape stage", () => {
    throwsFor(() => stepDriveMarking(SUB_SHAPE_FIXTURE, marking(), done("a"), NOW), "sub-shape");
  });
  it("a forward edge into a failure stop", () => {
    const failing = { ...FLOW_TWIN, flow: { nodes: [], edges: [{ from: "a", to: "b" }, { from: "b", to: "failure" }] } };
    throwsFor(() => stepDriveMarking(failing, marking({ tokens: [{ node: "stage:b", enteredAt: NOW.toISOString() }] }), done("b"), NOW), "stop");
  });
});

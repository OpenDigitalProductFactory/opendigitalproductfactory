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
// 4. Parallel split and join (PR-3c-2).
// 5. Every other construct-specific branch throws construct_not_implemented.

import { describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "./work-shape-prior-versions";
import { listWorkShapes, readWorkShapeDefinitionContract } from "./work-shapes";
import { nextStageKey } from "./drive-resolution";
import {
  DEADLINE_FIXTURE,
  FLOW_TWIN,
  GRAPH_FIXTURES,
  PARALLEL_FIXTURE,
  REWORK_FIXTURE,
  SEQUENTIAL_TWIN,
  SUB_SHAPE_FIXTURE,
} from "./__fixtures__/graph-shape-fixtures";
import {
  DRIVE_MARKING_FORMAT,
  DriveConstructNotImplementedError,
  enabledStages,
  gateHolds,
  isCompletingAt,
  latchPriorFor,
  markedKeysWithIteration,
  markedStageKeys,
  readStoredDriveMarking,
  startDriveMarking,
  stageAwaitsVerdict,
  stepDriveMarking,
  usesGraphConstructs,
  type DriveGateVerdict,
  type DriveMarking,
} from "./drive-marking";
import { REFUSE_TO_STOP, REWORK_1, REWORK_INSIDE_BRANCH, SHADOW_GATE, REFUSE_BOUND_NO_BUDGET_STOP, DEFER_ON_REFUSE_ROUTE } from "./__fixtures__/graph-shapes/rework";

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
    expect(read).toEqual({ ok: true, data: { source: "derived", marking: marking({ tokens: [{ node: "stage:b", enteredAt: "2026-03-01T08:30:00.000Z" }] }) } });
  });

  it("derives the start when no stage is stored, or the stored stage is not on the shape", () => {
    for (const workspaceState of [{}, { workroomDrive: { stageKey: null } }, { workroomDrive: { stageKey: "gone" } }]) {
      const read = readStoredDriveMarking(workspaceState, FLOW_TWIN, CYCLE, NOW);
      expect(read).toEqual({ ok: true, data: { source: "derived", marking: marking({ tokens: [{ node: "stage:a", enteredAt: NOW.toISOString() }] }) } });
    }
  });

  it("returns a valid stored marking of this cycle as stored", () => {
    const stored = marking({ iterations: { a: 1 }, reworkTaken: { "edge:b->a": 1 } });
    expect(readStoredDriveMarking({ workroomDrive: { stageKey: "a", marking: stored } }, FLOW_TWIN, CYCLE, NOW))
      .toEqual({ ok: true, data: { source: "stored", marking: stored } });
  });

  it("discards a marking from another cycle and starts fresh at the shape's start", () => {
    const stored = marking({ cycleKey: "graph-fixture-flow@1.0.0:2026-02-28", tokens: [{ node: "stage:b", enteredAt: "2026-02-28T08:00:00.000Z" }], iterations: { b: 2 } });
    const read = readStoredDriveMarking({ workroomDrive: { marking: stored } }, FLOW_TWIN, CYCLE, NOW);
    expect(read).toEqual({ ok: true, data: { source: "new-cycle", marking: marking({ tokens: [{ node: "stage:a", enteredAt: NOW.toISOString() }] }) } });
  });

  it("with no current cycle (the runner's receipt earning) keeps the stored cycle", () => {
    const stored = marking({ cycleKey: "graph-fixture-flow@1.0.0:2026-02-28" });
    expect(readStoredDriveMarking({ workroomDrive: { marking: stored } }, FLOW_TWIN, null, NOW)).toMatchObject({ ok: true, data: { source: "stored" } });
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

// PR-3c-2 (design §6.1): split and join are implemented; parity with the
// interpreter is drive-parity-parallel.test.ts. These pin the step's own shape.
describe("stepDriveMarking: parallel split and join (PR-3c-2)", () => {
  const at = (iso: string) => ({ enteredAt: iso });
  const LATER = new Date("2026-03-01T10:00:00.000Z");

  it("a split places one token on the first stage of each branch, each with this tick's enteredAt", () => {
    const result = stepDriveMarking(PARALLEL_FIXTURE, marking(), { receipts: [{ stageKey: "a", kind: "assurance-run" }] }, NOW);
    expect(result.fired).toBe("a");
    expect(result.stopped).toBeNull();
    expect(result.marking.tokens).toEqual([{ node: "stage:b", ...at(NOW.toISOString()) }, { node: "stage:c", ...at(NOW.toISOString()) }]);
    expect(markedStageKeys(PARALLEL_FIXTURE, result.marking)).toEqual(["b", "c"]);
  });

  it("a branch reaching the join waits as an arrival; the other branch keeps its token and its own enteredAt", () => {
    const split = marking({ tokens: [{ node: "stage:b", ...at(NOW.toISOString()), taskId: "t-b" }, { node: "stage:c", ...at(NOW.toISOString()), taskId: "t-c" }] });
    const result = stepDriveMarking(PARALLEL_FIXTURE, split, { receipts: [{ stageKey: "b", kind: "k" }] }, LATER);
    expect(result.fired).toBe("b");
    expect(result.marking.tokens).toEqual([
      { node: "node:j", from: "stage:b", ...at(LATER.toISOString()) },
      { node: "stage:c", ...at(NOW.toISOString()), taskId: "t-c" },
    ]);
    expect(markedStageKeys(PARALLEL_FIXTURE, result.marking)).toEqual(["c"]);
  });

  it("the last arrival completes the join: arrivals are removed and one token goes on the successor", () => {
    const waiting = marking({ tokens: [{ node: "node:j", from: "stage:b", ...at(NOW.toISOString()) }, { node: "stage:c", ...at(NOW.toISOString()) }] });
    const result = stepDriveMarking(PARALLEL_FIXTURE, waiting, { receipts: [{ stageKey: "b", kind: "k" }, { stageKey: "c", kind: "k" }] }, LATER);
    expect(result.fired).toBe("c");
    expect(result.marking.tokens).toEqual([{ node: "stage:d", ...at(LATER.toISOString()) }]);
  });

  it("fires at most one stage per tick, the first enabled in document order", () => {
    const split = marking({ tokens: [{ node: "stage:b", ...at(NOW.toISOString()) }, { node: "stage:c", ...at(NOW.toISOString()) }] });
    const both = { receipts: [{ stageKey: "c", kind: "k" }, { stageKey: "b", kind: "k" }] };
    const first = stepDriveMarking(PARALLEL_FIXTURE, split, both, LATER);
    expect(first.fired).toBe("b");
    const second = stepDriveMarking(PARALLEL_FIXTURE, first.marking, both, LATER);
    expect(second.fired).toBe("c");
    expect(markedStageKeys(PARALLEL_FIXTURE, second.marking)).toEqual(["d"]);
  });

  it("a stop event consumes every token at the first stop of its kind, from any marking", () => {
    const split = marking({ tokens: [{ node: "node:j", from: "stage:b", ...at(NOW.toISOString()) }, { node: "stage:c", ...at(NOW.toISOString()) }] });
    expect(stepDriveMarking(PARALLEL_FIXTURE, split, { receipts: [{ stageKey: "c", kind: "k" }], stop: "budget" }, NOW))
      .toEqual({ fired: null, stopped: { stopId: "stop:budget:1", kind: "budget", disposition: "awaiting-person" }, marking: { ...split, tokens: [] } });
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

// GPP Phase 3c PR-3c-3 (BI-8875C9DF), design §6.2: refuse routes and rework edges in the drive's own step.
// drive-parity-rework.test.ts compares it with the interpreter over seeded sequences; these pin single moves.
describe("stepDriveMarking: refuse routes and rework edges (PR-3c-3)", () => {
  const LATER = new Date("2026-03-01T10:00:00.000Z");
  const on = (node: string, enteredAt = NOW.toISOString()) => ({ node, enteredAt });
  const decided = (stageKey: string, verdict: DriveGateVerdict["verdict"], iteration = 0, mode: DriveGateVerdict["mode"] = "enforced") =>
    ({ [stageKey]: { verdict, mode, iteration } });
  const receipt = (stageKey: string, iteration?: number) => ({ stageKey, kind: "stage-evidence-recorded", ...(iteration !== undefined ? { iteration } : {}) });

  it("only an enforced, blocking gate with a refuse route waits on a verdict", () => {
    expect(stageAwaitsVerdict(REWORK_1, "b")).toBe(true);
    expect(stageAwaitsVerdict(REFUSE_TO_STOP, "decide")).toBe(true);
    expect(stageAwaitsVerdict(SHADOW_GATE, "b")).toBe(false);
    expect(stageAwaitsVerdict(DEFER_ON_REFUSE_ROUTE, "approve")).toBe(false);
    // A rework edge on a stage with no gate is never taken (the interpreter takes one only on a refuse verdict).
    expect(stageAwaitsVerdict(REWORK_FIXTURE, "b")).toBe(false);
  });

  it("a refuse to an earlier stage counts the edge, bumps the loop region's iterations and puts a fresh token on the target", () => {
    const held = marking({ tokens: [{ ...on("stage:b"), taskId: "t-b", lastAction: "attention", lastReason: "governed_decision", lastCycleKey: CYCLE }] });
    const result = stepDriveMarking(REWORK_1, held, { receipts: [receipt("b")], verdicts: decided("b", "refuse") }, LATER);
    expect(result.fired).toBe("b");
    expect(result.stopped).toBeNull();
    expect(result.reworked).toEqual({ fromStageKey: "b", toStageKey: "a", edgeId: "edge:b->a", clearedStageKeys: ["a", "b"] });
    expect(result.marking).toEqual({ ...held, tokens: [{ node: "stage:a", enteredAt: LATER.toISOString() }], iterations: { a: 1, b: 1 }, reworkTaken: { "edge:b->a": 1 } });
    // The input is not mutated.
    expect(held.tokens).toHaveLength(1);
  });

  it("a stale-iteration receipt never completes the new iteration", () => {
    const back = stepDriveMarking(REWORK_1, marking({ tokens: [on("stage:b")] }), { receipts: [receipt("b")], verdicts: decided("b", "refuse") }, LATER).marking;
    // a's iteration-0 receipt is stale for iteration 1: nothing fires.
    expect(stepDriveMarking(REWORK_1, back, { receipts: [receipt("a"), receipt("b")] }, LATER)).toMatchObject({ fired: null, marking: back });
    expect(enabledStages(REWORK_1, back, [receipt("a")])).toEqual([]);
    expect(stepDriveMarking(REWORK_1, back, { receipts: [receipt("a", 1)] }, LATER).fired).toBe("a");
    // An iteration-0 verdict does not apply to iteration 1 either.
    const atB = marking({ tokens: [on("stage:b")], iterations: { a: 1, b: 1 } });
    expect(stepDriveMarking(REWORK_1, atB, { receipts: [receipt("b", 1)], verdicts: decided("b", "admit", 0) }, LATER).fired).toBeNull();
    expect(stepDriveMarking(REWORK_1, atB, { receipts: [receipt("b", 1)], verdicts: decided("b", "admit", 1) }, LATER).stopped?.kind).toBe("success");
  });

  it("past maxIterations a refuse goes to the first budget stop; with no budget stop it has no route and the token stays", () => {
    const spent = marking({ tokens: [on("stage:b")], iterations: { a: 1, b: 1 }, reworkTaken: { "edge:b->a": 1 } });
    const observations = { receipts: [receipt("b", 1)], verdicts: decided("b", "refuse", 1) };
    expect(stepDriveMarking(REWORK_1, spent, observations, LATER)).toEqual({
      marking: { ...spent, tokens: [] },
      fired: "b",
      stopped: { stopId: "stop:budget:1", kind: "budget", disposition: "awaiting-person" },
    });
    expect(stepDriveMarking(REFUSE_BOUND_NO_BUDGET_STOP, spent, observations, LATER)).toEqual({ marking: spent, fired: null, stopped: null });
    expect(gateHolds(REFUSE_BOUND_NO_BUDGET_STOP, spent, observations)).toEqual(new Map([["b", "refused_without_route"]]));
  });

  it("a refuse to a stop consumes every token", () => {
    const atDecide = marking({ tokens: [on("stage:decide")] });
    expect(stepDriveMarking(REFUSE_TO_STOP, atDecide, { receipts: [receipt("decide")], verdicts: decided("decide", "refuse") }, LATER)).toEqual({
      marking: { ...atDecide, tokens: [] },
      fired: "decide",
      stopped: { stopId: "stop:failure:1", kind: "failure", disposition: "inconclusive" },
    });
  });

  it("hold (a deferral on a refuse-route stage), escalate and no verdict keep the token; admit moves it", () => {
    const atB = marking({ tokens: [on("stage:b")] });
    for (const verdicts of [decided("b", "hold"), decided("b", "escalate"), {}, decided("b", "admit", 0, "shadow")]) {
      expect(stepDriveMarking(REWORK_1, atB, { receipts: [receipt("b")], verdicts }, LATER), JSON.stringify(verdicts)).toEqual({ marking: atB, fired: null, stopped: null });
      expect(gateHolds(REWORK_1, atB, { receipts: [receipt("b")], verdicts })).toEqual(new Map([["b", "awaiting_verdict"]]));
    }
    expect(stepDriveMarking(REWORK_1, atB, { receipts: [receipt("b")], verdicts: decided("b", "admit") }, LATER).stopped?.kind).toBe("success");
    // Without a completing receipt the gate holds nothing yet.
    expect(gateHolds(REWORK_1, atB, { receipts: [], verdicts: decided("b", "refuse") })).toEqual(new Map());
  });

  it("a shadow gate records a refuse and moves on its receipt; an enforced gate with no refuse route advances on its receipt", () => {
    const atB = marking({ tokens: [on("stage:b")] });
    expect(stepDriveMarking(SHADOW_GATE, atB, { receipts: [receipt("b")], verdicts: decided("b", "refuse", 0, "shadow") }, LATER))
      .toMatchObject({ fired: "b", stopped: { kind: "success" } });
    const atApprove = marking({ tokens: [on("stage:approve")] });
    expect(stepDriveMarking(DEFER_ON_REFUSE_ROUTE, atApprove, { receipts: [receipt("approve")] }, LATER)).toMatchObject({ fired: "approve", stopped: { kind: "success" } });
  });

  it("a rework inside a parallel branch touches only that branch: the sibling token, its task and its iteration are kept", () => {
    const sibling = { ...on("stage:c"), taskId: "t-c", lastAction: "dispatch_agent", lastReason: "agent_stage", lastCycleKey: CYCLE };
    const branch = marking({ tokens: [on("stage:b2"), sibling] });
    const result = stepDriveMarking(REWORK_INSIDE_BRANCH, branch, { receipts: [receipt("b2")], verdicts: decided("b2", "refuse") }, LATER);
    expect(result.reworked).toEqual({ fromStageKey: "b2", toStageKey: "b1", edgeId: "edge:b2->b1", clearedStageKeys: ["b1", "b2"] });
    expect(result.marking.tokens).toEqual([{ node: "stage:b1", enteredAt: LATER.toISOString() }, sibling]);
    expect(result.marking.iterations).toEqual({ b1: 1, b2: 1 });
  });
});

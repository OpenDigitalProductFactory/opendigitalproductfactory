// Sub-shape child lifecycle, pure (BI-8875C9DF, GPP Phase 3c PR-3c-5). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §9.
// Parity with the interpreter: drive-parity-sub-shape.test.ts. Through the runner and an
// in-memory database: lib/queue/functions/workroom-drive-children.test.ts.

import { describe, expect, it } from "vitest";

import { SUB_IN_BRANCH, SUB_SEQ } from "./__fixtures__/graph-shapes/sub-shape";
import type { DriveMarking } from "./drive-marking";
import {
  liveSubShapeChildren,
  subShapeChildKey,
  subShapeEffects,
  subShapeIdempotencyKey,
  subShapeOutcome,
  subShapeTokenState,
  type SubShapeChildObservation,
} from "./drive-child-rooms";

const CYCLE = "sub:2026-03-02";
const KEY = `${CYCLE}#b#0`;
const child = (over: Partial<SubShapeChildObservation> = {}): SubShapeChildObservation =>
  ({ capsuleId: "WC-C", status: "working", action: "dispatch_agent", reason: "agent_stage", ...over });
const marking = (over: Partial<DriveMarking> = {}): DriveMarking => ({
  format: "drive-marking/1", cycleKey: CYCLE, tokens: [{ node: "stage:b", enteredAt: "2026-03-02T09:00:00.000Z" }],
  iterations: {}, reworkTaken: {}, deadlines: {}, children: {}, ...over,
});

describe("keys", () => {
  it("the child entry and the idempotency key both carry the cycle, the stage and the iteration", () => {
    expect(subShapeChildKey(CYCLE, "b", 2)).toBe(`${CYCLE}#b#2`);
    expect(subShapeIdempotencyKey("WC-P", CYCLE, "b", 2)).toBe(`sub-shape:WC-P:${CYCLE}:b:2`);
  });
});

describe("how a child stands", () => {
  it("success: its drive's success stop, the cycle-complete sleep after it, or a complete room", () => {
    expect(subShapeOutcome(child({ action: "stop", reason: "success" }))).toEqual({ kind: "success", disposition: "success" });
    expect(subShapeOutcome(child({ action: "do_not_wake", reason: "cycle_complete" }))).toEqual({ kind: "success", disposition: "success" });
    expect(subShapeOutcome(child({ status: "complete" }))).toEqual({ kind: "success", disposition: "complete" });
  });
  it("stopped: any other stop, or a room abandoned or archived by someone; never a guess", () => {
    expect(subShapeOutcome(child({ action: "stop", reason: "refused_to_stop" }))).toEqual({ kind: "stopped", disposition: "refused_to_stop" });
    expect(subShapeOutcome(child({ action: "stop", reason: "conformance_stop" }))).toEqual({ kind: "stopped", disposition: "conformance_stop" });
    expect(subShapeOutcome(child({ status: "abandoned" }))).toEqual({ kind: "stopped", disposition: "abandoned" });
  });
  it("running: anything else, including a pause and a child the drive could not read", () => {
    for (const over of [{}, { action: "pause", reason: "conformance_pause" }, { action: null, reason: null }]) expect(subShapeOutcome(child(over)).kind).toBe("running");
    expect(subShapeOutcome(undefined).kind).toBe("running");
  });
});

describe("effects and token state", () => {
  it("a marked sub-shape stage without a child is ensured; a stage that calls none is not", () => {
    expect(subShapeTokenState(SUB_SEQ, marking(), "b", {})).toEqual({ kind: "creating", key: KEY, ref: "graph-fixture@1.0.0" });
    expect(subShapeTokenState(SUB_SEQ, marking({ tokens: [{ node: "stage:a", enteredAt: "2026-03-02T09:00:00.000Z" }] }), "a", {})).toBeNull();
    expect(subShapeEffects(SUB_SEQ, marking(), "WC-P", {}, "r").ensure).toEqual([
      { key: KEY, stageKey: "b", stageTitle: "Run child b", iteration: 0, ref: "graph-fixture@1.0.0", idempotencyKey: `sub-shape:WC-P:${CYCLE}:b:0` },
    ]);
  });

  it("a running child waits; a successful one is completed; a stopped one holds the token and is left alone", () => {
    const withChild = marking({ children: { [KEY]: { capsuleId: "WC-C", ref: "graph-fixture@1.0.0" } } });
    expect(subShapeTokenState(SUB_SEQ, withChild, "b", { "WC-C": child() })?.kind).toBe("running");
    expect(subShapeEffects(SUB_SEQ, withChild, "WC-P", { "WC-C": child() }, "r")).toEqual({ ensure: [], complete: [], abandon: [] });
    const success = { "WC-C": child({ action: "stop", reason: "success" }) };
    expect(subShapeTokenState(SUB_SEQ, withChild, "b", success)?.kind).toBe("completing");
    expect(subShapeEffects(SUB_SEQ, withChild, "WC-P", success, "r").complete).toEqual([
      { key: KEY, stageKey: "b", iteration: 0, childCapsuleId: "WC-C", ref: "graph-fixture@1.0.0", disposition: "success" },
    ]);
    const failed = { "WC-C": child({ action: "stop", reason: "refused_to_stop" }) };
    expect(subShapeTokenState(SUB_SEQ, withChild, "b", failed)).toMatchObject({ kind: "stopped", disposition: "refused_to_stop" });
    expect(subShapeEffects(SUB_SEQ, withChild, "WC-P", failed, "r")).toEqual({ ensure: [], complete: [], abandon: [] });
  });

  it("a live child no token holds is abandoned; a completed or abandoned entry is never touched again", () => {
    const left = marking({ tokens: [], children: { [KEY]: { capsuleId: "WC-C", ref: "graph-fixture@1.0.0" } } });
    expect(subShapeEffects(SUB_SEQ, left, "WC-P", {}, "the token left").abandon).toEqual([{ key: KEY, childCapsuleId: "WC-C", ref: "graph-fixture@1.0.0", reason: "the token left" }]);
    for (const state of ["completed", "abandoned"] as const) {
      const closed = marking({ tokens: [], children: { [KEY]: { capsuleId: "WC-C", ref: "graph-fixture@1.0.0", state } } });
      expect(subShapeEffects(SUB_SEQ, closed, "WC-P", {}, "r")).toEqual({ ensure: [], complete: [], abandon: [] });
      expect(liveSubShapeChildren(closed)).toEqual([]);
    }
  });

  it("in a parallel branch only the branch's own stage has a child", () => {
    const forked = marking({ tokens: [{ node: "stage:b", enteredAt: "2026-03-02T09:00:00.000Z" }, { node: "stage:c", enteredAt: "2026-03-02T09:00:00.000Z" }] });
    expect(subShapeEffects(SUB_IN_BRANCH, forked, "WC-P", {}, "r").ensure.map((entry) => entry.stageKey)).toEqual(["b"]);
  });
});

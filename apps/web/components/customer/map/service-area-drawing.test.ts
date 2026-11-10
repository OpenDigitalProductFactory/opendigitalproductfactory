import { describe, expect, it } from "vitest";

import { canFinish, closedRing, drawingReducer, IDLE, newServiceAreaZone, type DrawingState } from "./service-area-drawing";

const p = (longitude: number, latitude: number) => ({ longitude, latitude });

function run(...actions: Parameters<typeof drawingReducer>[1][]): DrawingState {
  return actions.reduce(drawingReducer, IDLE);
}

describe("service area drawing (AC-COV-DRAW-1)", () => {
  it("adds corners, undoes the last one, and finishes only with three or more", () => {
    let state = run({ type: "start" }, { type: "add", point: p(0, 0) }, { type: "add", point: p(1, 0) });
    expect(canFinish(state)).toBe(false);
    expect(drawingReducer(state, { type: "finish" })).toBe(state);

    state = drawingReducer(state, { type: "add", point: p(1, 1) });
    expect(canFinish(state)).toBe(true);
    expect(drawingReducer(state, { type: "undo" })).toEqual({ mode: "drawing", points: [p(0, 0), p(1, 0)] });
    expect(drawingReducer(state, { type: "finish" })).toEqual({ mode: "naming", points: [p(0, 0), p(1, 0), p(1, 1)] });
  });

  it("ignores clicks when not drawing and cancels from any state", () => {
    expect(drawingReducer(IDLE, { type: "add", point: p(0, 0) })).toBe(IDLE);
    expect(run({ type: "start" }, { type: "add", point: p(0, 0) }, { type: "cancel" })).toEqual(IDLE);
  });

  it("closes the ring and builds a zone with an optional assignee", () => {
    expect(closedRing([p(0, 0), p(1, 0)])).toBeNull();
    expect(closedRing([p(0, 0), p(1, 0), p(1, 1)])).toEqual([p(0, 0), p(1, 0), p(1, 1), p(0, 0)]);
    expect(newServiceAreaZone({ id: "a", label: "  North ", points: [p(0, 0), p(1, 0), p(1, 1)], coveredBy: null })).toEqual({
      id: "a",
      label: "North",
      geometry: { kind: "polygon", rings: [[p(0, 0), p(1, 0), p(1, 1), p(0, 0)]] },
    });
    expect(newServiceAreaZone({ id: "a", label: " ", points: [p(0, 0), p(1, 0), p(1, 1)], coveredBy: null })).toBeNull();
    expect(
      newServiceAreaZone({ id: "a", label: "N", points: [p(0, 0), p(1, 0), p(1, 1)], coveredBy: { kind: "employee", id: "E-1" } })
        ?.coveredBy,
    ).toEqual({ kind: "employee", id: "E-1" });
  });
});

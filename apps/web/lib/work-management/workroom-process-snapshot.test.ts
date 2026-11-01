import { describe, expect, it } from "vitest";
import type { ShapeGraph } from "./shape-projection";
import type { WorkroomFlowMapModel } from "./workroom-flow-map";
import { createWorkroomProcessSnapshot, normalizeProcessCaseKey, parseWorkroomProcessSnapshot } from "./workroom-process-snapshot";
const target = { caseKey: "task%3ATR-1", workroomRowId: "row-1", workroom: "WC-1" };
const graph: ShapeGraph = { stages: [], blockingStageKey: null, progress: { passed: 0, total: 0 }, process: {
  definitionRef: "delivery-small@1.0.0", title: "Process", currentStageKey: null, nextPermittedStageKey: null,
  readAt: "2026-10-25T12:00:00Z", lastEvidenceAt: null, sourceHealth: "ok", gaps: [], receipts: [] } };
const map: WorkroomFlowMapModel = { shapeRef: "delivery-small@1.0.0", title: "Map", signature: "s", triggers: [], stages: [],
  ends: { success: false, failure: false, budget: false }, finished: false, graphFlow: false };
const build = () => createWorkroomProcessSnapshot(target, graph, { definition: null, mode: "finite", activeCycle: false }, map);
describe("process snapshot wire contract", () => {
  it("normalizes encoded/decoded identities without accepting malformed escapes", () => {
    expect(normalizeProcessCaseKey("task:TR-1")).toBe(target.caseKey); expect(normalizeProcessCaseKey("%")).toBeNull();
    expect(parseWorkroomProcessSnapshot(build(), { ...target, caseKey: "task:TR-1" })).toEqual(build());
  });
  it.each([ { ...target, caseKey: "task:TR-OTHER" }, { ...target, workroomRowId: "row-2" }, { ...target, workroom: null } ])("rejects any target identity mismatch", wrong => {
    expect(parseWorkroomProcessSnapshot(build(), wrong)).toBeNull();
  });
  it("removes an inconsistent companion map and reports partial health", () => {
    const snapshot = createWorkroomProcessSnapshot(target, graph, build().context, { ...map, shapeRef: "other@1.0.0" });
    expect(snapshot.flowMap).toBeNull(); expect(snapshot.flowHealth).toBe("unavailable"); expect(snapshot.graph.process?.sourceHealth).toBe("partial");
    expect(parseWorkroomProcessSnapshot(snapshot, target)).not.toBeNull();
  });
  it("distinguishes a genuine absent map from an unreadable map", () => {
    expect(createWorkroomProcessSnapshot(target, graph, build().context, null).flowHealth).toBe("not-applicable");
    expect(createWorkroomProcessSnapshot(target, graph, build().context, null, true).flowHealth).toBe("unavailable");
  });
  it.each([
    { ...build(), flowHealth: "unavailable" },
    { ...build(), flowMap: { ...map, shapeRef: "wrong@1.0.0" } },
    { ...build(), graph: { ...graph, stages: [{ key: "broken" }] } },
    { ...build(), context: { ...build().context, mode: "invented" } },
  ])("rejects incomplete or contradictory companion data", value => { expect(parseWorkroomProcessSnapshot(value, target)).toBeNull(); });
});

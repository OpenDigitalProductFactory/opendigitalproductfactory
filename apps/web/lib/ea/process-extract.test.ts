import { describe, expect, it } from "vitest";
import { buildProcessModel, type ProcessStateMachine } from "./process-extract";

// A small machine: new → active → {done|cancelled}; new → cancelled. done/cancelled terminal.
const DEMO: ProcessStateMachine = {
  key: "demo",
  name: "Demo Lifecycle",
  statuses: ["new", "active", "done", "cancelled"],
  isTerminal: (s) => s === "done" || s === "cancelled",
  canTransition: (f, t) =>
    (f === "new" && (t === "active" || t === "cancelled")) ||
    (f === "active" && (t === "done" || t === "cancelled")),
};

describe("buildProcessModel", () => {
  const model = buildProcessModel([DEMO]);
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));
  const flow = (from: string, to: string) =>
    model.relationships.some((r) => r.fromKey === from && r.toKey === to && r.relSlug === "sequence_flow");

  it("maps the machine to a process, start event, state tasks, and terminal end events", () => {
    expect(byKey.get("proc:demo")?.typeSlug).toBe("bpmn_process");
    expect(byKey.get("proc:demo:start")?.typeSlug).toBe("bpmn_start_event");
    expect(byKey.get("proc:demo:state:new")?.typeSlug).toBe("bpmn_task");
    expect(byKey.get("proc:demo:state:active")?.typeSlug).toBe("bpmn_task");
    expect(byKey.get("proc:demo:end:done")?.typeSlug).toBe("bpmn_end_event");
    expect(byKey.get("proc:demo:end:cancelled")?.typeSlug).toBe("bpmn_end_event");
    // process + start + 2 tasks + 2 ends
    expect(model.elements).toHaveLength(6);
  });

  it("starts at the no-incoming state and wires transitions as sequence flows", () => {
    expect(flow("proc:demo:start", "proc:demo:state:new")).toBe(true); // new has no incoming → initial
    expect(flow("proc:demo:state:new", "proc:demo:state:active")).toBe(true);
    expect(flow("proc:demo:state:new", "proc:demo:end:cancelled")).toBe(true); // to a terminal → end node
    expect(flow("proc:demo:state:active", "proc:demo:end:done")).toBe(true);
    expect(flow("proc:demo:state:active", "proc:demo:end:cancelled")).toBe(true);
    // start→new + 4 transitions
    expect(model.relationships).toHaveLength(5);
  });

  it("emits no outgoing flow from terminal states", () => {
    const fromTerminal = model.relationships.filter((r) => r.fromKey.startsWith("proc:demo:end:"));
    expect(fromTerminal).toHaveLength(0);
  });

  it("namespaces nodes per machine so multiple machines don't collide", () => {
    const two = buildProcessModel([DEMO, { ...DEMO, key: "other", name: "Other" }]);
    expect(two.elements.some((e) => e.sysmlKey === "proc:other:state:new")).toBe(true);
    expect(two.elements.filter((e) => e.typeSlug === "bpmn_process")).toHaveLength(2);
  });

  it("targets the bpmn20 process viewpoint and re-derives cleanly via soft-remove", () => {
    expect(model.elementTypeSlugs).toEqual(["bpmn_process", "bpmn_start_event", "bpmn_task", "bpmn_end_event"]);
    expect(model.relTypeSlugs).toEqual(["sequence_flow"]);
    expect(model.view.viewpointName).toBe("Process Architecture");
    expect(model.softRemovePrefix).toBe("proc:");
  });
});

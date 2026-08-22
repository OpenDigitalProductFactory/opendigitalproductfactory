import { describe, expect, it } from "vitest";

import { projectCoworkerShape, type CoworkerShapeInput } from "./coworker-shape-projection";

const input = (over: Partial<CoworkerShapeInput> = {}): CoworkerShapeInput => ({
  agentId: "agent-1",
  established: true,
  toolCalls: [],
  ...over,
});

describe("BI-DB302392 — every coworker gets the same shape, none a bespoke one", () => {
  it("uses the same stage grammar for a coworker with no activity at all", () => {
    const graph = projectCoworkerShape(input());
    expect(graph.stages.map((s) => s.key)).toEqual(["establish", "act", "decide", "verify", "close"]);
    expect(graph.stages[0]!.state).toBe("passed");
  });

  it("projects a non-throwing graph for every coworker shape a registry can hold", () => {
    // The guard against a per-coworker special case creeping in later: whatever
    // the inputs, the projection must produce the same five stages.
    const cases: CoworkerShapeInput[] = [
      input(),
      input({ established: false }),
      input({ toolCalls: [{ id: "t1", toolName: "search", success: true, auditClass: null, createdAt: null }] }),
      input({ toolCalls: [{ id: "t2", toolName: "pay_bill", success: false, auditClass: "consequential", createdAt: null }] }),
      input({ gateVerdicts: [{ key: "g1", label: "WWWD alignment", state: "denied", detail: "decline", receiptRef: { table: "DecisionInteraction", id: "d1" }, actor: null }] }),
    ];
    for (const one of cases) {
      const graph = projectCoworkerShape(one);
      expect(graph.stages).toHaveLength(5);
      expect(graph.progress.total).toBe(5);
    }
  });

  it("marks a coworker that is not established as holding, not as finished", () => {
    const graph = projectCoworkerShape(input({ established: false }));
    expect(graph.stages[0]!.state).toBe("holding");
    expect(graph.blockingStageKey).toBe("establish");
  });

  it("shows a failed governed call as a denial, traceable to its audit row", () => {
    const graph = projectCoworkerShape(input({
      toolCalls: [{ id: "t9", toolName: "send_quote", success: false, auditClass: "consequential", createdAt: null }],
    }));
    const act = graph.stages.find((s) => s.key === "act")!;
    expect(act.state).toBe("denied");
    expect(act.rows[0]!.receiptRef).toEqual({ table: "ToolExecution", id: "t9" });
  });

  it("leaves the decision stage empty rather than attributing another agent's decisions", () => {
    const graph = projectCoworkerShape(input({
      toolCalls: [{ id: "t1", toolName: "search", success: true, auditClass: null, createdAt: null }],
    }));
    expect(graph.stages.find((s) => s.key === "decide")!.rows).toEqual([]);
  });
});

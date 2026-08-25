import { describe, expect, it } from "vitest";

import { projectRoomShape } from "./shape-projection";
import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkroomView } from "./room-types";

const receipt = (over: Partial<ReceiptEnvelope> & { id: string }): ReceiptEnvelope => ({
  receiptId: over.id,
  receiptKind: "observed-event",
  enforcementMode: "observe",
  sourceRef: { kind: "decision-interaction", id: over.id, status: "recommend" },
  status: "observed",
  summary: "a decision",
  occurredAt: "2026-08-21T00:00:00.000Z",
  policyRefs: [],
  rawRef: { table: "DecisionInteraction", id: over.id },
  ...over,
} as ReceiptEnvelope);

const view = (over: Partial<WorkroomView> = {}): WorkroomView => ({
  roomKey: "room-1",
  caseRef: { kind: "work-item", id: "wi-1" },
  title: "A room",
  purpose: null,
  mode: "finite",
  state: "active",
  identity: {
    definition: null,
    instance: {
      instanceId: "workroom-instance:booking:BK-1",
      occurrenceTrace: {
        caseRef: { caseId: "booking:BK-1", sourceType: "booking", sourceId: "BK-1" },
        sourceRef: { kind: "source", id: "BK-1", sourceType: "booking" },
        cycleRef: null,
        executionRefs: [],
      },
    },
  },
  outcome: { statement: null, packet: null, health: null },
  boundary: { gaps: [] },
  currentCycle: null,
  completedCycles: [],
  participants: [],
  activity: [],
  work: { attentionRequired: false, terminal: false },
  context: { refs: [], digest: null, sensitivityCeiling: null },
  receipts: [],
  sourceRefs: [],
  projection: { confidence: "high", incompleteBoundary: false, sourceHealth: "ok" },
  ...over,
} as unknown as WorkroomView);

describe("BI-23DB08BB — the room's shape is readable without reading", () => {
  it("keeps the spine constant and marks everything past the current stage not-reached", () => {
    const graph = projectRoomShape(view({ state: "active" }));
    expect(graph.stages.map((s) => s.key)).toEqual(["convene", "act", "decide", "verify", "close"]);
    expect(graph.stages[0]!.state).toBe("passed");
    expect(graph.stages[3]!.state).toBe("not-reached");
    expect(graph.stages[4]!.state).toBe("not-reached");
  });

  it("holds the stage a stalled room stopped in, so a dead room never reads as finished", () => {
    const graph = projectRoomShape(view({ state: "active" }), { liveness: "lease-expired" });
    expect(graph.blockingStageKey).toBe("act");
    expect(graph.stages.find((s) => s.key === "act")!.state).toBe("holding");
  });

  // The field name is deliberately absent from the module, comments included,
  // so this stays a strict token check rather than a judgement call.
  it("never reads the last-touched timestamp — a heartbeat freezes it, so it is not liveness", async () => {
    const source = await import("node:fs/promises")
      .then((fs) => fs.readFile(new URL("./shape-projection.ts", import.meta.url), "utf8"));
    expect(source).not.toContain("updatedAt");
  });

  it("counts a terminal room as through its whole shape", () => {
    const graph = projectRoomShape(view({ state: "closed" }));
    expect(graph.progress.passed).toBe(graph.progress.total);
    expect(graph.blockingStageKey).toBeNull();
  });
});

describe("BI-405AD4FD — gate verdicts and gated tool use, sourced only from receipts", () => {
  it("renders a declined gate as decisive, not as a low-confidence maybe", () => {
    const graph = projectRoomShape(view({
      state: "awaiting-decision",
      receipts: [receipt({ id: "d1", sourceRef: { kind: "decision-interaction", id: "d1", status: "decline" } })],
    }));
    const decide = graph.stages.find((s) => s.key === "decide")!;
    expect(decide.state).toBe("denied");
    expect(graph.blockingStageKey).toBe("decide");
  });

  it("distinguishes awaiting-a-human from denied and from never-reached", () => {
    const graph = projectRoomShape(view({
      state: "awaiting-decision",
      receipts: [receipt({ id: "d2", sourceRef: { kind: "decision-interaction", id: "d2", status: "escalate" } })],
    }));
    expect(graph.stages.find((s) => s.key === "decide")!.state).toBe("awaiting-confirmation");
    expect(graph.stages.find((s) => s.key === "verify")!.state).toBe("not-reached");
  });

  it("traces every receipt-backed row to its audit row, so picture and ledger cannot disagree", () => {
    const graph = projectRoomShape(view({
      state: "awaiting-decision",
      receipts: [
        receipt({ id: "d3" }),
        receipt({
          id: "t1",
          sourceRef: { kind: "receipt", id: "t1", status: "ok" },
          rawRef: { table: "ToolExecution", id: "t1" },
          actionType: "create_digital_product",
        }),
      ],
    }));
    const rows = graph.stages.flatMap((s) => s.rows).filter((r) => r.receiptRef);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.receiptRef?.table).toBeTruthy();
      expect(row.receiptRef?.id).toBeTruthy();
    }
    // The gated tool call is named by what was attempted.
    expect(graph.stages.find((s) => s.key === "act")!.rows[0]!.label).toBe("create_digital_product");
  });

  it("shows less rather than inventing a verdict the gate never recorded", () => {
    const graph = projectRoomShape(view({ state: "active", receipts: [] }));
    expect(graph.stages.find((s) => s.key === "decide")!.rows).toEqual([]);
  });

  it("lets one denial dominate a stage — a decline is never averaged away by neighbouring passes", () => {
    const graph = projectRoomShape(view({
      state: "awaiting-decision",
      receipts: [
        receipt({ id: "ok1" }),
        receipt({ id: "no1", sourceRef: { kind: "decision-interaction", id: "no1", status: "decline" } }),
        receipt({ id: "ok2" }),
      ],
    }));
    expect(graph.stages.find((s) => s.key === "decide")!.state).toBe("denied");
  });
});

import { describe, expect, it } from "vitest";

import { projectRoomShape } from "./shape-projection";
import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkroomView } from "./room-types";
import { getWorkShape } from "./work-shapes";

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
    expect(graph.stages[0]!.state).toBe("unknown");
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

  it("does not infer verified stages from a terminal case state", () => {
    const graph = projectRoomShape(view({ state: "closed" }));
    expect(graph.progress.passed).toBe(0);
    expect(graph.blockingStageKey).toBeNull();
  });
});

describe("execution truth", () => {
  it("shows the versioned intended process separately from observed receipts", () => {
    const graph = projectRoomShape(view({ processOverseer: {
      shapeKey: "delivery-large", shapeVersion: "1.0.0", currentStageKey: null,
      nextPermittedStageKey: null, disposition: "pause", interventionReason: "Independent review required",
      checkedAt: "2026-09-06T12:00:00.000Z", deviations: [],
      collaborationShape: null, processOverseerPrincipalRef: null, processOverseerSource: "none",
      reconciliationKey: "test-check", observed: { participantCount: 0, receiptKinds: [], proposedGrantCount: 0, budgetUsage: [], stopConditionHits: [], reviewDue: false },
    } }));
    expect(graph.process?.definitionRef).toBe("delivery-large@1.0.0");
    expect(graph.stages.map((stage) => stage.key)).toEqual(getWorkShape("delivery-large")!.stages.map((stage) => stage.key));
    expect(graph.stages.every((stage) => stage.state === "unknown")).toBe(true);
    expect(graph.process?.nextPermittedStageKey).toBeNull();
    expect(graph.stages.every((stage) => stage.inspection?.next.startsWith("Intended advance condition:"))).toBe(true);
    expect(graph.process?.gaps).toContain("No observed execution stage is linked to this definition.");
  });

  it("shows cancellation without marking any stage passed", () => {
    const graph = projectRoomShape(view({ state: "cancelled" }));
    expect(graph.progress.passed).toBe(0);
    expect(graph.stages.find((stage) => stage.key === "close")?.state).toBe("cancelled");
  });

  it("does not call a continuing or cancelled defined stage a wait", () => {
    const base = view();
    const stageKey = getWorkShape("delivery-large")!.stages[0].key;
    const check: WorkroomView["processOverseer"] = {
      shapeKey: "delivery-large", shapeVersion: "1.0.0", currentStageKey: stageKey,
      nextPermittedStageKey: stageKey, disposition: "continue", interventionReason: null,
      checkedAt: "2026-09-06T12:00:00.000Z", deviations: [], collaborationShape: null,
      processOverseerPrincipalRef: null, processOverseerSource: "none", reconciliationKey: "test",
      observed: { participantCount: 0, receiptKinds: [], proposedGrantCount: 0, budgetUsage: [], stopConditionHits: [], reviewDue: false },
    };
    expect(projectRoomShape({ ...base, processOverseer: check }).stages[0].state).toBe("observed");
    expect(projectRoomShape({ ...base, state: "cancelled", processOverseer: check }).stages[0].state).toBe("cancelled");
  });

  it("does not treat an observed recommendation as a passed gate", () => {
    const graph = projectRoomShape(view({ state: "awaiting-decision", receipts: [receipt({ id: "recommendation" })] }));
    expect(graph.stages.find((stage) => stage.key === "decide")?.rows[0]?.state).toBe("observed");
    expect(graph.progress.passed).toBe(0);
  });

  it("keeps receipt identity stable when other receipts are inserted", () => {
    const first = projectRoomShape(view({ receipts: [receipt({ id: "stable" })] }));
    const next = projectRoomShape(view({ receipts: [receipt({ id: "new" }), receipt({ id: "stable" })] }));
    expect(next.stages.flatMap((stage) => stage.rows).find((row) => row.receiptRef?.id === "stable")?.key)
      .toBe(first.stages.flatMap((stage) => stage.rows).find((row) => row.receiptRef?.id === "stable")?.key);
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

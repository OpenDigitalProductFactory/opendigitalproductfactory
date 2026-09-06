import { describe, expect, it } from "vitest";

import { buildWorkroomOutcomePacket } from "./outcome-packet";
import {
  completeWorkroomCycle,
  applyWorkroomCarryOver,
  openWorkroomCycle,
  type WorkroomCycleParentRecord,
  type WorkroomCycleStoreDb,
  type WorkroomCycleStoreMessage,
} from "./room-cycle-store";
import type { WorkroomCycleWorkItemRecord } from "./room-cycle-adapter";

const room: WorkroomCycleParentRecord = {
  id: "room-row",
  itemId: "ROOM-WEEKLY-CASH",
  sourceType: "scheduled",
  sourceId: "WEEKLY-CASH",
  title: "Weekly cash review",
  description: "Review cash position.",
  queueId: "queue-finance",
  teamId: "team-finance",
  urgency: "routine",
  effortClass: "medium",
  workerConstraint: { mode: "hybrid" },
  assignedToUserId: "user-finance",
  assignedToAgentId: null,
};

function harness() {
  const cycles: WorkroomCycleWorkItemRecord[] = [];
  const messages: WorkroomCycleStoreMessage[] = [];
  let next = 1;
  const db: WorkroomCycleStoreDb = {
    withinRoomLock: async (_roomWorkItemId, callback) => callback({
      getRoom: async () => room,
      listCycles: async () => cycles,
      listMessages: async () => messages,
      findWorkItemBySource: async (sourceType, sourceId) => cycles.find(
        (entry) => entry.sourceType === sourceType && entry.sourceId === sourceId,
      ) ?? null,
      createWorkItem: async (data) => {
        const cycle = {
          id: `cycle-row-${next}`,
          itemId: `WI-CYCLE-${next++}`,
          sourceType: String(data.sourceType),
          sourceId: String(data.sourceId),
          title: String(data.title),
          description: String(data.description),
          status: String(data.status),
          assignedToUserId: data.assignedToUserId as string | null,
          assignedToAgentId: data.assignedToAgentId as string | null,
          dueAt: data.dueAt as Date,
          evidence: data.evidence,
          createdAt: new Date("2026-07-27T09:00:00.000Z"),
        };
        cycles.push(cycle);
        return cycle;
      },
      completeCycle: async (id, completedAt) => {
        const cycle = cycles.find((entry) => entry.id === id)!;
        cycle.status = "completed";
        cycle.completedAt = completedAt;
      },
      appendMessage: async (data) => {
        const message = {
          messageId: `MSG-${messages.length + 1}`,
          messageType: String(data.messageType),
          structuredPayload: data.structuredPayload,
        };
        messages.push(message);
        return { messageId: message.messageId };
      },
    }),
  };
  return { db, cycles, messages };
}

function policy() {
  return {
    caseRef: { caseId: "scheduled:WEEKLY-CASH", sourceType: "scheduled", sourceId: "WEEKLY-CASH" },
    sourceKey: "scheduled",
    currentState: { state: "active" as const, terminal: false },
    envelope: {
      autonomyMode: "autonomous" as const,
      receiptPolicy: { required: true, kind: "governed-action" as const },
    },
  };
}

function openInput(db: WorkroomCycleStoreDb, cycleKey = "2026-W31") {
  return {
    db,
    roomWorkItemId: room.id,
    cycleKey,
    trigger: "Weekly schedule fired.",
    objective: "Review cash position and assign exceptions.",
    accountablePrincipalRef: "prn-finance-owner",
    expectedReviewAt: "2026-08-01T16:00:00.000Z",
    stopConditions: ["Stop if the ledger is unreconciled."],
    measureSummary: "All material variances have an owner.",
    contextRefs: [{ kind: "evidence" as const, id: "cash-position:2026-W31" }],
    actor: { type: "user" as const, id: "user-finance" },
    idempotencyKey: `open:${cycleKey}`,
    policy: policy(),
    shapeConformance: { hasDeclaredWorkShape: false, result: null },
    now: new Date("2026-07-27T09:00:00.000Z"),
  };
}

describe("Work Room cycle store", () => {
  it("opens one bounded child WorkItem and emits a governed lifecycle receipt", async () => {
    const state = harness();
    const result = await openWorkroomCycle(openInput(state.db));

    expect(result.idempotent).toBe(false);
    expect(state.cycles).toHaveLength(1);
    expect(state.cycles[0]).toMatchObject({ status: "in-progress", sourceType: "scheduled" });
    expect(state.messages[0]).toMatchObject({
      messageType: "work-room-cycle-opened",
      structuredPayload: {
        kind: "work-room-lifecycle-receipt",
        operation: "open-cycle",
        enforcementMode: "governed-action",
      },
    });
  });

  it("refuses a shaped lifecycle write before mutating when conformance is missing", async () => {
    const state = harness();
    await expect(openWorkroomCycle({
      ...openInput(state.db),
      shapeConformance: { hasDeclaredWorkShape: true, result: null },
    })).rejects.toMatchObject({
      reason: "policy_denied",
      decision: {
        reason: "shape_conformance_denied",
        deviationCodes: ["missing_conformance_result"],
      },
    });
    expect(state.cycles).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
  });

  it("makes retries idempotent and rejects a second active logical cycle", async () => {
    const state = harness();
    await openWorkroomCycle(openInput(state.db));
    expect((await openWorkroomCycle(openInput(state.db))).idempotent).toBe(true);
    await expect(openWorkroomCycle(openInput(state.db, "2026-W32")))
      .rejects.toMatchObject({ reason: "active_cycle_exists" });
    expect(state.cycles).toHaveLength(1);
  });

  it("seals completion in an append-only Outcome Packet and reuses it on retry", async () => {
    const state = harness();
    const opened = await openWorkroomCycle(openInput(state.db));
    const packet = buildWorkroomOutcomePacket({
      sourceKey: "scheduled",
      outcomeState: "achieved",
      summary: "Weekly cash review completed.",
      facts: [
        { category: "receipts", sourceRef: { kind: "receipt", id: "R-31" }, provenance: "canonical" },
        { category: "evidence", sourceRef: { kind: "runtime-verification", id: "RV-31" }, provenance: "canonical" },
      ],
      accountablePrincipalRef: "prn-finance-owner",
      completedAt: "2026-08-01T16:00:00.000Z",
    });
    const input = {
      db: state.db,
      roomWorkItemId: room.id,
      carrierId: opened.cycle.itemId,
      packet,
      actor: { type: "user" as const, id: "user-finance" },
      idempotencyKey: "complete:2026-W31",
      policy: policy(),
      shapeConformance: { hasDeclaredWorkShape: false, result: null },
      now: new Date("2026-08-01T16:00:00.000Z"),
    };

    expect((await completeWorkroomCycle(input)).idempotent).toBe(false);
    expect(state.cycles[0]?.status).toBe("completed");
    expect(state.messages.at(-1)).toMatchObject({
      messageType: "work-room-outcome-packet",
      structuredPayload: { packet },
    });
    expect((await completeWorkroomCycle(input)).idempotent).toBe(true);
    expect(state.messages).toHaveLength(2);
  });

  it("creates carry-over work once and attaches it to the target cycle", async () => {
    const state = harness();
    await openWorkroomCycle(openInput(state.db, "2026-W32"));
    const commands = [{
      kind: "attach-to-cycle" as const,
      summary: "Recheck late payment",
      ownerRef: "prn-finance-owner",
      targetCycleKey: "2026-W32",
      idempotencyKey: "carry:late-payment",
    }];

    const first = await applyWorkroomCarryOver({
      db: state.db,
      roomWorkItemId: room.id,
      commands,
      actor: { type: "user", id: "user-finance" },
      shapeConformance: { hasDeclaredWorkShape: false, result: null },
    });
    const second = await applyWorkroomCarryOver({
      db: state.db,
      roomWorkItemId: room.id,
      commands,
      actor: { type: "user", id: "user-finance" },
      shapeConformance: { hasDeclaredWorkShape: false, result: null },
    });

    expect(first.createdItemIds).toHaveLength(1);
    expect(second).toEqual({ createdItemIds: [], reusedItemIds: first.createdItemIds });
    expect(state.messages.at(-1)?.messageType).toBe("work-room-cycle-carried-over");
  });
});

// S-TRIG (BI-DC738330) — both triggers funnel through one idempotent open/advance of the
// standing Bookkeeping Work Room. Verified on the machinery with mock stores; the live
// reconciled period is owner-gated on a real statement export (no fictitious data).
import { describe, expect, it } from "vitest";

import type {
  WorkroomCycleParentRecord,
  WorkroomCycleStoreDb,
  WorkroomCycleStoreMessage,
} from "@/lib/work-management/room-cycle-store";
import type { WorkroomCycleWorkItemRecord } from "@/lib/work-management/room-cycle-adapter";
import { parseStoredWorkroomCycle } from "@/lib/work-management/room-cycle-adapter";
import type { RoomChannelIngressDb } from "@/lib/work-management/room-channel-ingress";

import {
  BOOKKEEPING_ROOM_SOURCE_ID,
  BOOKKEEPING_ROOM_SOURCE_TYPE,
  bookkeepingPeriodKey,
  buildBookkeepingCycleInput,
  openOrAdvanceBookkeepingPeriod,
} from "./bookkeeping-period-room";
import {
  ingestBookkeepingInbound,
  isBookkeepingRoomCaseId,
} from "./bookkeeping-inbound-trigger";

const room: WorkroomCycleParentRecord = {
  id: "books-room-row",
  itemId: "ROOM-BOOKS",
  sourceType: BOOKKEEPING_ROOM_SOURCE_TYPE,
  sourceId: BOOKKEEPING_ROOM_SOURCE_ID,
  title: "Bookkeeping",
  description: "The standing books-loop room.",
  queueId: "queue-bookkeeping",
  teamId: null,
  urgency: "routine",
  effortClass: "cognitive",
  workerConstraint: { workerType: "agent" },
  assignedToUserId: null,
  assignedToAgentId: "bookkeeper",
};

/** Mock cycle store seeded with an optional set of pre-existing cycles. */
function cycleHarness(seed: WorkroomCycleWorkItemRecord[] = []) {
  const cycles = [...seed];
  const messages: WorkroomCycleStoreMessage[] = [];
  let next = 1;
  const db: WorkroomCycleStoreDb = {
    withinRoomLock: async (_roomWorkItemId, callback) =>
      callback({
        getRoom: async () => room,
        listCycles: async () => cycles,
        listMessages: async () => messages,
        findWorkItemBySource: async (sourceType, sourceId) =>
          cycles.find((c) => c.sourceType === sourceType && c.sourceId === sourceId) ?? null,
        createWorkItem: async (data) => {
          const cycle: WorkroomCycleWorkItemRecord = {
            id: `cycle-row-${next}`,
            itemId: `WI-CYCLE-${next++}`,
            sourceType: String(data.sourceType),
            sourceId: String(data.sourceId),
            title: String(data.title),
            description: String(data.description),
            status: String(data.status),
            assignedToUserId: (data.assignedToUserId as string | null) ?? null,
            assignedToAgentId: (data.assignedToAgentId as string | null) ?? null,
            dueAt: data.dueAt as Date,
            evidence: data.evidence,
            createdAt: new Date("2026-08-26T09:00:00.000Z"),
          };
          cycles.push(cycle);
          return cycle;
        },
        completeCycle: async (id, completedAt) => {
          const cycle = cycles.find((c) => c.id === id)!;
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
  return { db, cycles };
}

function activeCycle(cycleKey: string): WorkroomCycleWorkItemRecord {
  return {
    id: `seed-${cycleKey}`,
    itemId: `WI-${cycleKey}`,
    sourceType: BOOKKEEPING_ROOM_SOURCE_TYPE,
    sourceId: BOOKKEEPING_ROOM_SOURCE_ID,
    title: `Bookkeeping — ${cycleKey}`,
    description: "Prior period still open.",
    status: "in-progress",
    assignedToUserId: null,
    assignedToAgentId: "bookkeeper",
    dueAt: new Date("2026-08-20T00:00:00.000Z"),
    evidence: {
      workroomCycle: {
        kind: "work-room-cycle",
        version: 1,
        cycleKey,
        trigger: "seed",
        objective: "seed",
        accountablePrincipalRef: "prn:user:owner",
        expectedReviewAt: "2026-08-20T00:00:00.000Z",
        stopConditions: [],
        measureSummary: "seed",
        contextRefs: [],
      },
    },
    createdAt: new Date("2026-08-13T09:00:00.000Z"),
  };
}

describe("bookkeepingPeriodKey", () => {
  it("produces an ISO-week key and is deterministic", () => {
    const d = new Date("2026-08-26T12:00:00.000Z");
    expect(bookkeepingPeriodKey(d)).toMatch(/^\d{4}-W\d{2}$/);
    expect(bookkeepingPeriodKey(d)).toBe(bookkeepingPeriodKey(new Date("2026-08-26T12:00:00.000Z")));
  });

  it("maps Monday and the following Sunday of one ISO week to the same key", () => {
    // 2026-08-24 is a Monday; 2026-08-30 is that week's Sunday.
    expect(bookkeepingPeriodKey(new Date("2026-08-24T00:00:00.000Z"))).toBe(
      bookkeepingPeriodKey(new Date("2026-08-30T23:59:00.000Z")),
    );
  });

  it("advances the key across a week boundary", () => {
    const thisWeek = bookkeepingPeriodKey(new Date("2026-08-26T00:00:00.000Z"));
    const nextWeek = bookkeepingPeriodKey(new Date("2026-09-02T00:00:00.000Z"));
    expect(nextWeek).not.toBe(thisWeek);
  });
});

describe("buildBookkeepingCycleInput", () => {
  const input = buildBookkeepingCycleInput({
    roomWorkItemId: "books-room-row",
    periodKey: "2026-W35",
    trigger: "Weekly bookkeeping cadence fired.",
    accountablePrincipalRef: "prn:user:owner",
    actor: { type: "agent", id: "bookkeeper" },
    now: new Date("2026-08-26T09:00:00.000Z"),
  });

  it("keys the cycle and idempotency on the period", () => {
    expect(input.cycleKey).toBe("2026-W35");
    expect(input.idempotencyKey).toBe("bookkeeping-open:2026-W35");
    expect(input.contextRefs[0]).toEqual({ kind: "evidence", id: "bookkeeping-period:2026-W35" });
  });

  it("carries the no-fabrication stop condition and a governed-action receipt policy", () => {
    expect(input.stopConditions.some((c) => /never fabricate/i.test(c))).toBe(true);
    expect(input.policy.envelope.autonomyMode).toBe("autonomous");
    expect(input.policy.envelope.receiptPolicy?.kind).toBe("governed-action");
    expect(input.policy.caseRef.sourceType).toBe(BOOKKEEPING_ROOM_SOURCE_TYPE);
  });
});

describe("openOrAdvanceBookkeepingPeriod", () => {
  const base = {
    trigger: "Weekly bookkeeping cadence fired.",
    accountablePrincipalRef: "prn:user:owner",
    actor: { type: "agent" as const, id: "bookkeeper" },
    roomWorkItemId: "books-room-row",
    now: new Date("2026-08-26T09:00:00.000Z"),
  };

  it("opens a cycle for a fresh period", async () => {
    const { db, cycles } = cycleHarness();
    const result = await openOrAdvanceBookkeepingPeriod({ ...base, periodKey: "2026-W35", db });
    expect(result.opened).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(cycles).toHaveLength(1);
    expect(parseStoredWorkroomCycle(cycles[0]!.evidence)?.cycleKey).toBe("2026-W35");
  });

  it("is idempotent when the same period fires again", async () => {
    const { db } = cycleHarness();
    await openOrAdvanceBookkeepingPeriod({ ...base, periodKey: "2026-W35", db });
    const again = await openOrAdvanceBookkeepingPeriod({ ...base, periodKey: "2026-W35", db });
    expect(again.idempotent).toBe(true);
    expect(again.opened).toBe(false);
  });

  it("treats a prior period's still-open cycle as already-active, not an error", async () => {
    const { db } = cycleHarness([activeCycle("2026-W34")]);
    const result = await openOrAdvanceBookkeepingPeriod({ ...base, periodKey: "2026-W35", db });
    expect(result.alreadyActive).toBe(true);
    expect(result.opened).toBe(false);
  });
});

describe("isBookkeepingRoomCaseId", () => {
  it("matches only the bookkeeping-period room", () => {
    expect(isBookkeepingRoomCaseId("bookkeeping-period:books")).toBe(true);
    expect(isBookkeepingRoomCaseId("scheduled:WEEKLY-CASH")).toBe(false);
    expect(isBookkeepingRoomCaseId("opportunity:OPP-1")).toBe(false);
  });
});

describe("ingestBookkeepingInbound (on-arrival trigger)", () => {
  const event = {
    channelType: "email",
    providerKey: "postmark",
    providerAccountId: "acct-books",
    providerEventId: "evt-1",
    externalSubject: "statements@operator.example",
    body: "March bank statement attached.",
    requestedAction: null,
    sensitivity: "internal",
    authenticationMethods: [] as readonly string[],
    adapterCapabilities: { inbound: true, interactive: true, deliveryReceipts: false },
  };

  /** Ingress mock that resolves an accepted event onto a given room sourceType. */
  function ingressFor(sourceType: string): RoomChannelIngressDb {
    return {
      communicationChannelBinding: {
        findFirst: async () => ({ principal: { principalId: "prn-owner" } }),
      },
      communicationChannelSession: {
        findFirst: async () => ({ workItemId: "books-room-row", principal: { principalId: "prn-owner" } }),
      },
      workItem: {
        findUnique: async () => ({ id: "books-room-row", itemId: "ROOM-BOOKS", sourceType, sourceId: "books" }),
      },
      workItemMessage: {
        findUnique: async () => null,
        upsert: async () => ({}),
      },
    };
  }

  it("advances the books cycle when a statement is accepted onto the bookkeeping room", async () => {
    const { db, cycles } = cycleHarness();
    const result = await ingestBookkeepingInbound({
      ingressDb: ingressFor(BOOKKEEPING_ROOM_SOURCE_TYPE),
      event,
      now: new Date("2026-08-26T09:00:00.000Z"),
      cycleDb: db,
      roomWorkItemId: "books-room-row",
    });
    expect(result.ingest.status).toBe("accepted");
    expect(result.advanced).toBe(true);
    expect(result.opened).toBe(true);
    expect(cycles).toHaveLength(1);
  });

  it("passes a non-bookkeeping room through without advancing any cycle", async () => {
    const { db, cycles } = cycleHarness();
    const result = await ingestBookkeepingInbound({
      ingressDb: ingressFor("opportunity"),
      event,
      cycleDb: db,
      roomWorkItemId: "books-room-row",
    });
    expect(result.advanced).toBe(false);
    expect(cycles).toHaveLength(0);
  });

  it("does not advance when the inbound event is not accepted (no binding)", async () => {
    const { db, cycles } = cycleHarness();
    const noBinding: RoomChannelIngressDb = {
      communicationChannelBinding: { findFirst: async () => null },
      communicationChannelSession: { findFirst: async () => null },
      workItem: { findUnique: async () => null },
      workItemMessage: { findUnique: async () => null, upsert: async () => ({}) },
    };
    const result = await ingestBookkeepingInbound({ ingressDb: noBinding, event, cycleDb: db });
    expect(result.ingest.status).not.toBe("accepted");
    expect(result.advanced).toBe(false);
    expect(cycles).toHaveLength(0);
  });
});

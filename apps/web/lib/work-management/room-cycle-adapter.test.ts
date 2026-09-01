import { describe, expect, it } from "vitest";

import { buildWorkroomOutcomePacket } from "./outcome-packet";
import {
  projectWorkItemCycleCarriers,
  projectStoredWorkroomOutcomePackets,
  WORKROOM_CYCLE_EVIDENCE_KIND,
  WORKROOM_OUTCOME_MESSAGE_TYPE,
} from "./room-cycle-adapter";
import { OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY } from "./work-shapes";

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

function item(status = "in-progress") {
  return {
    id: "row-cycle-31",
    itemId: "WI-CYCLE-31",
    sourceType: "scheduled",
    sourceId: "WEEKLY-CASH",
    title: "Weekly cash review — 2026-W31",
    description: "Review cash position and assign exceptions.",
    status,
    assignedToUserId: "user-finance",
    dueAt: "2026-08-01T16:00:00.000Z",
    createdAt: "2026-07-27T09:00:00.000Z",
    evidence: {
      workroomCycle: {
        kind: WORKROOM_CYCLE_EVIDENCE_KIND,
        version: 1,
        cycleKey: "2026-W31",
        trigger: "Weekly schedule fired.",
        objective: "Review cash position and assign exceptions.",
        accountablePrincipalRef: "prn-finance-owner",
        expectedReviewAt: "2026-08-01T16:00:00.000Z",
        stopConditions: ["Stop if the ledger is unreconciled."],
        measureSummary: "All material variances have an owner.",
        contextRefs: [{ kind: "evidence", id: "cash-position:2026-W31" }],
      },
    },
  };
}

describe("Work Room cycle source adapter", () => {
  it("projects a child WorkItem boundary without guessing from title or age", () => {
    const candidates = projectWorkItemCycleCarriers({ items: [item()], messages: [] });

    expect(candidates).toEqual([expect.objectContaining({
      cycleKey: "2026-W31",
      carrierKind: "work-item",
      carrierId: "WI-CYCLE-31",
      status: "open",
      outcomePacket: null,
    })]);
  });

  it("reconstructs a sealed packet identically from the append-only message", () => {
    const candidates = projectWorkItemCycleCarriers({
      items: [item("completed")],
      messages: [{
        messageId: "MSG-OUTCOME-31",
        messageType: WORKROOM_OUTCOME_MESSAGE_TYPE,
        structuredPayload: {
          kind: WORKROOM_OUTCOME_MESSAGE_TYPE,
          version: 1,
          cycleKey: "2026-W31",
          carrierId: "WI-CYCLE-31",
          packet,
        },
      }],
    });

    expect(candidates[0]?.status).toBe("closed");
    expect(candidates[0]?.outcomePacket).toEqual(packet);
  });

  it("ignores generic evidence and raw chat instead of inventing a cycle or packet", () => {
    expect(projectWorkItemCycleCarriers({
      items: [{ ...item(), evidence: { summary: "Maybe a weekly cycle" } }],
      messages: [{ messageId: "MSG-CHAT", messageType: "comment", structuredPayload: { packet } }],
    })).toEqual([]);
  });

  it("orders completed packets deterministically for room-level outcomes", () => {
    const earlier = { ...packet, completedAt: "2026-07-25T16:00:00.000Z" };
    const messages = [earlier, packet].map((storedPacket, index) => ({
      messageId: `MSG-${index}`,
      messageType: WORKROOM_OUTCOME_MESSAGE_TYPE,
      structuredPayload: {
        kind: WORKROOM_OUTCOME_MESSAGE_TYPE,
        version: 1,
        cycleKey: `cycle-${index}`,
        carrierId: `WI-${index}`,
        packet: storedPacket,
      },
    }));

    expect(projectStoredWorkroomOutcomePackets(messages)).toEqual([packet, earlier]);
  });
});

describe("declared work-shape claim projects a cycle", () => {
  const openedAt = "2026-08-21T00:00:00.000Z";
  const validClaim = [{ workShape: `${OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY}@1.0.0` }];

  it("projects trigger, stopConditions, and expectedReviewAt from the declared shape", () => {
    const candidates = projectWorkItemCycleCarriers({
      items: [],
      messages: [],
      scopeClaims: validClaim,
      capsuleId: "WC-SHAPE-1",
      openedAt,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.carrierKind).toBe("work-capsule");
    expect(candidates[0]?.trigger).toBe(`cadence:${OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY}@1.0.0`);
    expect(candidates[0]?.expectedReviewAt).toBe("2026-09-20T00:00:00.000Z");
    expect(candidates[0]?.stopConditions.some((stop) => stop.startsWith("failure:"))).toBe(true);
    expect(candidates[0]?.stopConditions.some((stop) => stop.startsWith("budget:"))).toBe(true);
  });

  it("leaves a room with no claim byte-identical to current behavior", () => {
    const without = projectWorkItemCycleCarriers({ items: [item()], messages: [] });
    const withUndefined = projectWorkItemCycleCarriers({
      items: [item()],
      messages: [],
      scopeClaims: undefined,
    });
    expect(withUndefined).toEqual(without);
    expect(projectWorkItemCycleCarriers({ items: [item()], messages: [], scopeClaims: [] })).toEqual(without);
  });

  it("resolves unknown or unparseable claims as no cycle and never throws", () => {
    expect(projectWorkItemCycleCarriers({
      items: [],
      messages: [],
      scopeClaims: [{ workShape: "not-a-shape@1.0.0" }],
      capsuleId: "WC-UNKNOWN",
      openedAt,
    })).toEqual([]);
    expect(projectWorkItemCycleCarriers({
      items: [],
      messages: [],
      scopeClaims: [{ workShape: "garbage" }],
      capsuleId: "WC-BAD",
      openedAt,
    })).toEqual([]);
  });
});

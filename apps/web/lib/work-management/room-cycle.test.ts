import { describe, expect, it } from "vitest";

import type { WorkCaseSourceRef } from "./case-types";
import { buildWorkroomOutcomePacket } from "./outcome-packet";
import {
  buildWorkroomCycle,
  evaluateWorkroomCyclePolicy,
  planWorkroomCarryOver,
  selectCompletedWorkroomCycles,
  selectCurrentWorkroomCycle,
  WorkroomCycleError,
  type WorkroomCycleCarrierCandidate,
} from "./room-cycle";

const roomRef: WorkCaseSourceRef = { kind: "source", id: "WEEKLY-CASH", sourceType: "scheduled" };
const contextRef: WorkCaseSourceRef = { kind: "evidence", id: "cash-position:2026-W31" };
const receiptRef: WorkCaseSourceRef = { kind: "receipt", id: "R-1" };
const verificationRef: WorkCaseSourceRef = { kind: "runtime-verification", id: "RV-1", status: "passed" };

function candidate(overrides: Partial<WorkroomCycleCarrierCandidate> = {}): WorkroomCycleCarrierCandidate {
  return {
    cycleKey: "2026-W31",
    carrierKind: "work-item",
    carrierId: "WI-CYCLE-31",
    trigger: "Weekly schedule fired.",
    objective: "Review cash position and assign exceptions.",
    accountablePrincipalRef: "prn-finance-owner",
    openedAt: "2026-07-27T09:00:00.000Z",
    expectedReviewAt: "2026-08-01T16:00:00.000Z",
    stopConditions: ["Stop if the ledger is unreconciled."],
    measureSummary: "All material variances have an owner.",
    contextRefs: [contextRef],
    status: "open",
    sourceRefs: [roomRef],
    ...overrides,
  };
}

function policy() {
  return {
    caseRef: { caseId: "scheduled:WEEKLY-CASH", sourceType: "scheduled", sourceId: "WEEKLY-CASH" },
    sourceKey: "scheduled",
    currentState: { state: "active" as const, terminal: false },
    envelope: {
      autonomyMode: "supervised" as const,
      receiptPolicy: { required: true, kind: "governed-action" as const },
    },
    coworkerEnvelope: {
      envelopeId: "CAE-ROOM-CYCLE",
      status: "approved" as const,
    },
  };
}

describe("standing Work Room cycles", () => {
  it("allows a finite room to complete without a recurring cycle", () => {
    expect(selectCurrentWorkroomCycle("booking", [])).toBeNull();
  });

  it("uses source-owned precedence when multiple carriers describe one logical cycle", () => {
    const cycle = selectCurrentWorkroomCycle("scheduled", [
      candidate({ carrierKind: "task-run", carrierId: "TR-31" }),
      candidate({ carrierKind: "work-capsule", carrierId: "WC-31" }),
      candidate({ carrierKind: "work-item", carrierId: "WI-31" }),
    ]);

    expect(cycle).toMatchObject({ cycleKey: "2026-W31", carrierKind: "work-item", carrierId: "WI-31" });
  });

  it("rejects two distinct active cycles in one standing room", () => {
    expect(() => selectCurrentWorkroomCycle("scheduled", [
      candidate(),
      candidate({ cycleKey: "2026-W32", carrierId: "WI-CYCLE-32" }),
    ])).toThrowError(expect.objectContaining<Partial<WorkroomCycleError>>({ reason: "multiple_active_cycles" }));
  });

  it("requires a bounded charter and scoped context", () => {
    expect(() => selectCurrentWorkroomCycle("scheduled", [candidate({ contextRefs: [], measureSummary: null })]))
      .toThrowError(expect.objectContaining<Partial<WorkroomCycleError>>({ reason: "missing_cycle_boundary" }));
  });

  it("requires a sealed Outcome Packet on a closed cycle", () => {
    expect(() => buildWorkroomCycle(candidate({ status: "closed" })))
      .toThrowError(expect.objectContaining<Partial<WorkroomCycleError>>({ reason: "missing_cycle_boundary" }));

    const packet = buildWorkroomOutcomePacket({
      sourceKey: "scheduled",
      outcomeState: "achieved",
      summary: "Review completed.",
      facts: [
        { category: "receipts", sourceRef: receiptRef, provenance: "canonical" },
        { category: "evidence", sourceRef: verificationRef, provenance: "canonical" },
      ],
      accountablePrincipalRef: "prn-finance-owner",
      completedAt: "2026-08-01T16:00:00.000Z",
    });
    expect(buildWorkroomCycle(candidate({ status: "closed", outcomePacket: packet }))).toMatchObject({
      status: "closed",
      outcomePacket: packet,
    });
  });

  it("projects one deterministic completed cycle per logical cycle", () => {
    const packet = buildWorkroomOutcomePacket({
      sourceKey: "scheduled",
      outcomeState: "achieved",
      summary: "Review completed.",
      facts: [
        { category: "receipts", sourceRef: receiptRef, provenance: "canonical" },
        { category: "evidence", sourceRef: verificationRef, provenance: "canonical" },
      ],
      accountablePrincipalRef: "prn-finance-owner",
      completedAt: "2026-08-01T16:00:00.000Z",
    });
    const completed = selectCompletedWorkroomCycles("scheduled", [
      candidate({ status: "closed", outcomePacket: packet, carrierKind: "task-run", carrierId: "TR-31" }),
      candidate({ status: "closed", outcomePacket: packet, carrierKind: "work-item", carrierId: "WI-31" }),
    ]);

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ carrierKind: "work-item", carrierId: "WI-31" });
  });

  it("denies consequential writes to a sealed cycle but permits renewal", () => {
    const sealed = { ...selectCurrentWorkroomCycle("scheduled", [candidate()])!, status: "closed" as const };
    expect(evaluateWorkroomCyclePolicy({ operation: "split", cycle: sealed, policy: policy() })).toMatchObject({
      ok: false,
      reason: "closed_cycle_sealed",
    });
    expect(evaluateWorkroomCyclePolicy({ operation: "renew", cycle: sealed, policy: policy() })).toMatchObject({
      ok: true,
      requiredReceiptKind: "governed-action",
    });
  });

  it("maps renew, split, carry-over, and archive through receipt-emitting governed actions", () => {
    const active = selectCurrentWorkroomCycle("scheduled", [candidate()]);
    for (const operation of ["split", "carry-over"] as const) {
      expect(evaluateWorkroomCyclePolicy({ operation, cycle: active, policy: policy() })).toMatchObject({
        ok: true,
        enforcementMode: "governed-action",
        requiredReceiptKind: "governed-action",
      });
    }
    expect(evaluateWorkroomCyclePolicy({ operation: "archive", cycle: null, policy: policy() })).toMatchObject({ ok: true });
  });

  it("runs shaped lifecycle operations through the shared fail-closed conformance guard", () => {
    const active = selectCurrentWorkroomCycle("scheduled", [candidate()]);
    expect(evaluateWorkroomCyclePolicy({
      operation: "split",
      cycle: active,
      policy: policy(),
      shapeConformance: { hasDeclaredWorkShape: true, result: null },
    })).toMatchObject({
      ok: false,
      reason: "shape_conformance_denied",
      deviationCodes: ["missing_conformance_result"],
    });
  });

  it("plans carry-over attachment and new-case creation idempotently", () => {
    const packet = buildWorkroomOutcomePacket({
      sourceKey: "scheduled",
      outcomeState: "partially-achieved",
      summary: "Weekly review completed with follow-up work.",
      facts: [
        { category: "receipts", sourceRef: receiptRef, provenance: "canonical" },
        { category: "evidence", sourceRef: verificationRef, provenance: "canonical" },
      ],
      unresolvedWork: [
        { summary: "Recheck late payment", ownerRef: "prn-finance-owner", disposition: "carry-over" },
        { summary: "Open collections case", ownerRef: null, disposition: "new-case" },
        { summary: "Accept small rounding delta", ownerRef: null, disposition: "accepted" },
      ],
      accountablePrincipalRef: "prn-finance-owner",
      completedAt: "2026-08-01T16:00:00.000Z",
    });
    const input = {
      roomKey: "scheduled%3AWEEKLY-CASH",
      fromCycleKey: "2026-W31",
      toCycleKey: "2026-W32",
      unresolvedWork: packet.unresolvedWork,
    };

    const first = planWorkroomCarryOver(input);
    const second = planWorkroomCarryOver(input);
    expect(first).toHaveLength(2);
    expect(first.map((command) => command.kind)).toEqual(["attach-to-cycle", "create-case"]);
    expect(second).toEqual(first);
    expect(new Set(first.map((command) => command.idempotencyKey)).size).toBe(2);
  });
});

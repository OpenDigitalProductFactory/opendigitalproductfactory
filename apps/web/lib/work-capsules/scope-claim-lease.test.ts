// BI-2D65BD1B — an ordinary scope claim on the caller's own room is not an
// authority change; a forced claim, or one over another principal's live
// lease, still is. The gate and the store read the same rule.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));

import { resolveEscalation } from "@/lib/govern/authority/escalation-gate";

import { claimWorkCapsuleScope, type CapsuleDb } from "./work-capsule-store";
import { scopeClaimConsequenceForCall } from "./scope-claim-consequence";
import {
  assertScopeClaimLease,
  classifyScopeClaim,
  liveLeaseHeldByAnother,
  ScopeClaimLeaseHeldError,
  type ScopeClaimRoom,
} from "./scope-claim-lease";

const NOW = new Date("2026-09-24T00:00:00.000Z");
const LATER = new Date("2026-09-24T00:30:00.000Z");
const EARLIER = new Date("2026-09-23T23:30:00.000Z");

function room(overrides: Partial<ScopeClaimRoom> = {}): ScopeClaimRoom {
  return { status: "working", archivedAt: null, leaseHolderPrincipalId: "PRN-ME", leaseExpiresAt: LATER, ...overrides };
}

describe("liveLeaseHeldByAnother", () => {
  it.each([
    ["no holder", room({ leaseHolderPrincipalId: null }), false],
    ["the caller holds it", room(), false],
    ["another holds a lapsed lease", room({ leaseHolderPrincipalId: "PRN-OTHER", leaseExpiresAt: EARLIER }), false],
    ["another holds it with no expiry", room({ leaseHolderPrincipalId: "PRN-OTHER", leaseExpiresAt: null }), false],
    ["another holds a live lease", room({ leaseHolderPrincipalId: "PRN-OTHER" }), true],
  ])("%s → %s", (_label, input, expected) => {
    expect(liveLeaseHeldByAnother(input, "PRN-ME", NOW)).toBe(expected);
  });
});

describe("classifyScopeClaim", () => {
  it("an ordinary claim on the caller's own room is not an authority change", () => {
    expect(classifyScopeClaim({ force: false, room: room(), callerPrincipalId: "PRN-ME", now: NOW }))
      .toEqual({ consequence: null, reason: "ordinary-claim" });
  });

  it("a claim on a room whose lease lapsed is ordinary", () => {
    const lapsed = room({ leaseHolderPrincipalId: "PRN-OTHER", leaseExpiresAt: EARLIER });
    expect(classifyScopeClaim({ force: false, room: lapsed, callerPrincipalId: "PRN-ME", now: NOW }).consequence)
      .toBeNull();
  });

  it("a forced claim keeps the authority consequence even on the caller's own room", () => {
    expect(classifyScopeClaim({ force: true, room: room(), callerPrincipalId: "PRN-ME", now: NOW }))
      .toEqual({ consequence: "authority", reason: "forced-co-claim" });
  });

  it("a claim over another principal's live lease keeps the authority consequence", () => {
    const held = room({ leaseHolderPrincipalId: "PRN-OTHER" });
    expect(classifyScopeClaim({ force: false, room: held, callerPrincipalId: "PRN-ME", now: NOW }))
      .toEqual({ consequence: "authority", reason: "live-lease-held-by-another" });
  });

  it.each([
    ["an unknown room", null],
    ["an archived room", room({ archivedAt: EARLIER })],
    ["a terminal room", room({ status: "abandoned" })],
  ])("%s stays gated", (_label, input) => {
    expect(classifyScopeClaim({ force: false, room: input, callerPrincipalId: "PRN-ME", now: NOW }))
      .toEqual({ consequence: "authority", reason: "room-not-claimable" });
  });
});

describe("assertScopeClaimLease", () => {
  it("refuses a non-forced claim over another principal's live lease", () => {
    expect(() => assertScopeClaimLease(room({ leaseHolderPrincipalId: "PRN-OTHER" }), "PRN-ME", false, NOW))
      .toThrow(ScopeClaimLeaseHeldError);
  });

  it("allows a forced claim, which the gate has already put before a person", () => {
    expect(() => assertScopeClaimLease(room({ leaseHolderPrincipalId: "PRN-OTHER" }), "PRN-ME", true, NOW))
      .not.toThrow();
  });
});

describe("scopeClaimConsequenceForCall", () => {
  const reader = (row: ScopeClaimRoom | null) => ({ workroom: { findUnique: vi.fn(async () => row) } });
  const resolveActor = vi.fn(async () => ({ userId: "user-1", agentId: "AGT-EXT-CODEX", principalId: "PRN-ME" }));

  it("resolves the caller as the handler will and classifies the call", async () => {
    const db = reader(room());
    const result = await scopeClaimConsequenceForCall(
      {
        toolName: "claim_workroom_scope",
        params: { capsuleId: "WC-MINE0001", claims: [] },
        userId: "user-1",
        context: { agentId: "AGT-EXT-CODEX", authSource: "oauth" },
        now: NOW,
      },
      { db, resolveActor: resolveActor as never },
    );
    expect(result).toEqual({ consequence: null, reason: "ordinary-claim" });
    expect(resolveActor).toHaveBeenCalledWith("user-1", { agentId: "AGT-EXT-CODEX", authSource: "oauth" });
    expect(db.workroom.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { capsuleId: "WC-MINE0001" } }));
  });

  it("treats a missing capsuleId as an unclaimable room", async () => {
    const result = await scopeClaimConsequenceForCall(
      { toolName: "claim_workroom_scope", params: { force: false }, userId: "user-1", now: NOW },
      { db: reader(null), resolveActor: resolveActor as never },
    );
    expect(result.consequence).toBe("authority");
  });
});

describe("claimWorkCapsuleScope honours the same lease rule", () => {
  function storeDb(row: Record<string, unknown>) {
    const db = {
      workroom: {
        findUnique: vi.fn(async () => row),
        findMany: vi.fn(async () => []),
        update: vi.fn(async () => ({ ...row })),
      },
      workroomActivity: { create: vi.fn(async () => ({ id: "act-1" })) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    };
    return db;
  }
  const actor = { userId: "user-1", agentId: "AGT-EXT-CODEX", principalId: "PRN-ME" };
  const base = { id: "row-1", capsuleId: "WC-MINE0001", status: "working", archivedAt: null, scopeClaims: [] };

  it("refuses to take another principal's live lease without force and writes nothing", async () => {
    const db = storeDb({ ...base, leaseHolderPrincipalId: "PRN-OTHER", leaseExpiresAt: LATER });
    await expect(claimWorkCapsuleScope({
      db: db as unknown as CapsuleDb,
      capsuleId: "WC-MINE0001",
      claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
      actor,
      now: NOW,
    })).rejects.toBeInstanceOf(ScopeClaimLeaseHeldError);
    expect(db.workroom.update).not.toHaveBeenCalled();
  });

  it("writes an ordinary claim on the caller's own room", async () => {
    const db = storeDb({ ...base, leaseHolderPrincipalId: "PRN-ME", leaseExpiresAt: LATER });
    await claimWorkCapsuleScope({
      db: db as unknown as CapsuleDb,
      capsuleId: "WC-MINE0001",
      claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
      actor,
      now: NOW,
    });
    expect(db.workroom.update).toHaveBeenCalledTimes(1);
  });
});

describe("end to end with the escalation gate (OAuth assistant under its human's consent)", () => {
  const gate = (consequence: "authority" | null) => resolveEscalation({
    action: { sideEffect: true, executionMode: "immediate", consequence },
    dataPolicy: { sensitivity: "internal" },
    operatorRequiresApproval: true,
    steering: "connection-delegation",
  });

  it("an ordinary own-room claim is decided by the connection consent, not a person", () => {
    const { consequence } = classifyScopeClaim({ force: false, room: room(), callerPrincipalId: "PRN-ME", now: NOW });
    expect(gate(consequence)).toMatchObject({ verdict: "automated", reasonCode: "steered-by-connection-delegation" });
  });

  it("a forced claim still goes to a person", () => {
    const { consequence } = classifyScopeClaim({ force: true, room: room(), callerPrincipalId: "PRN-ME", now: NOW });
    expect(gate(consequence)).toMatchObject({ verdict: "human", reasonCode: "damaging-consequence" });
  });

  it("a claim over another principal's live lease still goes to a person", () => {
    const held = room({ leaseHolderPrincipalId: "PRN-OTHER" });
    const { consequence } = classifyScopeClaim({ force: false, room: held, callerPrincipalId: "PRN-ME", now: NOW });
    expect(gate(consequence)).toMatchObject({ verdict: "human", reasonCode: "damaging-consequence" });
  });
});

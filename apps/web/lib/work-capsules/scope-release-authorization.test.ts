import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
import { releaseWorkCapsuleScope } from "./work-capsule-store";
import { classifyScopeRelease, scopeReleaseWasOrdinary, OWN_SCOPE_RELEASE_REASON } from "./scope-release-authorization";
import type { CapsuleDb } from "./work-capsule-store-types";

const now = new Date("2026-10-14T03:00:00Z");
const actor = { userId: "user-a", agentId: "agent-a", principalId: "principal-a" };
const claim = { kind: "path" as const, value: "file.ts", intent: "edit" as const,
  recordedAt: now.toISOString(), recordedByPrincipalId: "principal-a" };
const room = { id: "row-a", capsuleId: "WC-A", status: "working", archivedAt: null,
  updatedAt: now, scopeClaims: [claim], leaseHolderPrincipalId: "principal-a",
  leaseExpiresAt: new Date("2026-10-14T03:30:00Z") };
function store(row: Record<string, unknown>) {
  const db = { workroom: { findUnique: vi.fn(async () => row),
    update: vi.fn(async () => row) }, workroomActivity: { create: vi.fn(async () => ({ id: "activity-a" })) } };
  return db;
}

describe("ordinary release is revalidated at mutation", () => {
  it("requires positive principal proof and rejects an entire mixed request", () => {
    expect(classifyScopeRelease({ room, capsuleId: "WC-A", claims: [claim], callerPrincipalId: null, now }).consequence).toBe("authority");
    const foreign = { ...claim, value: "foreign.ts", recordedByPrincipalId: "principal-b" };
    expect(classifyScopeRelease({ room: { ...room, scopeClaims: [claim, foreign] },
      capsuleId: "WC-A", claims: [claim, foreign], callerPrincipalId: "principal-a", now }).consequence).toBe("authority");
  });
  it.each([
    ["new claim owner", { scopeClaims: [{ ...claim, recordedByPrincipalId: "principal-b" }] }],
    ["new lease holder", { leaseHolderPrincipalId: "principal-b" }],
    ["lease expired", { leaseExpiresAt: now }],
    ["room archived", { archivedAt: now }],
    ["wrong room readback", { capsuleId: "WC-B" }],
  ])("refuses %s before removing scope", async (_label, changes) => {
    const db = store({ ...room, ...changes });
    await expect(releaseWorkCapsuleScope({ db: db as unknown as CapsuleDb,
      capsuleId: "WC-A", claims: [claim], actor, ownScopeOnly: true, now })).rejects.toThrow();
    expect(db.workroom.update).not.toHaveBeenCalled();
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("retains extension records and the current snapshot CAS while giving back only exact requested scope", async () => {
    const extension = { workShape: "delivery-large@1.0.0", recordedAt: now.toISOString() };
    const other = { ...claim, value: "file.tsx", recordedByPrincipalId: "principal-b" };
    const row = { ...room, scopeClaims: [extension, claim, other] };
    const db = store(row);
    await releaseWorkCapsuleScope({ db: db as unknown as CapsuleDb, capsuleId: "WC-A",
      claims: [claim], actor, ownScopeOnly: true, now });
    expect(db.workroom.update).toHaveBeenCalledWith({ where: { capsuleId: "WC-A",
      scopeClaims: { equals: row.scopeClaims }, updatedAt: now }, data: { scopeClaims: [extension, other] } });
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: "scope-released", payload: { released: [claim] }, recordedById: "user-a", recordedByAgentId: "agent-a",
    }) }));
  });

  it("does not record an effect after losing a concurrent snapshot comparison", async () => {
    const db = store(room);
    db.workroom.update.mockRejectedValueOnce(new Error("snapshot changed"));
    await expect(releaseWorkCapsuleScope({ db: db as unknown as CapsuleDb, capsuleId: "WC-A",
      claims: [claim], actor, ownScopeOnly: true, now })).rejects.toThrow("snapshot changed");
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("preserves an exact no-op retry on a live owned room and the established approved foreign release path", async () => {
    const empty = store({ ...room, scopeClaims: [] });
    await releaseWorkCapsuleScope({ db: empty as unknown as CapsuleDb, capsuleId: "WC-A",
      claims: [claim], actor, ownScopeOnly: true, now });
    expect(empty.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: { released: [] } }) }));
    const foreign = { ...claim, recordedByPrincipalId: "principal-b" };
    const approved = store({ ...room, scopeClaims: [foreign], leaseHolderPrincipalId: "principal-b" });
    await releaseWorkCapsuleScope({ db: approved as unknown as CapsuleDb, capsuleId: "WC-A", claims: [claim], actor });
    expect(approved.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: { released: [foreign] } }) }));
  });
});

describe("current monitor decision", () => {
  const context = { agentId: "agent-a", authorityDecisionId: "AUTH-current" };
  const allowed = { actionKey: "release_workroom_scope", actorRef: "agent-a",
    humanContextRef: "user-a", agentContextRef: "agent-a", decision: "allow",
    rationale: { consequenceRefinement: { declared: "authority", reason: OWN_SCOPE_RELEASE_REASON } } };
  it("uses the existing allowed decision, with exact human and assistant", async () => {
    const db = { authorizationDecisionLog: { findUnique: vi.fn(async () => allowed) } };
    expect(await scopeReleaseWasOrdinary("user-a", context, db)).toBe(true);
    expect(db.authorizationDecisionLog.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { decisionId: "AUTH-current" } }));
  });
  it.each([
    { humanContextRef: "other-user" }, { actorRef: "other-agent" },
    { agentContextRef: "other-agent" }, { actionKey: "claim_workroom_scope" },
    { decision: "deny" }, { decision: "require-approval" },
  ])("refuses a mismatched or inactive decision %j", async (changes) => {
    const db = { authorizationDecisionLog: { findUnique: vi.fn(async () => ({ ...allowed, ...changes })) } };
    await expect(scopeReleaseWasOrdinary("user-a", context, db)).rejects.toThrow("does not match");
  });
  it("does not fabricate a missing decision or create a new approval", async () => {
    await expect(scopeReleaseWasOrdinary("user-a", { agentId: "agent-a" })).rejects.toThrow("unavailable");
    const db = { authorizationDecisionLog: { findUnique: vi.fn(async () => null) } };
    await expect(scopeReleaseWasOrdinary("user-a", context, db)).rejects.toThrow("does not match");
  });
  it("preserves established human and non-refined approved/graduated paths", async () => {
    expect(await scopeReleaseWasOrdinary("user-a", undefined)).toBe(false);
    const db = { authorizationDecisionLog: { findUnique: vi.fn(async () => ({ ...allowed, rationale: { escalationReason: "operator-graduated" } })) } };
    expect(await scopeReleaseWasOrdinary("user-a", context, db)).toBe(false);
  });
});

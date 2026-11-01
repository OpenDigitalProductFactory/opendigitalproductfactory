// BI-E8C78E80 — rooms created before delivery work was born owned get their
// owner from their own record, and a paused delivery room then advances.
import { describe, expect, it, vi } from "vitest";

import {
  isDeliveryRoom,
  repairUnownedDeliveryRooms,
  resolveExistingRoomOwnership,
  roomOwnerUserId,
  type UnownedDeliveryRoom,
} from "./delivery-room-ownership";
import { evaluateWorkroomShapeConformance } from "./workroom-shape-conformance";
import { DELIVERY_SHAPES } from "./delivery-shapes";
import { projectPersistedWorkroomRoster } from "./room-participant-assignment";

const person = (id: string) => ({ id, kind: "human", status: "active" });
const agent = (id: string) => ({ id, kind: "agent", status: "active" });
const DELIVERY_CLAIMS = [{ source: "declared", workShape: "delivery-medium@1.0.0" }];

function room(overrides: Partial<UnownedDeliveryRoom> = {}): UnownedDeliveryRoom {
  return {
    id: "room-1",
    scopeClaims: DELIVERY_CLAIMS,
    requestedByPrincipal: null,
    createdByPrincipal: null,
    leaseHolderPrincipal: null,
    firstRecordedByUserId: null,
    ...overrides,
  };
}

describe("resolveExistingRoomOwnership", () => {
  it("the requester is the owner and the creating assistant is admitted (an OAuth room)", () => {
    expect(resolveExistingRoomOwnership(room({
      requestedByPrincipal: person("HUMAN"), createdByPrincipal: agent("CODEX"), leaseHolderPrincipal: person("HUMAN"),
    }), null)).toEqual({ ownerPrincipalId: "HUMAN", assistantPrincipalId: "CODEX" });
  });

  it("a room that names no person falls back to the user who first recorded on it", () => {
    expect(resolveExistingRoomOwnership(room({
      createdByPrincipal: agent("CODEX"), leaseHolderPrincipal: agent("CODEX"),
    }), "HUMAN-FROM-ACTIVITY")).toEqual({ ownerPrincipalId: "HUMAN-FROM-ACTIVITY", assistantPrincipalId: "CODEX" });
  });

  it("never treats an agent as the owner", () => {
    expect(resolveExistingRoomOwnership(room({ createdByPrincipal: agent("CODEX") }), null).ownerPrincipalId)
      .toBeNull();
  });
});

describe("isDeliveryRoom", () => {
  it("recognises a delivery shape and nothing else", () => {
    expect(isDeliveryRoom(DELIVERY_CLAIMS)).toBe(true);
    expect(isDeliveryRoom([{ source: "declared", workShape: "dependency-advisory-watch@1.0.0" }])).toBe(false);
    expect(isDeliveryRoom([])).toBe(false);
  });
});

describe("roomOwnerUserId", () => {
  const alias = (value: string) => ({ aliases: [{ aliasValue: value }] });
  it("the requester's user runs the room's tasks, so an OAuth room can dispatch", () => {
    expect(roomOwnerUserId({ requestedByPrincipal: alias("human-user"), createdByPrincipal: alias("agent-user") }))
      .toBe("human-user");
  });
  it("falls back to the creator for rooms with no requester", () => {
    expect(roomOwnerUserId({ requestedByPrincipal: null, createdByPrincipal: alias("creator") })).toBe("creator");
  });
  // BI-858FDE5A: requester and creator are history; a handed-over account is
  // not who the work runs for now, so the drive falls through to the room's
  // accountable person instead of birthing a task under the absent account.
  it("skips a handed-over requester and creator, leaving the accountability walk to name the owner", () => {
    const handedOver = new Set(["admin-user"]);
    expect(roomOwnerUserId({ requestedByPrincipal: alias("admin-user"), createdByPrincipal: alias("admin-user") }, handedOver))
      .toBeNull();
    expect(roomOwnerUserId({ requestedByPrincipal: alias("admin-user"), createdByPrincipal: null }, handedOver)).toBeNull();
  });
  it("still names an account that was not handed over", () => {
    const handedOver = new Set(["admin-user"]);
    expect(roomOwnerUserId({ requestedByPrincipal: alias("admin-user"), createdByPrincipal: alias("creator") }, handedOver))
      .toBe("creator");
    expect(roomOwnerUserId({ requestedByPrincipal: alias("human-user"), createdByPrincipal: null }, handedOver)).toBe("human-user");
  });
});

describe("repairUnownedDeliveryRooms", () => {
  function repairDb(rows: Array<Record<string, unknown>>) {
    const db = {
      workroom: { findMany: vi.fn(async () => rows) },
      // No account here was handed over (BI-C66B6076 reads these before appointing).
      principalAlias: { findFirst: vi.fn(async () => null) },
      user: { findFirst: vi.fn(async () => null) },
      workroomParticipant: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      workroomActivity: { create: vi.fn(async () => ({})) },
      principal: { findFirst: vi.fn(async () => ({ id: "HUMAN-FROM-ACTIVITY" })) },
      $queryRaw: vi.fn(async () => [{ id: "delivery" }]),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    };
    return db;
  }

  it("owns each unowned delivery room once, records why, and skips other shapes", async () => {
    const db = repairDb([
      { id: "delivery", scopeClaims: DELIVERY_CLAIMS, requestedByPrincipal: person("HUMAN"), createdByPrincipal: agent("CODEX"), leaseHolderPrincipal: null, activities: [] },
      { id: "standing", scopeClaims: [{ workShape: "dependency-advisory-watch@1.0.0" }], requestedByPrincipal: person("HUMAN"), createdByPrincipal: null, leaseHolderPrincipal: null, activities: [] },
    ]);
    await expect(repairUnownedDeliveryRooms(db as never, ["delivery", "standing"])).resolves.toBe(1);
    expect(db.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workroomId: "delivery", principalId: "HUMAN", roles: ["coordinator"] }) });
    expect(db.workroomParticipant.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ workroomId: "standing" }) });
    expect(db.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workCapsuleId: "delivery", kind: "coworker-joined", payload: expect.objectContaining({ source: "drive-repair" }),
    }) });
  });

  it("uses the first recorded user when the room names no person", async () => {
    const db = repairDb([
      { id: "legacy", scopeClaims: DELIVERY_CLAIMS, requestedByPrincipal: null, createdByPrincipal: agent("CODEX"), leaseHolderPrincipal: agent("CODEX"), activities: [{ recordedById: "user-1" }] },
    ]);
    await expect(repairUnownedDeliveryRooms(db as never, ["legacy"])).resolves.toBe(1);
    expect(db.principal.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ aliases: { some: { aliasType: "user", issuer: "", aliasValue: "user-1" } } }),
    }));
  });

  it("locks the parent before touching the roster or recording activity", async () => {
    const db = repairDb([{ id: "delivery", scopeClaims: DELIVERY_CLAIMS,
      requestedByPrincipal: person("HUMAN"), createdByPrincipal: agent("CODEX"),
      leaseHolderPrincipal: null, activities: [] }]);
    await repairUnownedDeliveryRooms(db as never, ["delivery"]);
    expect(db.$queryRaw).toHaveBeenCalledOnce();
    const [parts, roomId] = db.$queryRaw.mock.calls[0] as unknown as [string[], string];
    expect(parts.join("?")).toContain('FROM "WorkCapsule" WHERE "id" = ? FOR UPDATE');
    expect(roomId).toBe("delivery");
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.workroomParticipant.findMany.mock.invocationCallOrder[0]!);
  });

  // BI-C66B6076: the repair reads requester/creator history, so a room the
  // handed-over admin requested would be given back to it. It goes to the
  // room's accountable person instead.
  it("gives a room requested by a handed-over account to the accountable person", async () => {
    const db = repairDb([
      { id: "delivery", scopeClaims: DELIVERY_CLAIMS, requestedByPrincipal: person("ADMIN"), createdByPrincipal: agent("CODEX"), leaseHolderPrincipal: null, activities: [] },
    ]);
    const userOf: Record<string, string> = { ADMIN: "u-admin", MARK: "u-mark" };
    Object.assign(db, {
      principalAlias: { findFirst: vi.fn(async ({ where }: { where: { principalId?: string; aliasValue?: string } }) => {
        if (where.principalId) return userOf[where.principalId] ? { aliasValue: userOf[where.principalId] } : null;
        const principalId = Object.keys(userOf).find((key) => userOf[key] === where.aliasValue);
        return principalId ? { principalId } : null;
      }) },
      user: { findFirst: vi.fn(async ({ where }: { where: { id: string; workHandedOverAt?: unknown } }) =>
        (where.workHandedOverAt ? where.id === "u-admin" : Object.values(userOf).includes(where.id)) ? { id: where.id } : null) },
      portfolio: { findUnique: vi.fn(async ({ where }: { where: { slug?: string } }) =>
        where.slug === "foundational" ? { id: "pf-found", slug: "foundational", accountablePrincipalId: "MARK" } : null) },
      organization: { findFirst: vi.fn(async () => null) },
    });
    db.workroom = Object.assign(db.workroom, { findUnique: vi.fn(async () => ({ portfolioRole: null })) });
    await expect(repairUnownedDeliveryRooms(db as never, ["delivery"])).resolves.toBe(1);
    expect(db.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ principalId: "MARK", roles: ["coordinator"] }) });
    expect(db.workroomParticipant.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ principalId: "ADMIN" }) });
    expect(db.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      payload: expect.objectContaining({ source: "drive-repair", reroutedFromPrincipalId: "ADMIN", ownerSource: "foundational" }),
    }) });
  });

  it("does nothing without room ids", async () => {
    const db = repairDb([]);
    await expect(repairUnownedDeliveryRooms(db as never, [])).resolves.toBe(0);
    expect(db.workroom.findMany).not.toHaveBeenCalled();
  });
});

describe("a delivery room with its owner appointed is no longer paused", () => {
  const definition = DELIVERY_SHAPES["delivery-medium"];
  const base = {
    roomKey: "WC-1",
    definition,
    collaborationShape: "outward-review",
    currentStageKey: null,
    proposedStageKey: definition.stages[0]?.key ?? null,
    receipts: [],
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    proposedGrants: [],
  };
  const owner = {
    workroomId: "room-1", principalRef: "PRN-HUMAN", displayName: "Owner", kind: "person" as const,
    roles: ["coordinator" as const], assignmentSource: "explicit" as const, enteredReason: null,
    currentWorkSummary: null, sponsorPrincipalRef: null, sponsorDisplayName: null, authoritySummary: "",
  };

  it("pauses without an owner, and does not once the person is the explicit coordinator", () => {
    const before = evaluateWorkroomShapeConformance({ ...base, participants: [] } as never);
    expect(before.deviations.map((entry) => entry.code)).toContain("missing_explicit_coordinator");
    // Projected exactly as the drive projects persisted rows.
    const participants = projectPersistedWorkroomRoster({ assignments: [owner], presencePrincipalRefs: [] });
    const after = evaluateWorkroomShapeConformance({ ...base, participants } as never);
    expect(after.deviations.map((entry) => entry.code)).not.toContain("missing_explicit_coordinator");
    expect(after.disposition).not.toBe("pause");
  });
});

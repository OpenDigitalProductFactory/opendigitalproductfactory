// BI-36FC2981 — a delivery room is born owned: the person the work is for is
// its Process Overseer, and their assistant is admitted. Decisions somebody
// already made (an existing owner, a removal) always stand.
import { describe, expect, it, vi } from "vitest";

import {
  describeRoomOwnership,
  establishRoomOwnership,
  resolveRoomOwnershipPrincipals,
  ROOM_ASSISTANT_REASON,
  ROOM_OWNERSHIP_REASON,
} from "./room-ownership";

type Row = { id: string; principalId: string; roles: string[]; lifecycle: string };

type Directory = {
  /** Principal.id -> User.id */
  userOf?: Record<string, string>;
  handedOver?: string[];
  portfolios?: Array<{ id: string; slug: string; accountablePrincipalId: string | null }>;
  orgOwner?: string | null;
  portfolioRole?: string | null;
};

function participants(rows: Row[] = [], dir: Directory = {}) {
  const userOf = dir.userOf ?? {};
  const principalOf = (userId: string) => Object.entries(userOf).find(([, u]) => u === userId)?.[0] ?? null;
  const portfolios = dir.portfolios ?? [];
  return {
    workroomParticipant: {
      findMany: vi.fn(async () => rows),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    workroom: { findUnique: vi.fn(async () => ({ portfolioRole: dir.portfolioRole ?? null })) },
    principalAlias: {
      findFirst: vi.fn(async ({ where }: { where: { principalId?: string; aliasValue?: string } }) => {
        if (where.principalId) return userOf[where.principalId] ? { aliasValue: userOf[where.principalId] } : null;
        const principalId = where.aliasValue ? principalOf(where.aliasValue) : null;
        return principalId ? { principalId } : null;
      }),
    },
    user: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; workHandedOverAt?: unknown } }) => {
        if (!where.id) return null;
        if (where.workHandedOverAt) {
          return (dir.handedOver ?? []).includes(where.id) ? { id: where.id, workHandedOverAt: new Date("2026-10-01T10:41:18Z") } : null;
        }
        return Object.values(userOf).includes(where.id) ? { id: where.id } : null;
      }),
      findMany: vi.fn(async () => []),
    },
    portfolio: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; slug?: string } }) =>
        portfolios.find((p) => p.id === where.id || p.slug === where.slug) ?? null),
    },
    organization: { findFirst: vi.fn(async () => ({ topAccountablePrincipalId: dir.orgOwner ?? null })) },
  };
}

describe("resolveRoomOwnershipPrincipals", () => {
  const userPrincipal = vi.fn(async () => "PRN-HUMAN-FROM-USER");

  it("OAuth: the token's human owns the room and the assistant acts for them", async () => {
    await expect(resolveRoomOwnershipPrincipals(
      { userId: "u1", agentId: "AGT-EXT-CODEX", principalId: "HUMAN", agentPrincipalId: "ASSISTANT" },
      userPrincipal,
    )).resolves.toEqual({ ownerPrincipalId: "HUMAN", assistantPrincipalId: "ASSISTANT" });
  });

  it("a token with no agent: the person is the owner and there is no assistant", async () => {
    await expect(resolveRoomOwnershipPrincipals(
      { userId: "u1", agentId: null, principalId: "HUMAN" },
      userPrincipal,
    )).resolves.toEqual({ ownerPrincipalId: "HUMAN", assistantPrincipalId: null });
  });

  it("an agent acting without OAuth: the owner is its user, the agent is the assistant", async () => {
    await expect(resolveRoomOwnershipPrincipals(
      { userId: "u1", agentId: "AGT-WS-BUILD", principalId: "AGENT" },
      userPrincipal,
    )).resolves.toEqual({ ownerPrincipalId: "PRN-HUMAN-FROM-USER", assistantPrincipalId: "AGENT" });
    expect(userPrincipal).toHaveBeenCalledWith("u1");
  });
});

describe("establishRoomOwnership", () => {
  it("makes the owner the coordinator and admits the assistant as a contributor", async () => {
    const db = participants();
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: "ASSISTANT",
    });
    expect(outcome).toMatchObject({ coordinatorPrincipalId: "HUMAN", ownerAppointed: true, assistantAdmitted: true });
    expect(db.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      principalId: "HUMAN", roles: ["coordinator"], assignmentSource: "explicit", enteredReason: ROOM_OWNERSHIP_REASON,
    }) });
    expect(db.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      principalId: "ASSISTANT", roles: ["contributor"], enteredReason: ROOM_ASSISTANT_REASON,
    }) });
  });

  it("keeps an existing owner and still admits the assistant", async () => {
    const db = participants([{ id: "p1", principalId: "SOMEONE", roles: ["coordinator"], lifecycle: "active" }]);
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: "ASSISTANT",
    });
    expect(outcome).toMatchObject({ coordinatorPrincipalId: "SOMEONE", ownerAppointed: false, assistantAdmitted: true });
    expect(db.workroomParticipant.create).toHaveBeenCalledTimes(1);
    expect(db.workroomParticipant.update).not.toHaveBeenCalled();
  });

  it("adds the coordinator role to an owner already in the room as a contributor", async () => {
    const db = participants([{ id: "p1", principalId: "HUMAN", roles: ["contributor"], lifecycle: "active" }]);
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: null,
    });
    expect(outcome.ownerAppointed).toBe(true);
    expect(db.workroomParticipant.update).toHaveBeenCalledWith({
      where: { id: "p1" }, data: { roles: ["contributor", "coordinator"] },
    });
  });

  it("never re-admits a removed owner or a removed assistant", async () => {
    const db = participants([
      { id: "p1", principalId: "HUMAN", roles: ["coordinator"], lifecycle: "removed" },
      { id: "p2", principalId: "ASSISTANT", roles: ["contributor"], lifecycle: "removed" },
    ]);
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: "ASSISTANT",
    });
    expect(outcome).toMatchObject({ ownerAppointed: false, assistantAdmitted: false, coordinatorPrincipalId: null });
    expect(outcome.skipped).toHaveLength(2);
    expect(db.workroomParticipant.create).not.toHaveBeenCalled();
    expect(db.workroomParticipant.update).not.toHaveBeenCalled();
  });

  it("reports an unresolved owner instead of inventing one", async () => {
    const db = participants();
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: null, assistantPrincipalId: null,
    });
    expect(outcome.ownerAppointed).toBe(false);
    expect(outcome.skipped).toEqual(["No person could be resolved as the room's owner."]);
  });

  it("does not admit the owner twice when the assistant resolves to the same principal", async () => {
    const db = participants();
    await establishRoomOwnership(db, { workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: "HUMAN" });
    expect(db.workroomParticipant.create).toHaveBeenCalledTimes(1);
  });
});

// BI-C66B6076 — WC-BBA7AEBB was born owned by admin@dpf.local on 2026-10-02,
// a day after that account's work was handed over (BI-F25A5FC7): Codex signed
// in as admin and adopted a worktree. A handed-over account never owns a new
// room; the room's accountable person does, by the rule the handover used.
describe("establishRoomOwnership for an account whose work was handed over", () => {
  const directory: Directory = {
    userOf: { ADMIN: "u-admin", MARK: "u-mark", LINE: "u-line" },
    handedOver: ["u-admin"],
    portfolios: [
      { id: "pf-found", slug: "foundational", accountablePrincipalId: "MARK" },
      { id: "pf-mfg", slug: "manufacturing_and_delivery", accountablePrincipalId: "LINE" },
    ],
  };
  const createdFor = (db: ReturnType<typeof participants>) =>
    db.workroomParticipant.create.mock.calls.map((call) => (call as unknown as [{ data: { principalId: string } }])[0].data.principalId);

  it("appoints the room's accountable person, not the handed-over account, and still admits the assistant", async () => {
    const db = participants([], directory);
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "ADMIN", assistantPrincipalId: "CODEX",
    });
    expect(outcome).toMatchObject({
      coordinatorPrincipalId: "MARK", ownerAppointed: true, assistantAdmitted: true,
      reroutedFromPrincipalId: "ADMIN", ownerSource: "foundational",
    });
    expect(createdFor(db)).toEqual(["MARK", "CODEX"]);
    expect(describeRoomOwnership(outcome)).toContain("handed over");
  });

  it("uses the accountable person of the room's own portfolio", async () => {
    const db = participants([], { ...directory, portfolioRole: "manufactureAndDeliver" });
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "ADMIN", assistantPrincipalId: null,
    });
    expect(outcome).toMatchObject({ coordinatorPrincipalId: "LINE", ownerSource: "portfolio" });
  });

  it("appoints nobody when no accountable person is recorded, and says why", async () => {
    const db = participants([], { userOf: { ADMIN: "u-admin" }, handedOver: ["u-admin"] });
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "ADMIN", assistantPrincipalId: "CODEX",
    });
    expect(outcome).toMatchObject({ coordinatorPrincipalId: null, ownerAppointed: false, assistantAdmitted: true });
    expect(outcome.skipped.join(" ")).toMatch(/handed over/);
    expect(createdFor(db)).toEqual(["CODEX"]);
  });

  it("never hands the room back to the account it left", async () => {
    const db = participants([], {
      userOf: { ADMIN: "u-admin" }, handedOver: ["u-admin"],
      portfolios: [{ id: "pf-found", slug: "foundational", accountablePrincipalId: "ADMIN" }],
    });
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "ADMIN", assistantPrincipalId: null,
    });
    expect(outcome.ownerAppointed).toBe(false);
    expect(db.workroomParticipant.create).not.toHaveBeenCalled();
  });

  it("leaves an account that was not handed over as the owner", async () => {
    const db = participants([], directory);
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "MARK", assistantPrincipalId: null,
    });
    expect(outcome).toMatchObject({ coordinatorPrincipalId: "MARK", ownerAppointed: true });
    expect(outcome.reroutedFromPrincipalId).toBeUndefined();
  });
});

describe("describeRoomOwnership", () => {
  it("says nothing when nothing changed", () => {
    expect(describeRoomOwnership({ coordinatorPrincipalId: "X", ownerAppointed: false, assistantAdmitted: false, skipped: [] }))
      .toBeNull();
  });

  it("names both changes in one plain sentence", () => {
    expect(describeRoomOwnership({ coordinatorPrincipalId: "X", ownerAppointed: true, assistantAdmitted: true, skipped: [] }))
      .toBe("The person this work is for now owns the room, and their assistant was admitted.");
  });
});

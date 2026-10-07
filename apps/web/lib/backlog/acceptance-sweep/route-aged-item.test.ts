import { describe, expect, it, vi } from "vitest";

import { loadBacklogWorkroomOwnership, assertBacklogWorkroomClaimAvailable } from "@/lib/work-capsules/backlog-workroom-ownership";
import { readWorkShapeClaim, readWorkShapeRoleBindings } from "@/lib/work-management/workroom-shape-claim";

import type { OwedAcceptance } from "./owed-acceptance";
import {
  acceptanceRoomKey,
  acceptanceWriterTool,
  buildAcceptanceRoomObjective,
  routeAgedItems as routeWith,
  type AcceptanceRouteDb,
  type AgedRouteCandidate,
} from "./route-aged-item";

const NOW = new Date("2026-09-25T05:00:00.000Z");

type StoredRoom = Record<string, unknown> & { id: string; idempotencyKey: string; backlogItemId: string | null };

function fakeDb(input: { superuser?: string | null; operatorPrincipal?: string | null; agentPrincipals?: Record<string, string>; rooms?: StoredRoom[] } = {}) {
  const rooms = new Map<string, StoredRoom>((input.rooms ?? []).map((room) => [room.idempotencyKey, room]));
  const superuser = input.superuser === undefined ? "user-operator" : input.superuser;
  const operatorPrincipal = input.operatorPrincipal === undefined ? "prn-operator" : input.operatorPrincipal;
  const db = {
    user: { findFirst: vi.fn(async () => (superuser ? { id: superuser } : null)) },
    principal: {
      findFirst: vi.fn(async ({ where }: { where: { kind: string; aliases: { some: { aliasType: string; aliasValue: string } } } }) => {
        const alias = where.aliases.some;
        if (where.kind === "human" && alias.aliasType === "user" && alias.aliasValue === superuser && operatorPrincipal) return { id: operatorPrincipal };
        if (where.kind === "agent" && alias.aliasType === "agent") {
          const id = input.agentPrincipals?.[alias.aliasValue];
          return id ? { id } : null;
        }
        return null;
      }),
    },
    workroom: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => rooms.get(where.idempotencyKey) ?? null),
      upsert: vi.fn(async ({ where, create }: { where: { idempotencyKey: string }; create: Record<string, unknown> }) => {
        const existing = rooms.get(where.idempotencyKey);
        if (existing) return { id: existing.id };
        const row: StoredRoom = { ...create, id: `room-${rooms.size + 1}`, idempotencyKey: where.idempotencyKey, backlogItemId: (create.backlogItemId as string | undefined) ?? null, archivedAt: null };
        rooms.set(where.idempotencyKey, row);
        return { id: row.id };
      }),
    },
  };
  return { db: db as unknown as AcceptanceRouteDb, raw: db, rooms };
}

/** Routes with the fake's accountable owner (its `user` row) as the room's owner user. */
function routeAgedItems(input: Omit<Parameters<typeof routeWith>[0], "resolveOwnerUserId">) {
  const users = (input.db as unknown as { user: { findFirst(): Promise<{ id: string } | null> } }).user;
  return routeWith({ ...input, resolveOwnerUserId: async () => (await users.findFirst())?.id ?? null });
}

function projection(over: Partial<OwedAcceptance> = {}): OwedAcceptance {
  return {
    owed: [{ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer", nextAction: "Record acceptance evidence against the objective baseline." }],
    owner: { agentId: "AGT-WS-BUILD", displayName: "Build Specialist", codes: ["ACCEPTANCE_EVIDENCE_REQUIRED"] },
    unroutable: [],
    closable: false,
    ...over,
  };
}

function candidate(itemId: string, ageDays: number, over: Partial<AgedRouteCandidate> = {}): AgedRouteCandidate {
  return {
    rowId: `row-${itemId}`,
    itemId,
    title: `Item ${itemId}`,
    body: "## Problem\nx\n\n## Acceptance\n- The sweep routes an aged item\n- A re-run creates no second room\n",
    ageDays,
    projection: projection(),
    ...over,
  };
}

describe("routeAgedItems (BI-C1781121)", () => {
  it("AC-S3-1: gives an aged item with an owner exactly one steward room anchored by outcomeAnchor, not backlogItemId", async () => {
    const { db, raw, rooms } = fakeDb({ agentPrincipals: { "AGT-WS-BUILD": "prn-build" } });

    const outcomes = await routeAgedItems({ db, now: NOW, candidates: [candidate("BI-AAAA0001", 20)], limit: 10 });

    expect(outcomes).toEqual([expect.objectContaining({ itemId: "BI-AAAA0001", outcome: "routed", ownerAgentId: "AGT-WS-BUILD" })]);
    expect(raw.workroom.upsert).toHaveBeenCalledTimes(1);
    const args = raw.workroom.upsert.mock.calls[0]![0] as { where: { idempotencyKey: string }; create: Record<string, unknown> };
    expect(args.where).toEqual({ idempotencyKey: "acceptance:BI-AAAA0001" });
    expect(acceptanceRoomKey("BI-AAAA0001")).toBe("acceptance:BI-AAAA0001");
    expect(args.create).toMatchObject({
      source: "scheduled-steward",
      outcomeAnchor: { kind: "backlog-item", id: "BI-AAAA0001" },
      requestedByPrincipalId: "prn-operator",
      status: "working",
    });
    expect(args.create).not.toHaveProperty("backlogItemId");
    expect(readWorkShapeClaim(args.create.scopeClaims)).toEqual({ key: "acceptance-verification", version: "1.0.0" });
    expect(readWorkShapeRoleBindings(args.create.scopeClaims)).toEqual({ "acceptance-verifier": "agent:AGT-WS-BUILD" });
    // The operator owns the room (Process Overseer); the coworker is admitted to do the stage.
    expect(args.create.participants).toEqual({
      create: [
        expect.objectContaining({ principalId: "prn-operator", roles: ["coordinator"], assignmentSource: "explicit", lifecycle: "active" }),
        expect.objectContaining({ principalId: "prn-build", roles: ["contributor"], assignmentSource: "explicit", lifecycle: "active" }),
      ],
    });
    expect(rooms.size).toBe(1);
  });

  it("AC-S3-1: a re-run does not create a second room and reports the existing one", async () => {
    const { db, raw, rooms } = fakeDb();
    await routeAgedItems({ db, now: NOW, candidates: [candidate("BI-AAAA0001", 20)], limit: 10 });
    const second = await routeAgedItems({ db, now: NOW, candidates: [candidate("BI-AAAA0001", 21)], limit: 10 });

    expect(second).toEqual([expect.objectContaining({ outcome: "already-routed" })]);
    expect(raw.workroom.upsert).toHaveBeenCalledTimes(1);
    expect(rooms.size).toBe(1);
  });

  it("reports a room the drive already dispatched as routed-unresolved with its age, never re-creating it", async () => {
    const { db, raw } = fakeDb({
      rooms: [{
        id: "room-x", idempotencyKey: "acceptance:BI-AAAA0001", backlogItemId: null, capsuleId: "WC-ACC-AAAA0001", archivedAt: null, status: "working",
        workspaceState: { workroomDrive: { action: "dispatch_agent", taskId: "workroom-WC-ACC-AAAA0001-acceptance-verification" } },
      }],
    });

    const outcomes = await routeAgedItems({ db, now: NOW, candidates: [candidate("BI-AAAA0001", 30)], limit: 10 });

    expect(outcomes).toEqual([expect.objectContaining({ outcome: "routed-unresolved", ageDays: 30, capsuleId: "WC-ACC-AAAA0001" })]);
    expect(raw.workroom.upsert).not.toHaveBeenCalled();
  });

  it("AC-S3-2: creates at most the route limit per run, oldest first, and defers the rest", async () => {
    const { db, raw } = fakeDb();
    const outcomes = await routeAgedItems({
      db,
      now: NOW,
      candidates: [candidate("BI-YOUNG001", 15), candidate("BI-OLDEST01", 90), candidate("BI-MIDDLE01", 40)],
      limit: 2,
    });

    expect(raw.workroom.upsert.mock.calls.map((call) => (call[0] as { where: { idempotencyKey: string } }).where.idempotencyKey))
      .toEqual(["acceptance:BI-OLDEST01", "acceptance:BI-MIDDLE01"]);
    expect(outcomes.map((row) => [row.itemId, row.outcome])).toEqual([
      ["BI-OLDEST01", "routed"],
      ["BI-MIDDLE01", "routed"],
      ["BI-YOUNG001", "deferred"],
    ]);
  });

  it("AC-S3-2: an item with no eligible coworker gets no room and is reported unroutable with its reason", async () => {
    const { db, raw } = fakeDb();
    const outcomes = await routeAgedItems({
      db,
      now: NOW,
      candidates: [candidate("BI-EXTONLY1", 20, {
        projection: projection({
          owner: null,
          unroutable: [{ code: "ACCEPTANCE_EVIDENCE_REQUIRED", accountableRole: "acceptance-reviewer", reason: "no-in-platform-coworker", nextAction: "AGT-EXT-CLAUDE holds ..." }],
        }),
      })],
      limit: 10,
    });

    expect(outcomes).toEqual([expect.objectContaining({ outcome: "unroutable", reason: "no-in-platform-coworker" })]);
    expect(raw.workroom.upsert).not.toHaveBeenCalled();
  });

  it("reports unroutable no-install-operator when no owner user can be resolved, and creates nothing", async () => {
    const noUser = fakeDb({ superuser: null });
    const noPrincipal = fakeDb({ operatorPrincipal: null });

    for (const { db, raw } of [noUser, noPrincipal]) {
      const outcomes = await routeAgedItems({ db, now: NOW, candidates: [candidate("BI-AAAA0001", 20)], limit: 10 });
      expect(outcomes).toEqual([expect.objectContaining({ outcome: "unroutable", reason: "no-install-operator" })]);
      expect(raw.workroom.upsert).not.toHaveBeenCalled();
    }
  });

  it("skips a closable item: nothing is owed, so there is nothing to route", async () => {
    const { db, raw } = fakeDb();
    const outcomes = await routeAgedItems({
      db, now: NOW, limit: 10,
      candidates: [candidate("BI-CLOSABLE", 20, { projection: projection({ owed: [], owner: null, closable: true }) })],
    });
    expect(outcomes).toEqual([]);
    expect(raw.workroom.upsert).not.toHaveBeenCalled();
  });

  it("AC-S3-3: the author can still claim an item whose acceptance steward room is live", async () => {
    const { db, rooms } = fakeDb();
    await routeAgedItems({ db, now: NOW, candidates: [candidate("BI-AAAA0001", 20)], limit: 10 });
    expect(rooms.size).toBe(1);

    // The ownership read the claim path runs, over the same rooms, with Prisma's
    // `backlogItemId IN (...)` filter applied.
    const ownershipDb = {
      workroom: {
        findMany: vi.fn(async ({ where }: { where: { backlogItemId: { in: string[] } } }) =>
          [...rooms.values()]
            .filter((room) => room.backlogItemId !== null && where.backlogItemId.in.includes(room.backlogItemId))
            .map((room) => ({ ...room, leaseExpiresAt: new Date(NOW.getTime() + 3_600_000), updatedAt: NOW }))),
      },
      featureBuild: { findMany: vi.fn(async () => []) },
      nonProductionEnvironmentLease: { findMany: vi.fn(async () => []) },
    };
    const ownership = await loadBacklogWorkroomOwnership(ownershipDb, ["BI-AAAA0001", "row-BI-AAAA0001"], NOW);

    const claim = (liveWorkrooms: typeof ownership.liveWorkrooms) => () => assertBacklogWorkroomClaimAvailable({
      backlogItemId: "BI-AAAA0001",
      liveWorkrooms,
      repositoryFullName: "org/repo",
      headBranch: "fix/author-branch",
      force: false,
      overrideReason: null,
    });
    expect(ownership.liveWorkrooms).toEqual([]);
    expect(claim(ownership.liveWorkrooms)).not.toThrow();

    // Control: the same live room bound through backlogItemId WOULD refuse the
    // author's claim, which is why the steward room must not carry it.
    const [created] = [...rooms.values()];
    rooms.set("control", {
      ...created!, id: "room-control", idempotencyKey: "control", capsuleId: "WC-CONTROL", backlogItemId: "BI-AAAA0001",
      title: "Control", repositoryFullName: "org/repo", headBranch: "fix/other", worktreePath: "/worktrees/other",
      executorKind: "codex-desktop", executorRef: "session-x", leaseHolderPrincipalId: "PRN-X",
      pullRequestUrl: null, pullRequestNumber: null, lastSyncedAt: null, featureBuildId: null,
    });
    const bound = await loadBacklogWorkroomOwnership(ownershipDb, ["BI-AAAA0001", "row-BI-AAAA0001"], NOW);
    expect(bound.liveWorkrooms.map((room) => room.capsuleId)).toEqual(["WC-CONTROL"]);
    expect(claim(bound.liveWorkrooms)).toThrow(/already has live work/);
  });
});

describe("buildAcceptanceRoomObjective", () => {
  it("names the item, each owed code with its nextAction and writer, and the body's acceptance criteria", () => {
    const text = buildAcceptanceRoomObjective(candidate("BI-AAAA0001", 20, {
      projection: projection({
        owed: [
          { code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer", nextAction: "Record acceptance evidence against the objective baseline." },
          { code: "CAPSULE_IDENTITY_MISMATCH", state: "blocked", accountableRole: "delivery-coordinator", nextAction: null },
        ],
        unroutable: [{ code: "CAPSULE_IDENTITY_MISMATCH", accountableRole: "delivery-coordinator", reason: "no-writer-lane", nextAction: "fix the capsule" }],
      }),
    }));

    expect(text).toContain("BI-AAAA0001");
    expect(text).toContain("Item BI-AAAA0001");
    expect(text).toContain("20 days");
    expect(text).toMatch(/ACCEPTANCE_EVIDENCE_REQUIRED \(acceptance-reviewer\): Record acceptance evidence against the objective baseline\./);
    // Its lane writer cannot be called from this room: say so and name the writer that can.
    expect(text).toMatch(/record_initiative_evidence.*server-issued review packet.*do not call it/s);
    expect(text).toMatch(/record_workroom_evidence/);
    expect(text).toMatch(/Not yours.*CAPSULE_IDENTITY_MISMATCH.*no-writer-lane/s);
    expect(text).toContain("- The sweep routes an aged item");
    expect(text).toContain("- A re-run creates no second room");
    expect(text).toContain("record_execution_evidence");
    expect(text).toMatch(/do not change the item's status/i);
  });

  it("says so when the body has no acceptance criteria", () => {
    const text = buildAcceptanceRoomObjective(candidate("BI-AAAA0001", 20, { body: "no criteria here" }));
    expect(text).toMatch(/no acceptance criteria/i);
  });
});

describe("buildAcceptanceRoomObjective writers (BI-C1781121)", () => {
  it("instructs only the writes the verify stage declares, and names record_execution_evidence for a delivery-coordinator requirement", () => {
    const text = buildAcceptanceRoomObjective(candidate("BI-SMALL0001", 20, {
      projection: projection({
        owed: [{ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator", nextAction: "Record the acceptance check." }],
      }),
    }));
    expect(text).toMatch(/ACCEPTANCE_EVIDENCE_REQUIRED \(delivery-coordinator\), recorded with record_execution_evidence: Record the acceptance check\./);
    expect(text).not.toMatch(/record_initiative_evidence/);
  });
});

describe("routeAgedItems: owner user and writer tools on main's projection (BI-C1781121)", () => {
  it("reports no-install-operator when the accountable-owner lookup fails, and creates nothing", async () => {
    const { db, raw } = fakeDb();
    const outcomes = await routeWith({
      db, now: NOW, limit: 10, candidates: [candidate("BI-AAAA0001", 20)],
      resolveOwnerUserId: async () => { throw new Error("No accountable owner is recorded and no active superuser exists"); },
    });
    expect(outcomes).toEqual([expect.objectContaining({ outcome: "unroutable", reason: "no-install-operator" })]);
    expect(raw.workroom.upsert).not.toHaveBeenCalled();
  });

  it("reports every distinct unroutable reason code of an ownerless item", async () => {
    const { db } = fakeDb();
    const outcomes = await routeAgedItems({
      db, now: NOW, limit: 10,
      candidates: [candidate("BI-AAAA0002", 30, {
        projection: projection({
          owner: null,
          unroutable: [
            { code: "ACCEPTANCE_EVIDENCE_REQUIRED", accountableRole: "acceptance-reviewer", reason: "workroom-not-found", nextAction: null },
            { code: "CAPSULE_IDENTITY_MISMATCH", accountableRole: "delivery-coordinator", reason: "no-writer-lane", nextAction: null },
          ],
        }),
      })],
    });
    expect(outcomes).toEqual([expect.objectContaining({ outcome: "unroutable", reason: "workroom-not-found, no-writer-lane" })]);
  });

  it("names the readiness lane writer for an acceptance-family code, and none for another role", () => {
    expect(acceptanceWriterTool({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", accountableRole: "acceptance-reviewer" })).toBe("record_initiative_evidence");
    expect(acceptanceWriterTool({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", accountableRole: "delivery-coordinator" })).toBe("record_execution_evidence");
    expect(acceptanceWriterTool({ code: "CAPSULE_IDENTITY_MISMATCH", accountableRole: "delivery-coordinator" })).toBeNull();
    expect(acceptanceWriterTool({ code: "REVIEW_REQUIRED", accountableRole: "design-checklist-reviewer" })).toBeNull();
  });
});

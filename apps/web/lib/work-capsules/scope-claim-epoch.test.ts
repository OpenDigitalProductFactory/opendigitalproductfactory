import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
// This suite exercises acquisition under a known-compatible runtime fixture.
// The real canonical proof and its fail-closed outcomes have separate tests.
vi.mock("./scope-epoch-enrollment.server", () => ({
  assertScopeEpochEnrollmentReady: vi.fn(async () => ({ assertCurrent: vi.fn() })),
}));

import { claimWorkCapsuleScope, detectScopeConflicts, ScopeOverlapError, type CapsuleDb } from "./work-capsule-store";
import { replaceOwnershipClaims } from "./scope-input";
import { withWorkroomPostureClaim } from "../work-management/workroom-posture-claim";
import { withWorkShapeClaim } from "../work-management/workroom-shape-claim";
import { withWorkroomBoundaryClaim } from "../work-management/workroom-boundary-claim";

const now = new Date("2026-11-01T10:00:00Z");
const oldEpoch = "00000000-0000-4000-8000-000000000001";
const actor = { userId: "operator", agentId: "assistant", principalId: "owner" };
const incoming = { kind: "path" as const, value: "one.ts", intent: "edit" as const };
const protectedClaim = { ...incoming, recordedAt: now.toISOString(), recordedByPrincipalId: "owner", releaseEpoch: oldEpoch };

function fixture(scopeClaims: unknown[] = [protectedClaim]) {
  const row = { id: "claim-room-row", capsuleId: "WC-EPOCH", status: "working", archivedAt: null,
    updatedAt: now, scopeClaims, leaseHolderPrincipalId: "owner", leaseExpiresAt: new Date(now.getTime() + 60_000) };
  const db = {
    workroom: {
      findUnique: vi.fn(async () => ({ ...row, scopeClaims: [...row.scopeClaims] })),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data })),
    },
    workroomActivity: { create: vi.fn(async () => ({ id: "claim-activity" })) },
    $transaction: async <T>(write: (tx: unknown) => Promise<T>): Promise<T> => write(db),
  };
  return { row, db };
}

function claim(f: ReturnType<typeof fixture>, changes: Record<string, unknown> = {}) {
  return claimWorkCapsuleScope({ db: f.db as unknown as CapsuleDb, capsuleId: "WC-EPOCH", claims: [incoming], actor, now,
    buildChangeImpactContract: async () => ({ schemaVersion: 1, status: "resolved", source: "gate-context",
      paths: ["one.ts"], gateContext: {}, instructions: [] }) as never, ...changes });
}

function written(f: ReturnType<typeof fixture>): Record<string, unknown> {
  const call = f.db.workroom.update.mock.calls.at(-1);
  return (call?.[0].data.scopeClaims as Record<string, unknown>[])[0];
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("prospective scope epochs belong to the committed acquisition", () => {
  it("rejects explicit epoch stripping on an unchanged owner and intent", () => {
    expect(() => replaceOwnershipClaims([protectedClaim], [{ ...protectedClaim, releaseEpoch: undefined }])).toThrow();
    const { releaseEpoch: _omitted, ...refresh } = protectedClaim;
    expect(replaceOwnershipClaims([protectedClaim], [refresh])).toContainEqual(protectedClaim);
  });

  it.each([
    ["posture", (rows: unknown[]) => withWorkroomPostureClaim(rows, { proactivityLevel: "balanced" })],
    ["shape", (rows: unknown[]) => withWorkShapeClaim(rows, "delivery-medium@1.0.0")],
    ["boundary", (rows: unknown[]) => withWorkroomBoundaryClaim(rows, { purpose: "new purpose" })],
  ] as const)("%s changes preserve ownership sharing an older metadata record", (_label, write) => {
    const mixed = { ...protectedClaim, workShape: "delivery-small@1.0.0",
      workroomPosture: { proactivityLevel: "balanced" }, workroomBoundary: { purpose: "old purpose" }, extension: "retain" };
    const result = write([mixed]);
    expect(result).toContainEqual(expect.objectContaining({ ...protectedClaim, extension: "retain" }));
  });

  it("does not preserve an old epoch through a generic intent replacement", () => {
    expect(() => replaceOwnershipClaims([protectedClaim], [{ ...protectedClaim, intent: "read" }])).toThrow();
  });

  it("does not strip protected metadata to bypass enrollment on an ownership change", () => {
    const { releaseEpoch: _ignored, ...replacement } = protectedClaim;
    expect(() => replaceOwnershipClaims([protectedClaim], [{ ...replacement, recordedByPrincipalId: "new-owner" }])).toThrow();
  });

  it("preserves an existing epoch during an unchanged authorized refresh", async () => {
    const f = fixture();
    await claim(f);
    expect(written(f).releaseEpoch).toBe(oldEpoch);
  });

  it("rotates the epoch when intent changes", async () => {
    const f = fixture();
    await claim(f, { claims: [{ ...incoming, intent: "read" }] });
    expect(written(f).releaseEpoch).toEqual(expect.any(String));
    expect(written(f).releaseEpoch).not.toBe(oldEpoch);
  });

  it("rotates the epoch for a genuinely authorized ownership change", async () => {
    const f = fixture();
    await claim(f, { actor: { ...actor, principalId: "new-owner" }, force: true });
    expect(written(f).recordedByPrincipalId).toBe("new-owner");
    expect(written(f).releaseEpoch).toEqual(expect.any(String));
    expect(written(f).releaseEpoch).not.toBe(oldEpoch);
  });

  it("prospectively enrolls an absent legacy epoch rather than inventing its birth", async () => {
    const { releaseEpoch: _ignored, ...legacy } = protectedClaim;
    const f = fixture([legacy]);
    await claim(f);
    expect(written(f).releaseEpoch).toMatch(/^[a-f0-9-]{36}$/);
    expect(written(f).recordedByPrincipalId).toBe("owner");
  });

  it("assigns a server epoch to a new acquisition", async () => {
    const f = fixture([]);
    await claim(f);
    expect(written(f).releaseEpoch).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("does not reinterpret malformed present metadata as an absent epoch", async () => {
    const f = fixture([{ ...protectedClaim, releaseEpoch: "malformed-present-epoch" }]);
    await expect(claim(f)).rejects.toThrow();
    expect(f.db.workroom.update).not.toHaveBeenCalled();
    expect(f.db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("rechecks ownership after transaction admission before publishing a new epoch", async () => {
    const f = fixture([]);
    f.db.$transaction = async write => {
      f.row.leaseHolderPrincipalId = "other-owner";
      return write(f.db);
    };
    await expect(claim(f)).rejects.toThrow();
    expect(f.db.workroom.update).not.toHaveBeenCalled();
    expect(f.db.workroomActivity.create).not.toHaveBeenCalled();
  });
});

  describe("claimWorkCapsuleScope scope-overlap rejection", () => {
    const actor = { userId: "user-1", agentId: "agent-1", principalId: "PRN-1" };
    const db = { workroom: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      workroomActivity: { create: vi.fn() }, $queryRaw: vi.fn(),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)) };
    const capsuleDb = () => db as unknown as CapsuleDb;
    beforeEach(() => {
      db.workroom.findUnique.mockReset(); db.workroom.findMany.mockReset(); db.workroom.update.mockReset();
      db.workroomActivity.create.mockReset(); db.$queryRaw.mockReset();
    });


    function otherCapsule(overrides: Record<string, unknown>) {
      return {
        capsuleId: "WC-OTHER01",
        title: "Other session",
        leaseHolderPrincipalId: "PRN-2",
        scopeClaims: [
          {
            kind: "path",
            value: "apps/web/lib/foo.ts",
            intent: "edit",
            recordedAt: "2026-06-18T00:00:00.000Z",
            recordedByPrincipalId: "PRN-2",
          },
        ],
        ...overrides,
      };
    }

    it("rejects an edit claim that overlaps another active capsule's edit claim", async () => {
      db.workroom.findUnique.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-MINE001",
        status: "working",
        archivedAt: null,
        scopeClaims: [],
      });
      db.workroom.findMany.mockResolvedValueOnce([otherCapsule({})]);

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
          actor,
        }),
      ).rejects.toBeInstanceOf(ScopeOverlapError);

      // The conflicting write must never reach the DB.
      expect(db.workroom.update).not.toHaveBeenCalled();
    });

    it("refuses scope claims on an abandoned capsule (BI-95E37EA1)", async () => {
      db.workroom.findUnique.mockResolvedValueOnce({
        id: "row-stale",
        capsuleId: "WC-DEAC865E",
        status: "abandoned",
        archivedAt: null,
        scopeClaims: [],
      });

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-DEAC865E",
          claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "read" }],
          actor,
        }),
      ).rejects.toThrow(/abandoned and cannot accept scope claims/i);

      expect(db.workroom.update).not.toHaveBeenCalled();
    });

    it("rejects an edit claim that overlaps another capsule's read claim (edit is exclusive)", async () => {
      db.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-MINE001", status: "working", leaseHolderPrincipalId: "PRN-1", leaseExpiresAt: new Date(Date.now() + 60_000), scopeClaims: [] });
      db.workroom.findMany.mockResolvedValueOnce([
        otherCapsule({ scopeClaims: [{ kind: "module", value: "routing", intent: "read", recordedAt: "2026-06-18T00:00:00.000Z", recordedByPrincipalId: "PRN-2" }] }),
      ]);

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "module", value: "routing", intent: "edit" }],
          actor,
        }),
      ).rejects.toBeInstanceOf(ScopeOverlapError);
    });

    it("allows two read claims on the same scope (read is non-exclusive)", async () => {
      db.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-MINE001", status: "working", leaseHolderPrincipalId: "PRN-1", leaseExpiresAt: new Date(Date.now() + 60_000), scopeClaims: [] });
      db.workroom.findMany.mockResolvedValueOnce([
        otherCapsule({ scopeClaims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "read", recordedAt: "2026-06-18T00:00:00.000Z", recordedByPrincipalId: "PRN-2" }] }),
      ]);
      db.workroom.update.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001" });
      db.workroomActivity.create.mockResolvedValueOnce({ id: "act-1" });

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "read" }],
          actor,
        }),
      ).resolves.toBeDefined();
      expect(db.workroom.update).toHaveBeenCalledTimes(1);
    });

    it("allows a claim when no other capsule holds overlapping scope", async () => {
      db.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-MINE001", status: "working", leaseHolderPrincipalId: "PRN-1", leaseExpiresAt: new Date(Date.now() + 60_000), scopeClaims: [] });
      db.workroom.findMany.mockResolvedValueOnce([]);
      db.workroom.update.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001" });
      db.workroomActivity.create.mockResolvedValueOnce({ id: "act-1" });

      const result = await claimWorkCapsuleScope({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [{ kind: "path", value: "apps/web/lib/bar.ts", intent: "edit" }],
        actor,
      });
      expect(result.capsuleId).toBe("WC-MINE001");
      expect(db.workroom.update).toHaveBeenCalledTimes(1);
    });

    it("force=true co-claims despite a conflict and records the override on the activity log", async () => {
      db.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-MINE001", status: "working", leaseHolderPrincipalId: "PRN-1", leaseExpiresAt: new Date(Date.now() + 60_000), scopeClaims: [] });
      db.workroom.findMany.mockResolvedValueOnce([otherCapsule({})]);
      db.workroom.update.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001" });
      db.workroomActivity.create.mockResolvedValueOnce({ id: "act-1" });

      await claimWorkCapsuleScope({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
        actor,
        force: true,
      });

      expect(db.workroom.update).toHaveBeenCalledTimes(1);
      const activityArg = db.workroomActivity.create.mock.calls[0]![0] as {
        data: { payload: { forcedOverConflicts?: unknown[] } };
      };
      expect(activityArg.data.payload.forcedOverConflicts).toHaveLength(1);
    });

    it("rejects an edit on a file beneath another capsule's directory path claim", async () => {
      db.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-MINE001", status: "working", leaseHolderPrincipalId: "PRN-1", leaseExpiresAt: new Date(Date.now() + 60_000), scopeClaims: [] });
      db.workroom.findMany.mockResolvedValueOnce([
        otherCapsule({
          scopeClaims: [{ kind: "path", value: "apps/web/lib/", intent: "edit", recordedAt: "2026-06-18T00:00:00.000Z", recordedByPrincipalId: "PRN-2" }],
        }),
      ]);

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
          actor,
        }),
      ).rejects.toBeInstanceOf(ScopeOverlapError);
      expect(db.workroom.update).not.toHaveBeenCalled();
    });

    it("rejects an edit directory claim that contains another capsule's file claim", async () => {
      db.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-MINE001", status: "working", leaseHolderPrincipalId: "PRN-1", leaseExpiresAt: new Date(Date.now() + 60_000), scopeClaims: [] });
      db.workroom.findMany.mockResolvedValueOnce([otherCapsule({})]); // holds apps/web/lib/foo.ts (edit)

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "path", value: "apps/web", intent: "edit" }],
          actor,
        }),
      ).rejects.toBeInstanceOf(ScopeOverlapError);
    });

    it("does not treat a sibling path sharing a string prefix as overlapping", async () => {
      db.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-MINE001", status: "working", leaseHolderPrincipalId: "PRN-1", leaseExpiresAt: new Date(Date.now() + 60_000), scopeClaims: [] });
      db.workroom.findMany.mockResolvedValueOnce([otherCapsule({})]); // holds apps/web/lib/foo.ts (edit)
      db.workroom.update.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001" });
      db.workroomActivity.create.mockResolvedValueOnce({ id: "act-1" });

      const result = await claimWorkCapsuleScope({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [{ kind: "path", value: "apps/web/lib/foobar.ts", intent: "edit" }],
        actor,
      });
      expect(result.capsuleId).toBe("WC-MINE001");
      expect(db.workroom.update).toHaveBeenCalledTimes(1);
    });

    it("scopes the conflict query to active, non-terminal, unexpired, non-self capsules", async () => {
      db.workroom.findMany.mockResolvedValueOnce([]);
      const now = new Date("2026-06-18T12:00:00.000Z");

      await detectScopeConflicts({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
        now,
      });

      const where = db.workroom.findMany.mock.calls[0]![0].where;
      expect(where.capsuleId).toEqual({ not: "WC-MINE001" });
      expect(where.archivedAt).toBeNull();
      expect(where.status.notIn).toEqual(expect.arrayContaining(["complete", "abandoned", "archived"]));
      expect(where.OR).toEqual([{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: now } }]);
    });

    it("returns no conflicts for an empty claim list without querying", async () => {
      const conflicts = await detectScopeConflicts({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [],
      });
      expect(conflicts).toEqual([]);
      expect(db.workroom.findMany).not.toHaveBeenCalled();
    });
  });

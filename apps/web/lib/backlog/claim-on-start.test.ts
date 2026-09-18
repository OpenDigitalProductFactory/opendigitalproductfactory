import { describe, expect, it, vi } from "vitest";
import {
  STALE_BACKLOG_CLAIM_MS,
  isActivelyClaimedByOther,
  buildAtomicClaimWhere,
  buildClaimAcquireData,
  tryAcquireBacklogClaimAtomic,
  reapStaleBacklogClaims,
} from "./claim-on-start";

const NOW = new Date("2026-07-18T12:00:00.000Z");

describe("isActivelyClaimedByOther", () => {
  it("is false when claim is free", () => {
    expect(
      isActivelyClaimedByOther(
        { claimStatus: null, claimedById: null, claimedByAgentId: null, claimedAt: null },
        { userId: "u1", agentId: "a1", now: NOW },
      ),
    ).toBe(false);
  });

  it("is true when another session holds a fresh active claim", () => {
    expect(
      isActivelyClaimedByOther(
        {
          claimStatus: "active",
          claimedById: "u2",
          claimedByAgentId: "a2",
          claimedAt: new Date(NOW.getTime() - 60_000),
        },
        { userId: "u1", agentId: "a1", now: NOW },
      ),
    ).toBe(true);
  });

  it("is false when the claim is stale (dead session)", () => {
    expect(
      isActivelyClaimedByOther(
        {
          claimStatus: "active",
          claimedById: "u2",
          claimedByAgentId: "a2",
          claimedAt: new Date(NOW.getTime() - STALE_BACKLOG_CLAIM_MS - 1),
        },
        { userId: "u1", agentId: "a1", now: NOW },
      ),
    ).toBe(false);
  });

  it("is false when the caller already owns the claim", () => {
    expect(
      isActivelyClaimedByOther(
        {
          claimStatus: "active",
          claimedById: "u1",
          claimedByAgentId: "a1",
          claimedAt: new Date(NOW.getTime() - 60_000),
        },
        { userId: "u1", agentId: "a1", now: NOW },
      ),
    ).toBe(false);
  });
});

describe("buildAtomicClaimWhere", () => {
  it("matches only the row id when force=true", () => {
    expect(buildAtomicClaimWhere("row-1", { userId: "u1", agentId: "a1", force: true })).toEqual({
      id: "row-1",
    });
  });

  it("allows free, non-active, stale, or owned claims without force", () => {
    const where = buildAtomicClaimWhere("row-1", {
      userId: "u1",
      agentId: "a1",
      force: false,
      now: NOW,
    }) as { id: string; OR: unknown[] };
    expect(where.id).toBe("row-1");
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { claimStatus: null },
        { claimStatus: { not: "active" } },
        { claimedAt: null },
        { claimedAt: { lt: new Date(NOW.getTime() - STALE_BACKLOG_CLAIM_MS) } },
        {
          AND: [
            { claimStatus: "active" },
            { OR: [{ claimedById: "u1" }, { claimedByAgentId: "a1" }] },
          ],
        },
      ]),
    );
  });
});

describe("tryAcquireBacklogClaimAtomic", () => {
  it("BI-05F8860A: re-entry by the same owner keeps claimedAt (the completion window does not reset)", async () => {
    const updateMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
      where.claimStatus === "active" && Array.isArray(where.OR) ? { count: 1 } : { count: 0 }
    ));
    const res = await tryAcquireBacklogClaimAtomic({
      db: { backlogItem: { updateMany, findUnique: vi.fn(async () => null) } } as never,
      itemRowId: "row-1",
      userId: "user-1",
      agentId: null,
      now: NOW,
    });
    expect(res).toEqual({ ok: true, forced: false, reentered: true });
    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = updateMany.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty("claimedAt");
    expect(call.where).toMatchObject({ id: "row-1", claimStatus: "active", claimedAt: { gte: new Date(NOW.getTime() - STALE_BACKLOG_CLAIM_MS) } });
  });

  it("wins when updateMany affects one row", async () => {
    const db = {
      backlogItem: {
        // First call is the BI-05F8860A re-entry probe (no live owned claim -> 0), then the acquire.
        updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 }),
        findUnique: vi.fn(),
      },
    };
    const res = await tryAcquireBacklogClaimAtomic({
      db,
      itemRowId: "row-1",
      userId: "u1",
      agentId: "a1",
      now: NOW,
    });
    expect(res).toEqual({ ok: true, forced: false });
    expect(db.backlogItem.updateMany).toHaveBeenLastCalledWith({
      where: buildAtomicClaimWhere("row-1", { userId: "u1", agentId: "a1", force: false, now: NOW }),
      data: buildClaimAcquireData({ userId: "u1", agentId: "a1", now: NOW }),
    });
    expect(db.backlogItem.findUnique).not.toHaveBeenCalled();
  });

  it("returns claim_conflict when updateMany affects zero rows (race loser)", async () => {
    const db = {
      backlogItem: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({
          claimStatus: "active",
          claimedById: "u2",
          claimedByAgentId: "a2",
          claimedAt: new Date(NOW.getTime() - 120_000),
        }),
      },
    };
    const res = await tryAcquireBacklogClaimAtomic({
      db,
      itemRowId: "row-1",
      userId: "u1",
      agentId: "a1",
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected conflict");
    expect(res.error).toBe("claim_conflict");
    expect(res.claimedById).toBe("u2");
    expect(res.claimedByAgentId).toBe("a2");
  });

  it("force takeover uses unrestricted where", async () => {
    const db = {
      backlogItem: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn(),
      },
    };
    const res = await tryAcquireBacklogClaimAtomic({
      db,
      itemRowId: "row-1",
      userId: "u1",
      agentId: "a1",
      force: true,
      now: NOW,
    });
    expect(res).toEqual({ ok: true, forced: true });
    expect(db.backlogItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row-1" } }),
    );
  });
});

describe("reapStaleBacklogClaims", () => {
  it("releases active claims older than the stale window", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const res = await reapStaleBacklogClaims({
      db: { backlogItem: { updateMany } },
      now: NOW,
    });
    expect(res).toEqual({ reaped: 3 });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        claimStatus: "active",
        claimedAt: { lt: new Date(NOW.getTime() - STALE_BACKLOG_CLAIM_MS) },
      },
      data: { claimStatus: "released" },
    });
  });
});

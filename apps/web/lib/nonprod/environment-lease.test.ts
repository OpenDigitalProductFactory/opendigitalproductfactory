import { describe, expect, it, vi } from "vitest";
import {
  claimNonprodEnvironmentLease,
  clampLeaseExpiry,
  listActiveNonprodEnvironmentLeases,
  releaseNonprodEnvironmentLease,
  renewNonprodEnvironmentLease,
  reapExpiredNonprodEnvironmentLeases,
  MAX_LEASE_TTL_MS,
  DEFAULT_LEASE_TTL_MS,
  NONPROD_OWNER_PROVIDERS,
} from "./environment-lease";

function db() {
  return {
    nonProductionEnvironmentLease: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ leaseId: "NPEL-1" }),
      update: vi.fn().mockResolvedValue({ leaseId: "NPEL-1", status: "released" }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe("NONPROD_OWNER_PROVIDERS", () => {
  it("includes antigravity alongside the peer host-worktree surfaces (BI-FA5F49C6)", () => {
    expect(NONPROD_OWNER_PROVIDERS).toEqual(
      expect.arrayContaining(["build-studio", "claude", "codex", "grok", "antigravity", "coworker"]),
    );
    expect(NONPROD_OWNER_PROVIDERS).toHaveLength(6);
  });
});

describe("non-production environment leases", () => {
  it("lists active, unexpired leases", async () => {
    const mockDb = db();
    await listActiveNonprodEnvironmentLeases({
      db: mockDb as never,
      now: new Date("2026-05-26T17:00:00.000Z"),
    });

    expect(mockDb.nonProductionEnvironmentLease.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        expiresAt: { gt: new Date("2026-05-26T17:00:00.000Z") },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("claims an available environment for antigravity as ownerProvider", async () => {
    const mockDb = db();
    const result = await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "active-candidate",
      ownerProvider: "antigravity",
      ownerSessionId: "session-agy-1",
      purpose: "UX verification",
      url: "http://127.0.0.1:3001",
      ports: [3001],
      expiresAt: new Date("2026-05-26T17:15:00.000Z"),
      now: new Date("2026-05-26T17:00:00.000Z"),
    });
    expect(result.status).toBe("claimed");
    expect(mockDb.nonProductionEnvironmentLease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerProvider: "antigravity" }),
    });
  });

  it("claims an available environment", async () => {
    const mockDb = db();
    const result = await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "active-candidate",
      ownerProvider: "codex",
      ownerSessionId: "session-1",
      purpose: "UX verification",
      url: "http://localhost:53601",
      ports: [53601],
      expiresAt: new Date("2026-05-26T18:00:00.000Z"),
    });

    expect(result.status).toBe("claimed");
    expect(mockDb.nonProductionEnvironmentLease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        environmentKey: "active-candidate",
        ownerProvider: "codex",
        ownerSessionId: "session-1",
        url: "http://localhost:53601",
        ports: [53601],
      }),
    });
  });

  it("refuses a conflicting active lease", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.findFirst.mockResolvedValue({ leaseId: "NPEL-ACTIVE" });
    const result = await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "active-candidate",
      ownerProvider: "claude",
      ownerSessionId: "session-2",
      purpose: "Second server",
      url: "http://localhost:53602",
      ports: [53602],
      expiresAt: new Date("2026-05-26T18:00:00.000Z"),
    });

    expect(result.status).toBe("conflict");
    expect(mockDb.nonProductionEnvironmentLease.create).not.toHaveBeenCalled();
  });

  it("releases an existing lease", async () => {
    const mockDb = db();
    await releaseNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      now: new Date("2026-05-26T19:00:00.000Z"),
    });

    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { leaseId: "NPEL-1" },
      data: {
        status: "released",
        releasedAt: new Date("2026-05-26T19:00:00.000Z"),
        activeKey: null,
      },
    });
  });

  it("stamps activeKey = environmentKey so the DB enforces one active lease per env", async () => {
    const mockDb = db();
    await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "local-integration-ci",
      ownerProvider: "claude",
      ownerSessionId: "s1",
      purpose: "ci",
      url: "http://localhost:3001",
      ports: [3001],
      expiresAt: new Date("2026-05-26T18:00:00.000Z"),
    });
    const data = mockDb.nonProductionEnvironmentLease.create.mock.calls[0][0].data;
    expect(data.activeKey).toBe("local-integration-ci");
  });

  it("frees a lapsed-but-active lease for the key before claiming", async () => {
    const mockDb = db();
    const at = new Date("2026-06-15T12:00:00.000Z");
    await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "active-candidate",
      ownerProvider: "codex",
      ownerSessionId: "s1",
      purpose: "claim",
      url: "http://localhost:3001",
      ports: [3001],
      expiresAt: new Date(at.getTime() + 60_000),
      now: at,
    });
    expect(mockDb.nonProductionEnvironmentLease.updateMany).toHaveBeenCalledWith({
      where: { environmentKey: "active-candidate", status: "active", expiresAt: { lte: at } },
      data: { status: "expired", activeKey: null, releasedAt: at },
    });
  });

  it("returns conflict (not a throw) when the unique index rejects a racing claim", async () => {
    const mockDb = db();
    // Fast-path findFirst sees no active lease; the create loses the race and the
    // unique index throws P2002; the recovery findFirst returns the winner.
    mockDb.nonProductionEnvironmentLease.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ leaseId: "NPEL-WINNER" });
    mockDb.nonProductionEnvironmentLease.create.mockRejectedValue({ code: "P2002" });

    const result = await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "active-candidate",
      ownerProvider: "claude",
      ownerSessionId: "s2",
      purpose: "racing claim",
      url: "http://localhost:3001",
      ports: [3001],
      expiresAt: new Date("2026-05-26T18:00:00.000Z"),
    });

    expect(result.status).toBe("conflict");
    expect(result).toMatchObject({ active: { leaseId: "NPEL-WINNER" } });
  });
});

describe("nonprod lease anti-monopolization (BI-4043A64B)", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("clamps a hold longer than the max window down to now + MAX_LEASE_TTL_MS", () => {
    const requested = new Date(now.getTime() + 8 * 60 * 60_000); // 8h ask
    const clamped = clampLeaseExpiry(now, requested);
    expect(clamped.getTime()).toBe(now.getTime() + MAX_LEASE_TTL_MS);
  });

  it("leaves a within-window hold unchanged", () => {
    const requested = new Date(now.getTime() + 5 * 60_000); // 5 min
    expect(clampLeaseExpiry(now, requested).getTime()).toBe(requested.getTime());
  });

  it("caps the claimed expiry so one process cannot hold the instance for hours", async () => {
    const mockDb = db();
    await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "active-candidate",
      ownerProvider: "claude",
      ownerSessionId: "s1",
      purpose: "long job",
      url: "http://localhost:3001",
      ports: [3001],
      expiresAt: new Date(now.getTime() + 8 * 60 * 60_000), // asks for 8h
      now,
    });
    const data = mockDb.nonProductionEnvironmentLease.create.mock.calls[0][0].data;
    expect(data.expiresAt.getTime()).toBe(now.getTime() + MAX_LEASE_TTL_MS);
  });

  it("renews an active, owned, unexpired lease (heartbeat extends the window)", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue({
      leaseId: "NPEL-1",
      status: "active",
      ownerSessionId: "s1",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValue({ leaseId: "NPEL-1" });
    const r = await renewNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      ownerSessionId: "s1",
      now,
    });
    expect(r.status).toBe("renewed");
    const data = mockDb.nonProductionEnvironmentLease.update.mock.calls[0][0].data;
    // Heartbeat with no explicit ttl uses the DEFAULT window (clamped to MAX).
    expect(data.expiresAt.getTime()).toBe(now.getTime() + DEFAULT_LEASE_TTL_MS);
  });

  it("refuses to revive an already-expired lease (holder lost it → must re-claim)", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue({
      leaseId: "NPEL-1",
      status: "active",
      ownerSessionId: "s1",
      expiresAt: new Date(now.getTime() - 60_000), // already lapsed
    });
    const r = await renewNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      ownerSessionId: "s1",
      now,
    });
    expect(r).toEqual({ status: "lost", reason: "expired" });
    expect(mockDb.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("refuses renewal from a non-owner session", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.findUnique.mockResolvedValue({
      leaseId: "NPEL-1",
      status: "active",
      ownerSessionId: "s1",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const r = await renewNonprodEnvironmentLease({
      db: mockDb as never,
      leaseId: "NPEL-1",
      ownerSessionId: "intruder",
      now,
    });
    expect(r).toEqual({ status: "lost", reason: "not-owner" });
  });

  it("reaps active-but-expired leases (frees the instance for the next waiter)", async () => {
    const mockDb = db();
    mockDb.nonProductionEnvironmentLease.updateMany.mockResolvedValue({ count: 3 });
    const r = await reapExpiredNonprodEnvironmentLeases({ db: mockDb as never, now });
    expect(r).toEqual({ reaped: 3 });
    expect(mockDb.nonProductionEnvironmentLease.updateMany).toHaveBeenCalledWith({
      where: { status: "active", expiresAt: { lt: now }, releasedAt: null },
      data: { status: "expired", releasedAt: now, activeKey: null },
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  claimNonprodEnvironmentLease,
  listActiveNonprodEnvironmentLeases,
  releaseNonprodEnvironmentLease,
} from "./environment-lease";

function db() {
  return {
    nonProductionEnvironmentLease: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ leaseId: "NPEL-1" }),
      update: vi.fn().mockResolvedValue({ leaseId: "NPEL-1", status: "released" }),
    },
  };
}

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
      },
    });
  });
});

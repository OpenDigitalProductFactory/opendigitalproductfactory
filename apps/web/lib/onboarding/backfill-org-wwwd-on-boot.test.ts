import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  organizationFindMany: vi.fn(),
  wikiPageCount: vi.fn(),
  setupProgressFindFirst: vi.fn(),
  storefrontConfigFindFirst: vi.fn(),
  businessContextFindUnique: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findMany: (...args: unknown[]) => prismaMock.organizationFindMany(...args),
    },
    wikiPage: {
      count: (...args: unknown[]) => prismaMock.wikiPageCount(...args),
    },
    platformSetupProgress: {
      findFirst: (...args: unknown[]) => prismaMock.setupProgressFindFirst(...args),
    },
    storefrontConfig: {
      findFirst: (...args: unknown[]) => prismaMock.storefrontConfigFindFirst(...args),
    },
    businessContext: {
      findUnique: (...args: unknown[]) => prismaMock.businessContextFindUnique(...args),
    },
  },
}));

const resolveOrgProfileIdMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/decision-perspective/material", () => ({
  resolveOrgProfileId: (...args: unknown[]) => resolveOrgProfileIdMock(...args),
}));

const runSeedsMock = vi.hoisted(() => vi.fn());
vi.mock("./setup-completion-seeds", () => ({
  runSetupCompletionSeeds: (...args: unknown[]) => runSeedsMock(...args),
}));

import { backfillOrgWwwdOnBoot } from "./backfill-org-wwwd-on-boot";

const silent = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organizationFindMany.mockResolvedValue([]);
  prismaMock.wikiPageCount.mockResolvedValue(0);
  prismaMock.setupProgressFindFirst.mockResolvedValue(null);
  prismaMock.storefrontConfigFindFirst.mockResolvedValue(null);
  prismaMock.businessContextFindUnique.mockResolvedValue(null);
  resolveOrgProfileIdMock.mockResolvedValue(null);
  runSeedsMock.mockResolvedValue(undefined);
});

describe("backfillOrgWwwdOnBoot", () => {
  it("seeds an org that completed setup but has no WWWD profile or overlay pages", async () => {
    prismaMock.organizationFindMany.mockResolvedValue([{ id: "org-1" }]);
    prismaMock.setupProgressFindFirst.mockResolvedValue({ id: "setup-1" });

    const res = await backfillOrgWwwdOnBoot(silent);

    expect(res).toEqual({ seeded: 1, present: 0, skipped: 0 });
    expect(runSeedsMock).toHaveBeenCalledWith("org-1");
  });

  it("does nothing for a healthy org (profile + overlay pages present)", async () => {
    prismaMock.organizationFindMany.mockResolvedValue([{ id: "org-1" }]);
    resolveOrgProfileIdMock.mockResolvedValue("org-perspective-org-1");
    prismaMock.wikiPageCount.mockResolvedValue(4);

    const res = await backfillOrgWwwdOnBoot(silent);

    expect(res).toEqual({ seeded: 0, present: 1, skipped: 0 });
    expect(runSeedsMock).not.toHaveBeenCalled();
    // Presence path must not even consult the setup-progress guard.
    expect(prismaMock.setupProgressFindFirst).not.toHaveBeenCalled();
  });

  it("re-seeds when the profile exists but the overlay pages are missing", async () => {
    prismaMock.organizationFindMany.mockResolvedValue([{ id: "org-1" }]);
    resolveOrgProfileIdMock.mockResolvedValue("org-perspective-org-1");
    prismaMock.wikiPageCount.mockResolvedValue(0);
    prismaMock.setupProgressFindFirst.mockResolvedValue({ id: "setup-1" });

    const res = await backfillOrgWwwdOnBoot(silent);

    expect(res).toEqual({ seeded: 1, present: 0, skipped: 0 });
    expect(runSeedsMock).toHaveBeenCalledWith("org-1");
  });

  it("skips an org still mid-setup (no completion marker, no storefront)", async () => {
    prismaMock.organizationFindMany.mockResolvedValue([{ id: "org-1" }]);

    const res = await backfillOrgWwwdOnBoot(silent);

    expect(res).toEqual({ seeded: 0, present: 0, skipped: 1 });
    expect(runSeedsMock).not.toHaveBeenCalled();
  });

  it("falls back to the storefront+business-context guard for installs without a completed setup row", async () => {
    prismaMock.organizationFindMany.mockResolvedValue([{ id: "org-1" }]);
    prismaMock.setupProgressFindFirst.mockResolvedValue(null);
    prismaMock.storefrontConfigFindFirst.mockResolvedValue({ id: "sf-1" });
    prismaMock.businessContextFindUnique.mockResolvedValue({ organizationId: "org-1" });

    const res = await backfillOrgWwwdOnBoot(silent);

    expect(res).toEqual({ seeded: 1, present: 0, skipped: 0 });
    expect(runSeedsMock).toHaveBeenCalledWith("org-1");
  });

  it("a failing seed is non-fatal per org and counted as skipped", async () => {
    prismaMock.organizationFindMany.mockResolvedValue([{ id: "org-1" }, { id: "org-2" }]);
    prismaMock.setupProgressFindFirst.mockResolvedValue({ id: "setup-1" });
    runSeedsMock
      .mockRejectedValueOnce(new Error("qdrant down"))
      .mockResolvedValueOnce(undefined);

    const res = await backfillOrgWwwdOnBoot(silent);

    expect(res).toEqual({ seeded: 1, present: 0, skipped: 1 });
    expect(runSeedsMock).toHaveBeenCalledTimes(2);
    expect(silent.warn).toHaveBeenCalled();
  });

  it("returns null (never throws) when the org query itself fails", async () => {
    prismaMock.organizationFindMany.mockRejectedValue(new Error("db gone"));

    const res = await backfillOrgWwwdOnBoot(silent);

    expect(res).toBeNull();
    expect(silent.error).toHaveBeenCalled();
  });
});

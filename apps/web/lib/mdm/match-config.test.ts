import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mdmMatchConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { MATCH_CONFIG_DEFAULTS, loadMatchConfig, saveMatchConfig } from "./match-config";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadMatchConfig", () => {
  it("returns code defaults when no row exists", async () => {
    vi.mocked(prisma.mdmMatchConfig.findUnique).mockResolvedValue(null as never);
    expect(await loadMatchConfig("customer-account")).toEqual(MATCH_CONFIG_DEFAULTS);
  });

  it("returns code defaults on a malformed row (matching can never break)", async () => {
    vi.mocked(prisma.mdmMatchConfig.findUnique).mockResolvedValue({
      config: { trgmFloor: "not-a-number" },
    } as never);
    expect(await loadMatchConfig("customer-account")).toEqual(MATCH_CONFIG_DEFAULTS);
  });

  it("returns code defaults when the DB errors", async () => {
    vi.mocked(prisma.mdmMatchConfig.findUnique).mockRejectedValue(new Error("db down"));
    expect(await loadMatchConfig("customer-account")).toEqual(MATCH_CONFIG_DEFAULTS);
  });

  it("parses a stored config", async () => {
    vi.mocked(prisma.mdmMatchConfig.findUnique).mockResolvedValue({
      config: { ...MATCH_CONFIG_DEFAULTS, likelyThreshold: 0.9, survivorship: "keep-survivor" },
    } as never);
    const config = await loadMatchConfig("customer-account");
    expect(config.likelyThreshold).toBe(0.9);
    expect(config.survivorship).toBe("keep-survivor");
  });
});

describe("saveMatchConfig", () => {
  it("merges partial overrides onto the current config and upserts", async () => {
    vi.mocked(prisma.mdmMatchConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.mdmMatchConfig.upsert).mockResolvedValue({} as never);
    const next = await saveMatchConfig("customer-account", { staleAfterDays: 90 }, "u1");
    expect(next.staleAfterDays).toBe(90);
    expect(next.likelyThreshold).toBe(MATCH_CONFIG_DEFAULTS.likelyThreshold);
    expect(prisma.mdmMatchConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { domain: "customer-account" },
        update: expect.objectContaining({ updatedBy: "u1" }),
      }),
    );
  });

  it("rejects out-of-range values via the schema", async () => {
    vi.mocked(prisma.mdmMatchConfig.findUnique).mockResolvedValue(null as never);
    await expect(saveMatchConfig("customer-account", { staleAfterDays: 1 }, "u1")).rejects.toThrow();
  });
});

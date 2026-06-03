import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    marketingChannelSpendCeiling: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    outboundPublication: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { assertSpendWithinCeiling, readSpendCeiling, setSpendCeiling } from "./spend-gate";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertSpendWithinCeiling", () => {
  it("refuses when no ceiling row exists", async () => {
    vi.mocked(prisma.marketingChannelSpendCeiling.findUnique).mockResolvedValue(null as never);
    const result = await assertSpendWithinCeiling({
      organizationId: "org-1",
      channelId: "linkedin-ads",
      proposedSpendCents: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/No weekly spend ceiling/);
  });

  it("accepts when proposed + current spend stays within ceiling", async () => {
    vi.mocked(prisma.marketingChannelSpendCeiling.findUnique).mockResolvedValue({
      weeklyCapCents: 100_00,
    } as never);
    vi.mocked(prisma.outboundPublication.findMany).mockResolvedValue([
      { channelMetadata: { spendCents: 30_00 } },
      { channelMetadata: { spendCents: 20_00 } },
    ] as never);
    const result = await assertSpendWithinCeiling({
      organizationId: "org-1",
      channelId: "linkedin-ads",
      proposedSpendCents: 25_00,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.currentSpendCents).toBe(50_00);
      expect(result.headroomCents).toBe(25_00);
    }
  });

  it("refuses with diff when proposed would cross ceiling", async () => {
    vi.mocked(prisma.marketingChannelSpendCeiling.findUnique).mockResolvedValue({
      weeklyCapCents: 100_00,
    } as never);
    vi.mocked(prisma.outboundPublication.findMany).mockResolvedValue([
      { channelMetadata: { spendCents: 80_00 } },
    ] as never);
    const result = await assertSpendWithinCeiling({
      organizationId: "org-1",
      channelId: "linkedin-ads",
      proposedSpendCents: 30_00,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/would exceed/i);
      expect(result.currentSpendCents).toBe(80_00);
      expect(result.ceilingCents).toBe(100_00);
    }
  });

  it("treats missing spendCents in metadata as zero", async () => {
    vi.mocked(prisma.marketingChannelSpendCeiling.findUnique).mockResolvedValue({
      weeklyCapCents: 50_00,
    } as never);
    vi.mocked(prisma.outboundPublication.findMany).mockResolvedValue([
      { channelMetadata: null },
      { channelMetadata: { spendCents: "not-a-number" } },
      { channelMetadata: { spendCents: 10_00 } },
    ] as never);
    const result = await assertSpendWithinCeiling({
      organizationId: "org-1",
      channelId: "linkedin-ads",
      proposedSpendCents: 20_00,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.currentSpendCents).toBe(10_00);
  });

  it("refuses when proposed spend is zero or negative", async () => {
    const result = await assertSpendWithinCeiling({
      organizationId: "org-1",
      channelId: "linkedin-ads",
      proposedSpendCents: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/> 0/);
  });
});

describe("readSpendCeiling", () => {
  it("returns null when no ceiling configured", async () => {
    vi.mocked(prisma.marketingChannelSpendCeiling.findUnique).mockResolvedValue(null as never);
    const result = await readSpendCeiling({
      organizationId: "org-1",
      channelId: "linkedin-ads",
    });
    expect(result).toBeNull();
  });

  it("returns headroom snapshot when ceiling is set", async () => {
    vi.mocked(prisma.marketingChannelSpendCeiling.findUnique).mockResolvedValue({
      weeklyCapCents: 200_00,
    } as never);
    vi.mocked(prisma.outboundPublication.findMany).mockResolvedValue([
      { channelMetadata: { spendCents: 75_00 } },
    ] as never);
    const result = await readSpendCeiling({
      organizationId: "org-1",
      channelId: "linkedin-ads",
    });
    expect(result).toEqual({
      weeklyCapCents: 200_00,
      currentSpendCents: 75_00,
      headroomCents: 125_00,
    });
  });
});

describe("setSpendCeiling", () => {
  it("rejects negative weeklyCapCents", async () => {
    const result = await setSpendCeiling({
      organizationId: "org-1",
      channelId: "linkedin-ads",
      weeklyCapCents: -1,
      userId: "user-1",
    });
    expect(result.ok).toBe(false);
  });

  it("upserts and returns ok", async () => {
    vi.mocked(prisma.marketingChannelSpendCeiling.upsert).mockResolvedValue({} as never);
    const result = await setSpendCeiling({
      organizationId: "org-1",
      channelId: "linkedin-ads",
      weeklyCapCents: 500_00,
      userId: "user-1",
    });
    expect(result.ok).toBe(true);
    expect(prisma.marketingChannelSpendCeiling.upsert).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    scheduledJob: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
// The Inngest client pulls in the whole queue graph at import; stub it.
vi.mock("../inngest-client", () => ({ inngest: { createFunction: () => ({}) } }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: vi.fn() }));

import { claimEvalSlot } from "./eval-background";

const NOW = new Date("2026-07-14T12:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("claimEvalSlot (BI-C8164664)", () => {
  it("wins the claim when the last eval attempt is older than the cooldown (or none)", async () => {
    mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(claimEvalSlot("local/qwen", NOW)).resolves.toBe(true);

    const where = mocks.prisma.scheduledJob.updateMany.mock.calls[0]?.[0]?.where;
    expect(where?.jobId).toBe("eval-local/qwen");
    // Recency guard: claim only when lastRunAt is stale or unset.
    expect(where?.OR).toEqual([
      { lastRunAt: { lt: expect.any(Date) } },
      { lastRunAt: null },
    ]);
    expect(mocks.prisma.scheduledJob.create).not.toHaveBeenCalled();
  });

  it("LOSES the claim (skips GPU work) for a storm re-invocation within the cooldown", async () => {
    // updateMany matched 0 rows (a fresh lastRunAt exists) and the row is present.
    mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.scheduledJob.findUnique.mockResolvedValue({ jobId: "eval-local/qwen" });

    await expect(claimEvalSlot("local/qwen", NOW)).resolves.toBe(false);
    expect(mocks.prisma.scheduledJob.create).not.toHaveBeenCalled();
  });

  it("creates and claims the slot on the first-ever eval for a model", async () => {
    mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.scheduledJob.findUnique.mockResolvedValue(null);
    mocks.prisma.scheduledJob.create.mockResolvedValue({});

    await expect(claimEvalSlot("local/new-model", NOW)).resolves.toBe(true);
    expect(mocks.prisma.scheduledJob.create).toHaveBeenCalledOnce();
    expect(mocks.prisma.scheduledJob.create.mock.calls[0]?.[0]?.data).toMatchObject({
      jobId: "eval-local/new-model",
      lastStatus: "running",
      lastRunAt: NOW,
    });
  });
});

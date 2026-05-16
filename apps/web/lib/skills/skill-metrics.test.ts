import { beforeEach, describe, expect, it, vi } from "vitest";

const { groupBy, upsert } = vi.hoisted(() => ({
  groupBy: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    skillUsageEvent: { groupBy },
    skillMetric: { upsert },
  },
}));

import { aggregateSkillMetrics } from "./skill-metrics";
import { getSkillMetricPeriod } from "./types";

describe("getSkillMetricPeriod", () => {
  it("returns the ISO month for a given date", () => {
    expect(getSkillMetricPeriod(new Date(Date.UTC(2026, 4, 15)))).toBe("2026-05");
  });
});

describe("aggregateSkillMetrics", () => {
  beforeEach(() => {
    groupBy.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue({});
  });

  it("rejects an invalid period key without touching the DB", async () => {
    await expect(aggregateSkillMetrics({ period: "not-a-period" })).rejects.toThrow(
      /invalid period key/,
    );
    expect(groupBy).not.toHaveBeenCalled();
  });

  it("aggregates invoked and completed counts per (skill, agent) pair", async () => {
    groupBy.mockResolvedValue([
      { skillId: "a", agentId: "AGT-1", phase: "invoked", _count: { _all: 5 } },
      { skillId: "a", agentId: "AGT-1", phase: "completed", _count: { _all: 4 } },
      { skillId: "b", agentId: "AGT-2", phase: "invoked", _count: { _all: 2 } },
    ]);

    const result = await aggregateSkillMetrics({ period: "2026-05" });

    expect(result).toEqual({ period: "2026-05", upserted: 2 });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          skillId_agentId_period: { skillId: "a", agentId: "AGT-1", period: "2026-05" },
        },
        create: expect.objectContaining({ invocationCount: 5, successCount: 4 }),
        update: expect.objectContaining({ invocationCount: 5, successCount: 4 }),
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ skillId: "b", invocationCount: 2, successCount: 0 }),
      }),
    );
  });

  it("queries within the start-of-month/start-of-next-month window", async () => {
    groupBy.mockResolvedValue([]);
    await aggregateSkillMetrics({ period: "2026-05" });
    const args = groupBy.mock.calls[0]?.[0] as {
      where: { createdAt: { gte: Date; lt: Date }; phase: { in: string[] } };
    };
    expect(args.where.createdAt.gte.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(args.where.createdAt.lt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(args.where.phase.in).toEqual(["invoked", "completed"]);
  });

  it("is idempotent — a repeat run produces the same upsert payloads, never inserts", async () => {
    groupBy.mockResolvedValue([
      { skillId: "a", agentId: "AGT-1", phase: "invoked", _count: { _all: 3 } },
      { skillId: "a", agentId: "AGT-1", phase: "completed", _count: { _all: 3 } },
    ]);
    await aggregateSkillMetrics({ period: "2026-05" });
    await aggregateSkillMetrics({ period: "2026-05" });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0]?.[0]).toEqual(upsert.mock.calls[1]?.[0]);
  });

  it("returns upserted: 0 when no events exist in the period", async () => {
    groupBy.mockResolvedValue([]);
    const result = await aggregateSkillMetrics({ period: "2026-05" });
    expect(result.upserted).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});

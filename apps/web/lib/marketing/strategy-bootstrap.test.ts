import { describe, expect, it, vi } from "vitest";

import { upsertMarketingStrategyTolerant } from "./strategy-bootstrap";

function p2002(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

describe("upsertMarketingStrategyTolerant", () => {
  const args = {
    where: { organizationId: "org-1" },
    update: {},
    create: { organizationId: "org-1" },
  };

  it("reuses the winning organization row when concurrent bootstrap loses the create race", async () => {
    const winningStrategy = {
      strategyId: "strategy-winner",
      organizationId: "org-1",
    };
    const store = {
      upsert: vi.fn().mockRejectedValue(p2002()),
      findUnique: vi.fn().mockResolvedValue(winningStrategy),
    };

    await expect(upsertMarketingStrategyTolerant(store, args)).resolves.toEqual(winningStrategy);
    expect(store.findUnique).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
    });
  });

  it("returns the normal upsert result without a recovery read", async () => {
    const strategy = {
      strategyId: "strategy-created",
      organizationId: "org-1",
    };
    const store = {
      upsert: vi.fn().mockResolvedValue(strategy),
      findUnique: vi.fn(),
    };

    await expect(upsertMarketingStrategyTolerant(store, args)).resolves.toEqual(strategy);
    expect(store.findUnique).not.toHaveBeenCalled();
  });

  it("does not hide unrelated database failures", async () => {
    const failure = Object.assign(new Error("Database unavailable"), {
      code: "P1001",
    });
    const store = {
      upsert: vi.fn().mockRejectedValue(failure),
      findUnique: vi.fn(),
    };

    await expect(upsertMarketingStrategyTolerant(store, args)).rejects.toBe(failure);
    expect(store.findUnique).not.toHaveBeenCalled();
  });

  it("rethrows a unique violation when no winning organization row exists", async () => {
    const failure = p2002();
    const store = {
      upsert: vi.fn().mockRejectedValue(failure),
      findUnique: vi.fn().mockResolvedValue(null),
    };

    await expect(upsertMarketingStrategyTolerant(store, args)).rejects.toBe(failure);
  });
});

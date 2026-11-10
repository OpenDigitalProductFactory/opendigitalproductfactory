// BI-7BCC87BB (spec D2 S3): a confirmed activity-routing override is a UserFact
// because that is the configuration-fact pattern the spec chose
// (persistProactivityFact). It is configuration read by routing, not recalled
// memory, so the nightly memory passes must never expire it for being unused
// or collapse two overrides whose values look alike.
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  userFact: { findMany: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma }));

import { expireStaleUserFacts } from "./memory-expiry-runner";
import { dedupeUserFacts } from "./memory-consolidation-runner";

const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  prisma.userFact.updateMany.mockResolvedValue({ count: 0 });
});

describe("activity-routing overrides survive the memory passes", () => {
  it("are never expired as unused memory", async () => {
    prisma.userFact.findMany.mockResolvedValue([
      { id: "override", category: "activity-routing-override", createdAt: LONG_AGO, lastAccessedAt: null },
      { id: "stale-pref", category: "preference", createdAt: LONG_AGO, lastAccessedAt: null },
    ]);
    await expireStaleUserFacts("user-1", { now: new Date("2026-10-07T00:00:00.000Z") });
    expect(prisma.userFact.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["stale-pref"] } },
      data: { supersededAt: expect.any(Date) },
    });
  });

  it("are left out of the near-duplicate sweep", async () => {
    prisma.userFact.findMany.mockResolvedValue([]);
    await dedupeUserFacts("user-1");
    expect(prisma.userFact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", supersededAt: null, category: { not: "activity-routing-override" } },
    }));
  });
});

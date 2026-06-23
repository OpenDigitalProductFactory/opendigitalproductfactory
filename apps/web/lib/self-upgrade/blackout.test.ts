import { describe, expect, it, vi } from "vitest";

// blackout.ts imports the prisma client for its DB reader; the pure predicate
// under test never touches it, so stub the module to keep this unit test hermetic.
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { findActiveSelfUpgradeBlackout } from "./blackout";

const NOW = new Date("2026-07-04T12:00:00Z");

function blackout(overrides: Partial<{ name: string; startAt: Date; endAt: Date; exceptions: string[] }> = {}) {
  return {
    name: "Launch week freeze",
    startAt: new Date("2026-07-01T00:00:00Z"),
    endAt: new Date("2026-07-08T00:00:00Z"),
    exceptions: [] as string[],
    ...overrides,
  };
}

describe("findActiveSelfUpgradeBlackout", () => {
  it("returns the active blackout that covers now", () => {
    expect(findActiveSelfUpgradeBlackout([blackout()], NOW)).toEqual({
      name: "Launch week freeze",
      endAt: new Date("2026-07-08T00:00:00Z"),
    });
  });

  it("returns null when no blackout covers now (past / future)", () => {
    const past = blackout({ startAt: new Date("2026-06-01T00:00:00Z"), endAt: new Date("2026-06-02T00:00:00Z") });
    const future = blackout({ startAt: new Date("2026-08-01T00:00:00Z"), endAt: new Date("2026-08-02T00:00:00Z") });
    expect(findActiveSelfUpgradeBlackout([past, future], NOW)).toBeNull();
  });

  it("treats the start and end instants as inclusive", () => {
    const atStart = blackout({ startAt: NOW, endAt: new Date("2026-07-05T00:00:00Z") });
    const atEnd = blackout({ startAt: new Date("2026-07-01T00:00:00Z"), endAt: NOW });
    expect(findActiveSelfUpgradeBlackout([atStart], NOW)).not.toBeNull();
    expect(findActiveSelfUpgradeBlackout([atEnd], NOW)).not.toBeNull();
  });

  it("does NOT block when the blackout excepts self-upgrade or standard changes", () => {
    expect(findActiveSelfUpgradeBlackout([blackout({ exceptions: ["self-upgrade"] })], NOW)).toBeNull();
    expect(findActiveSelfUpgradeBlackout([blackout({ exceptions: ["standard"] })], NOW)).toBeNull();
  });

  it("still blocks when the exceptions are for unrelated change types", () => {
    expect(
      findActiveSelfUpgradeBlackout([blackout({ exceptions: ["emergency", "normal"] })], NOW),
    ).not.toBeNull();
  });

  it("returns the first blocking blackout when several are active", () => {
    const excepted = blackout({ name: "ok", exceptions: ["standard"] });
    const blocking = blackout({ name: "freeze" });
    expect(findActiveSelfUpgradeBlackout([excepted, blocking], NOW)?.name).toBe("freeze");
  });
});

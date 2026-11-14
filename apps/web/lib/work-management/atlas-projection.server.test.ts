import { describe, expect, it, vi } from "vitest";

const loadCapsuleLivenessInventory = vi.fn();
const loadRoomAccountabilityBatch = vi.fn();
vi.mock("@/lib/work-capsules/liveness-inventory", () => ({ loadCapsuleLivenessInventory }));
vi.mock("@/lib/work-management/room-workforce.server", () => ({ loadRoomAccountabilityBatch }));

const { loadAtlasPicture } = await import("./atlas-projection.server");

const owner = { accountability: { state: "resolved", principalId: "P-1", source: "organization-owner", inheritedFrom: [] }, accountableDisplayName: "Mark" };

function inventoryRow(i: number) {
  return {
    id: `row-${i}`, capsuleId: `WC-${i}`, title: `Room ${i}`, status: "working", liveness: "live", isLive: true,
    portfolioRole: null, trueLivenessAt: "2026-11-03T17:00:00.000Z",
    drive: { action: null, reason: null, attentionRecorded: false, stageKey: i === 0 ? "implement" : null },
  };
}

describe("loadAtlasPicture", () => {
  it("reads every open room past the old 200-room cap, through the shared inventory", async () => {
    loadCapsuleLivenessInventory.mockResolvedValueOnce({ capsulesAll: Array.from({ length: 250 }, (_, i) => inventoryRow(i)), livenessSummary: {} });
    loadRoomAccountabilityBatch.mockResolvedValueOnce(new Map([["row-0", owner]]));
    const picture = await loadAtlasPicture({} as never);
    expect(loadCapsuleLivenessInventory).toHaveBeenCalledWith({}, expect.objectContaining({
      where: { archivedAt: null }, take: 2001, portalSummary: true,
    }));
    expect(picture.total).toBe(250);
    expect(picture.truncated).toBe(false);
    expect(picture.rooms[0]).toMatchObject({ capsuleId: "WC-0", owner: "Mark", stage: "implement", portfolio: "unplaced", health: "working" });
  });

  it("reports truncation when more rooms exist than the limit", async () => {
    loadCapsuleLivenessInventory.mockResolvedValueOnce({ capsulesAll: Array.from({ length: 4 }, (_, i) => inventoryRow(i)), livenessSummary: {} });
    loadRoomAccountabilityBatch.mockResolvedValueOnce(new Map());
    const picture = await loadAtlasPicture({} as never, { limit: 3, portfolioRole: "foundational" });
    expect(loadCapsuleLivenessInventory).toHaveBeenLastCalledWith({}, expect.objectContaining({
      where: { archivedAt: null, portfolioRole: "foundational" }, take: 4,
    }));
    expect(picture).toMatchObject({ total: 3, truncated: true });
  });

  it("reads each room's declared shape in one bounded query (BI-3791FDD8)", async () => {
    loadCapsuleLivenessInventory.mockResolvedValueOnce({ capsulesAll: [inventoryRow(0), inventoryRow(1)], livenessSummary: {} });
    loadRoomAccountabilityBatch.mockResolvedValueOnce(new Map());
    const findMany = vi.fn(async () => [{ capsuleId: "WC-0", scopeClaims: [{ workShape: "delivery-small@1.0.0" }] }]);
    const picture = await loadAtlasPicture({ workroom: { findMany } } as never);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({ where: { capsuleId: { in: ["WC-0", "WC-1"] } }, select: { capsuleId: true, scopeClaims: true } });
    expect(picture.rooms[0]).toMatchObject({ capsuleId: "WC-0", shape: "delivery-small" });
    expect(picture.rooms[1]).not.toHaveProperty("shape");
  });
});

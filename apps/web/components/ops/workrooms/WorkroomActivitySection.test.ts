import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => (key: string) => key }));
const fixture = vi.hoisted(() => ({
  load: vi.fn(), owners: vi.fn(),
}));
vi.mock("@/lib/work-capsules/liveness-inventory", () => ({ loadCapsuleLivenessInventory: fixture.load }));
vi.mock("@/lib/work-management/room-workforce.server", () => ({ loadRoomAccountabilityBatch: fixture.owners }));
import { WorkroomActivitySection, workroomInventoryWhere } from "./WorkroomActivitySection";
import { WorkroomInventory } from "./WorkroomInventory";

// EP-2FB6C0CC, BI-2EA3BB99 — AC-AREA-WORK: an area's Work view runs the same
// inventory query as /ops/workrooms, narrowed to its portfolio and nothing else,
// so both views list the same rooms for that portfolio.
describe("workroomInventoryWhere", () => {
  it("reads every room for the full inventory", () => {
    expect(workroomInventoryWhere()).toEqual({});
  });

  it("narrows only by portfolio for an area's Work view", () => {
    expect(workroomInventoryWhere("productsAndServicesSold")).toEqual({ portfolioRole: "productsAndServicesSold" });
  });
  it("batches accountability and sends display data instead of full recovery/scope packets", async () => {
    const rooms = Array.from({ length: 200 }, (_, i) => ({ id: `row-${i}`, capsuleId: `WC-${i}`,
      backlogItemId: null, title: `Work ${i}`, status: "working", source: "manual", executorKind: "codex-desktop",
      attribution: { executor: "codex-desktop", invocation: "session" }, portfolioRole: null,
      headBranch: null, pullRequestUrl: null, updatedAt: new Date(), liveness: "live", isLive: true,
      isReapable: false, livenessReason: "Recent progress", trueLivenessAt: null,
      outcomeAnchor: { narrative: "large-outcome-packet".repeat(400) },
      scopeClaims: [{ privateData: "scope-private".repeat(400) }], recovery: { packet: "source-path".repeat(400) },
    }));
    fixture.load.mockResolvedValue({ capsulesAll: rooms, livenessSummary: { live: 200, history: 0,
      heavyLane: { executing: 0, nextReady: 0, dormant: 0 }, progressSlo: { oldestWaitMs: null } } });
    fixture.owners.mockResolvedValue(new Map(rooms.map(room => [room.id, {
      accountableDisplayName: "Recorded person", accountability: { state: "resolved", principalId: "P-1", source: "organization-owner", inheritedFrom: [] },
    }])));
    const element = await WorkroomActivitySection({});
    let payload: unknown;
    const walk = (node: ReactNode) => Children.forEach(node, child => {
      if (!isValidElement<{ children?: ReactNode; workrooms?: unknown }>(child)) return;
      if (child.type === WorkroomInventory) payload = child.props.workrooms;
      walk(child.props.children);
    });
    walk(element);
    expect(fixture.owners).toHaveBeenCalledTimes(1);
    expect(fixture.owners.mock.calls[0]![1]).toHaveLength(200);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/large-outcome-packet|scope-private|source-path/);
    expect(serialized).toContain("Recorded person");
    expect(serialized.length).toBeLessThan(JSON.stringify(rooms).length / 10);
    expect(fixture.load).toHaveBeenCalledWith({}, expect.objectContaining({ take: 200, portalSummary: true }));
    console.info(`Workroom fixture payload: ${JSON.stringify(rooms).length} → ${serialized.length} characters`);
  });
});

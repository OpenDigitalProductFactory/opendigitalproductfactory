import { describe, expect, it, vi } from "vitest";

import { loadBuildStudioCustomerStatuses } from "@/lib/build/customer-status-loader";
import { STALLED_BUILD_REAP_MS } from "@/lib/build/inert-build-reaper";

const NOW = new Date("2026-07-24T00:00:00Z");
const RECENT = new Date(NOW.getTime() - 5 * 60 * 1000);
const STALE = new Date(NOW.getTime() - STALLED_BUILD_REAP_MS - 60_000);

function dbWith(
  capsuleRows: Array<{ featureBuildId: string | null; capsuleId: string; status: string; workspaceState?: unknown }>,
  activityRows: Array<{ buildId: string; _max: { createdAt: Date | null } }> = [],
) {
  const findMany = vi.fn().mockResolvedValue(capsuleRows.map((row) => ({ workspaceState: {}, ...row })));
  const groupBy = vi.fn().mockResolvedValue(activityRows);
  return { db: { workCapsule: { findMany }, buildActivity: { groupBy } }, findMany, groupBy };
}

describe("loadBuildStudioCustomerStatuses (BI-BB13B599)", () => {
  it("projects the capsule-derived status when a capsule is linked to the build", async () => {
    const { db, findMany } = dbWith(
      [{ featureBuildId: "cuid-1", capsuleId: "WC-1", status: "working" }],
      [{ buildId: "FB-1", _max: { createdAt: RECENT } }],
    );

    const statuses = await loadBuildStudioCustomerStatuses(
      db,
      [{ id: "cuid-1", buildId: "FB-1", title: "Add invoicing", phase: "build", updatedAt: RECENT }],
      NOW,
    );

    // queried by the cuid ids
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { featureBuildId: { in: ["cuid-1"] } } }),
    );
    // a "working" capsule projects to the active WorkCase state — not the
    // phase-only fallback ("Building it") — proving the capsule path is taken.
    expect(statuses["cuid-1"]).toEqual(
      expect.objectContaining({ whatIsBeingBuilt: "Add invoicing", lifecyclePosition: "In progress" }),
    );
  });

  it("surfaces needsYou from the capsule projection when the capsule is blocked", async () => {
    const { db } = dbWith([{ featureBuildId: "cuid-b", capsuleId: "WC-B", status: "blocked" }]);

    const statuses = await loadBuildStudioCustomerStatuses(
      db,
      [{ id: "cuid-b", buildId: "FB-B", title: "Wire webhook", phase: "build", updatedAt: RECENT }],
      NOW,
    );

    expect(statuses["cuid-b"].needsYou).toBe(true);
  });

  it("degrades to the phase-only fallback when no capsule is linked", async () => {
    const { db } = dbWith([]);

    const statuses = await loadBuildStudioCustomerStatuses(
      db,
      [{ id: "cuid-2", buildId: "FB-2", title: "Fix login", phase: "failed", updatedAt: RECENT }],
      NOW,
    );

    expect(statuses["cuid-2"]).toEqual(
      expect.objectContaining({
        whatIsBeingBuilt: "Fix login",
        lifecyclePosition: "Hit a problem",
        needsYou: true,
      }),
    );
  });

  it("returns an empty map and skips both queries when there are no builds", async () => {
    const { db, findMany, groupBy } = dbWith([]);

    const statuses = await loadBuildStudioCustomerStatuses(db, []);

    expect(statuses).toEqual({});
    expect(findMany).not.toHaveBeenCalled();
    expect(groupBy).not.toHaveBeenCalled();
  });

  it("dedupes build ids before querying", async () => {
    const { db, findMany, groupBy } = dbWith([]);

    await loadBuildStudioCustomerStatuses(
      db,
      [
        { id: "cuid-3", buildId: "FB-3", title: "A", phase: "plan", updatedAt: RECENT },
        { id: "cuid-3", buildId: "FB-3", title: "A", phase: "plan", updatedAt: RECENT },
      ],
      NOW,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { featureBuildId: { in: ["cuid-3"] } } }),
    );
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildId: { in: ["FB-3"] } } }),
    );
  });

  describe("activity-freshness stall wiring (BI-46204009)", () => {
    it("joins BuildActivity on the FB-* buildId, not the cuid id, and flags a stalled build/review build", async () => {
      const { db, groupBy } = dbWith(
        [],
        [{ buildId: "FB-CCEC4210", _max: { createdAt: STALE } }],
      );

      const statuses = await loadBuildStudioCustomerStatuses(
        db,
        [
          {
            id: "cuid-stalled",
            buildId: "FB-CCEC4210",
            title: "Backlog autopilot pipeline",
            phase: "build",
            updatedAt: STALE,
          },
        ],
        NOW,
      );

      expect(groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { buildId: { in: ["FB-CCEC4210"] } } }),
      );
      expect(statuses["cuid-stalled"].lifecyclePosition).toBe("Stalled / needs attention");
      expect(statuses["cuid-stalled"].needsYou).toBe(true);
    });

    it("keeps a genuinely-working build/review build as 'Working' when BuildActivity is recent", async () => {
      const { db } = dbWith([], [{ buildId: "FB-14D6EB41", _max: { createdAt: RECENT } }]);

      const statuses = await loadBuildStudioCustomerStatuses(
        db,
        [{ id: "cuid-live", buildId: "FB-14D6EB41", title: "Wire target archetypes", phase: "review", updatedAt: RECENT }],
        NOW,
      );

      expect(statuses["cuid-live"].lifecyclePosition).not.toBe("Stalled / needs attention");
      expect(statuses["cuid-live"].needsYou).toBe(false);
    });

    it("falls back to build.updatedAt when a build has no BuildActivity rows at all", async () => {
      const { db } = dbWith([], []);

      const statuses = await loadBuildStudioCustomerStatuses(
        db,
        [{ id: "cuid-no-activity", buildId: "FB-NOACT", title: "Never emitted activity", phase: "build", updatedAt: STALE }],
        NOW,
      );

      expect(statuses["cuid-no-activity"].lifecyclePosition).toBe("Stalled / needs attention");
      expect(statuses["cuid-no-activity"].needsYou).toBe(true);
    });
  });
});

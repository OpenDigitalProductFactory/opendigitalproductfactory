import { describe, expect, it, vi } from "vitest";

import { loadBuildStudioCustomerStatuses } from "@/lib/build/customer-status-loader";

function dbWith(rows: Array<{ featureBuildId: string | null; capsuleId: string; status: string }>) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { db: { workCapsule: { findMany } }, findMany };
}

describe("loadBuildStudioCustomerStatuses (BI-BB13B599)", () => {
  it("projects the capsule-derived status when a capsule is linked to the build", async () => {
    const { db, findMany } = dbWith([
      { featureBuildId: "cuid-1", capsuleId: "WC-1", status: "working" },
    ]);

    const statuses = await loadBuildStudioCustomerStatuses(db, [
      { id: "cuid-1", title: "Add invoicing", phase: "build" },
    ]);

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
    const { db } = dbWith([
      { featureBuildId: "cuid-b", capsuleId: "WC-B", status: "blocked" },
    ]);

    const statuses = await loadBuildStudioCustomerStatuses(db, [
      { id: "cuid-b", title: "Wire webhook", phase: "build" },
    ]);

    expect(statuses["cuid-b"].needsYou).toBe(true);
  });

  it("degrades to the phase-only fallback when no capsule is linked", async () => {
    const { db } = dbWith([]);

    const statuses = await loadBuildStudioCustomerStatuses(db, [
      { id: "cuid-2", title: "Fix login", phase: "failed" },
    ]);

    expect(statuses["cuid-2"]).toEqual(
      expect.objectContaining({
        whatIsBeingBuilt: "Fix login",
        lifecyclePosition: "Hit a problem",
        needsYou: true,
      }),
    );
  });

  it("returns an empty map and skips the query when there are no builds", async () => {
    const { db, findMany } = dbWith([]);

    const statuses = await loadBuildStudioCustomerStatuses(db, []);

    expect(statuses).toEqual({});
    expect(findMany).not.toHaveBeenCalled();
  });

  it("dedupes build ids before querying", async () => {
    const { db, findMany } = dbWith([]);

    await loadBuildStudioCustomerStatuses(db, [
      { id: "cuid-3", title: "A", phase: "plan" },
      { id: "cuid-3", title: "A", phase: "plan" },
    ]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { featureBuildId: { in: ["cuid-3"] } } }),
    );
  });
});

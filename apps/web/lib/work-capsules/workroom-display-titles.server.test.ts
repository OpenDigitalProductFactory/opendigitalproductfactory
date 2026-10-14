import { describe, expect, it, vi } from "vitest";
import { loadWorkroomDisplayTitles, workroomDisplayTitle } from "./workroom-display-titles.server";
describe("human request names", () => {
  it("reads request names once and preserves deliberate room titles", async () => {
    const findMany = vi.fn().mockResolvedValue([{ itemId: "BI-1", title: "Repair foster intake", sensitivity: "internal", scopeKind: "platform" }]);
    const rooms = [{ backlogItemId: "BI-1", title: "Work on BI-1" }, { backlogItemId: "BI-1", title: "Intake follow-up" }];
    const titles = await loadWorkroomDisplayTitles({ backlogItem: { findMany } }, rooms);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({ where: { itemId: { in: ["BI-1"] } }, select: { itemId: true, title: true, sensitivity: true, scopeKind: true }, take: 1 });
    expect(workroomDisplayTitle(rooms[0]!, titles)).toBe("Repair foster intake");
    expect(workroomDisplayTitle(rooms[1]!, titles)).toBe("Intake follow-up");
    expect(workroomDisplayTitle({ backlogItemId: "BI-1", title: "Acceptance: BI-1" }, titles)).toBe("Verify: Repair foster intake");
  });
  it("reports a missing generated name without displaying an internal ID as the task", () => {
    expect(workroomDisplayTitle({ title: "Work on BI-MISSING", backlogItemId: "BI-MISSING" }, new Map())).toBe("Request name unavailable");
  });
  it("does not enrich area metadata with a confidential request name", async () => {
    const titles = await loadWorkroomDisplayTitles({ backlogItem: { findMany: async () => [
      { itemId: "BI-PRIVATE", title: "Private request", sensitivity: "confidential", scopeKind: "platform" },
    ] } }, [{ title: "Work on BI-PRIVATE", backlogItemId: "BI-PRIVATE" }]);
    expect(titles.has("BI-PRIVATE")).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasPicture } from "@/lib/work-management/atlas-projection";

const picture: AtlasPicture = {
  observedAt: "2026-11-03T17:30:00.000Z",
  total: 2,
  truncated: false,
  counts: { "needs-person": 1, stuck: 0, working: 1, waiting: 0, "no-signal": 0, finished: 0 },
  rooms: [
    { capsuleId: "WC-A", title: "Room A", portfolio: "foundational", health: "working", label: "inventory.status.working" },
    { capsuleId: "WC-B", title: "Room B", portfolio: "unplaced", health: "needs-person", label: "inventory.status.closeout" },
  ],
};

const loadAtlasPicture = vi.fn(async (_db: unknown, _options?: unknown) => picture);
vi.mock("@/lib/work-management/atlas-projection.server", () => ({ loadAtlasPicture }));
vi.mock("@dpf/db", () => ({ prisma: {} }));

const { listWorkCapsulesTool } = await import("./mcp-handlers");

describe("list_workrooms view atlas", () => {
  beforeEach(() => loadAtlasPicture.mockClear());

  it.each([{ decisionScope: "wwmd" }, { status: "working" }])("refuses unsupported instance filter %j", async (filter) => {
    const result = await listWorkCapsulesTool({ view: "atlas", ...filter }, "user-1");
    expect(result).toMatchObject({ success: false, error: "invalid_atlas_filters" });
    expect(loadAtlasPicture).not.toHaveBeenCalled();
  });

  it("returns the portal's counts and rows unchanged", async () => {
    const result = await listWorkCapsulesTool({ view: "atlas", limit: 400 }, "user-1");
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      observedAt: picture.observedAt, total: picture.total, truncated: false, counts: picture.counts,
      roomsMatching: 2, rooms: picture.rooms,
    });
    expect(loadAtlasPicture).toHaveBeenCalledTimes(1);
  });

  it("filters rows by health with the same tuples the portal shows", async () => {
    const result = await listWorkCapsulesTool({ view: "atlas", health: "needs-person" }, "user-1");
    expect(result.data).toMatchObject({ roomsMatching: 1, rooms: [picture.rooms[1]], counts: picture.counts });
  });

  it("returns at most the requested number of rows and says how many matched", async () => {
    const result = await listWorkCapsulesTool({ view: "atlas", limit: 1 }, "user-1");
    expect(result.data).toMatchObject({ roomsMatching: 2, rooms: [picture.rooms[0]] });
  });

  it("refuses an unknown health or an out-of-range limit", async () => {
    expect(await listWorkCapsulesTool({ view: "atlas", health: "fine" }, "user-1")).toMatchObject({ success: false, error: "invalid_health" });
    expect(await listWorkCapsulesTool({ view: "atlas", limit: 0 }, "user-1")).toMatchObject({ success: false, error: "invalid_page_input" });
    expect(loadAtlasPicture).not.toHaveBeenCalled();
  });

  it("passes a portfolio filter through to the same loader", async () => {
    await listWorkCapsulesTool({ view: "atlas", portfolioRole: "foundational" }, "user-1");
    expect(loadAtlasPicture.mock.calls[0]?.[1]).toMatchObject({ portfolioRole: "foundational" });
  });

  it("refuses an unknown portfolio rather than returning an empty picture", async () => {
    const result = await listWorkCapsulesTool({ view: "atlas", portfolioRole: "nowhere" }, "user-1");
    expect(result).toMatchObject({ success: false, error: "invalid_portfolioRole" });
    expect(loadAtlasPicture).not.toHaveBeenCalled();
  });
});

describe("atlas view budget", () => {
  it("fits ten worst-case rows in the in-platform coworker result budget without truncation", async () => {
    const { clampToolResultForModel } = await import("@/lib/tak/tool-result-budget");
    const wide: AtlasPicture = {
      ...picture,
      total: 10,
      rooms: Array.from({ length: 10 }, (_, i) => ({
        capsuleId: `WC-${(0x10000000 + i).toString(16).toUpperCase()}`,
        title: `${"x".repeat(79)}…`,
        portfolio: "productsAndServicesSold",
        health: "needs-person" as const,
        label: "inventory.status.ownerNeeded" as const,
        owner: "Accountable Person Name",
        stage: "implementation-review",
        lastSignalAt: "2026-11-03T17:00:00.000Z",
      })),
    };
    loadAtlasPicture.mockResolvedValueOnce(wide);
    const result = await listWorkCapsulesTool({ view: "atlas" }, "user-1");
    expect(clampToolResultForModel(result).truncated).toBe(false);
  });
});

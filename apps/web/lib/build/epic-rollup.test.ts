import { describe, expect, it } from "vitest";

import { deriveEpicRollup } from "./epic-rollup";

describe("deriveEpicRollup", () => {
  it("bridges backlog items to ordered child builds and derives waiting-on titles", () => {
    const rollup = deriveEpicRollup({
      epic: {
        id: "epic-row-1",
        epicId: "EP-TRUCK-STOCK",
        title: "Truck stock tracker",
        updatedAt: new Date("2026-05-25T12:00:00Z"),
        originatingBacklogItemId: "bi-row-origin",
        items: [
          { id: "bi-row-origin", itemId: "BI-ORIGIN", title: "Track truck parts", status: "in-progress" },
          { id: "bi-row-restock", itemId: "BI-RESTOCK", title: "Surface restock needs", status: "open" },
        ],
        featureBuilds: [
          {
            id: "fb-low-stock-row",
            buildId: "FB-LOW",
            title: "Low-stock surfacing",
            phase: "plan",
            childOrder: 3,
            updatedAt: new Date("2026-05-25T11:30:00Z"),
          },
          {
            id: "fb-read-row",
            buildId: "FB-READ",
            title: "Truck and parts read",
            phase: "complete",
            childOrder: 1,
            updatedAt: new Date("2026-05-25T10:00:00Z"),
          },
          {
            id: "fb-usage-row",
            buildId: "FB-USAGE",
            title: "Record usage",
            phase: "build",
            childOrder: 2,
            updatedAt: new Date("2026-05-25T11:00:00Z"),
          },
        ],
        dependencies: [
          {
            dependentBuildId: "fb-low-stock-row",
            dependsOnBuildId: "fb-read-row",
          },
          {
            dependentBuildId: "fb-low-stock-row",
            dependsOnBuildId: "fb-usage-row",
          },
        ],
      },
    });

    expect(rollup.backlogItems).toEqual([
      {
        itemId: "BI-ORIGIN",
        title: "Track truck parts",
        status: "in-progress",
        isOriginating: true,
      },
      {
        itemId: "BI-RESTOCK",
        title: "Surface restock needs",
        status: "open",
        isOriginating: false,
      },
    ]);
    expect(rollup.backlogSummary).toBe("2 backlog items");
    expect(rollup.children.map((child) => child.buildId)).toEqual(["FB-READ", "FB-USAGE", "FB-LOW"]);
    expect(rollup.children[2]?.waitingOn).toEqual(["Record usage"]);
    expect(rollup.rollupSummary).toBe("1 of 3 done \u00b7 1 in build \u00b7 1 waiting");
    expect(rollup.status).toBe("in-progress");
    expect(rollup.updatedAt).toEqual(new Date("2026-05-25T12:00:00Z"));
  });

  it("marks an epic complete when every child build is complete", () => {
    const rollup = deriveEpicRollup({
      epic: {
        id: "epic-row-2",
        epicId: "EP-COMPLETE",
        title: "Done work",
        updatedAt: new Date("2026-05-25T12:00:00Z"),
        originatingBacklogItemId: null,
        items: [],
        featureBuilds: [
          {
            id: "fb-a-row",
            buildId: "FB-A",
            title: "First child",
            phase: "complete",
            childOrder: 1,
            updatedAt: new Date("2026-05-25T12:00:00Z"),
          },
          {
            id: "fb-b-row",
            buildId: "FB-B",
            title: "Second child",
            phase: "complete",
            childOrder: 2,
            updatedAt: new Date("2026-05-25T12:00:00Z"),
          },
        ],
        dependencies: [],
      },
    });

    expect(rollup.status).toBe("complete");
    expect(rollup.rollupSummary).toBe("2 of 2 done");
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EpicRollupListItem } from "./EpicRollupListItem";
import type { EpicRollupView } from "@/lib/build/epic-rollup";

function makeRollup(overrides: Partial<EpicRollupView> = {}): EpicRollupView {
  return {
    epicId: "EP-TRUCK-STOCK",
    title: "Truck stock tracker",
    updatedAt: new Date("2026-05-25T12:00:00Z"),
    status: "in-progress",
    backlogItems: [
      { itemId: "BI-ORIGIN", title: "Track truck parts", status: "in-progress", isOriginating: true },
      { itemId: "BI-RESTOCK", title: "Surface restock needs", status: "open", isOriginating: false },
    ],
    backlogSummary: "2 backlog items",
    childPhases: [
      { phase: "complete", count: 1 },
      { phase: "build", count: 1 },
      { phase: "plan", count: 1 },
    ],
    children: [
      {
        buildId: "FB-READ",
        title: "Truck and parts read",
        phase: "complete",
        childOrder: 1,
        waitingOn: [],
        updatedAt: new Date("2026-05-25T10:00:00Z"),
      },
      {
        buildId: "FB-USAGE",
        title: "Record usage",
        phase: "build",
        childOrder: 2,
        waitingOn: [],
        updatedAt: new Date("2026-05-25T11:00:00Z"),
      },
      {
        buildId: "FB-LOW",
        title: "Low-stock surfacing",
        phase: "plan",
        childOrder: 3,
        waitingOn: ["Record usage"],
        updatedAt: new Date("2026-05-25T11:30:00Z"),
      },
    ],
    rollupSummary: "1 of 3 done \u00b7 1 in build \u00b7 1 waiting",
    ...overrides,
  };
}

describe("EpicRollupListItem", () => {
  it("renders a collapsed epic bridge row with backlog and child-build rollup", () => {
    const html = renderToStaticMarkup(
      <EpicRollupListItem
        rollup={makeRollup()}
        activeBuildId={null}
        expanded={false}
        index={0}
        onToggle={vi.fn()}
        onSelectBuild={vi.fn()}
      />,
    );

    expect(html).toContain("Truck stock tracker");
    expect(html).toContain("1 of 3 done");
    expect(html).toContain("2 backlog items");
    expect(html).toContain("Updated May 25");
    expect(html).not.toContain("Low-stock surfacing");
  });

  it("renders expanded child rows with phase badges and waiting-on titles", () => {
    const html = renderToStaticMarkup(
      <EpicRollupListItem
        rollup={makeRollup()}
        activeBuildId="FB-LOW"
        expanded
        index={0}
        onToggle={vi.fn()}
        onSelectBuild={vi.fn()}
      />,
    );

    expect(html).toContain("Truck and parts read");
    expect(html).toContain("Record usage");
    expect(html).toContain("Low-stock surfacing");
    expect(html).toContain("Waiting on: Record usage");
    expect(html).toContain("data-active-child=\"true\"");
    expect(html).toContain("Plan");
  });
});

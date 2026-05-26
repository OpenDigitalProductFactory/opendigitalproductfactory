// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BusinessCapabilityMap } from "./BusinessCapabilityMap";

const summary = {
  totalCapabilities: 0,
  l1Count: 0,
  l2Count: 0,
  l3Count: 0,
  gapCount: 0,
  watchCount: 0,
  alignedCount: 0,
};

describe("BusinessCapabilityMap", () => {
  it("renders the read-only archetype capability perspective provenance", () => {
    render(
      <BusinessCapabilityMap
        mapRows={[]}
        summary={summary}
        provenance={{
          activePerspectiveLabel: "Common Small Business + IT Managed Services",
          archetypeId: "it-managed-services",
          archetypeLabel: "IT Managed Services",
          category: "professional-services",
          projectionStatus: "seed-projected",
          seedCapabilityCount: 27,
          sourcePerspectiveIds: ["common-small-business", "it-managed-services"],
          sources: [
            {
              perspectiveId: "common-small-business",
              label: "Common Small Business",
              source: "DPF baseline informed by APQC-style process families",
            },
            {
              perspectiveId: "it-managed-services",
              label: "IT Managed Services",
              source: "DPF MSP overlay informed by managed services",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Capability perspective")).toBeVisible();
    expect(screen.getByText("Common Small Business + IT Managed Services")).toBeVisible();
    expect(screen.getByText(/IT Managed Services archetype/i)).toBeVisible();
    expect(screen.getByText(/27 projected capabilities/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /perspective/i })).not.toBeInTheDocument();
  });
});

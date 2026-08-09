// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TopologyIntegritySummary } from "./TopologyIntegritySummary";

afterEach(cleanup);

describe("TopologyIntegritySummary", () => {
  it.each(["partial", "stale", "empty"] as const)("renders %s evidence with a recovery action", (state) => {
    render(<TopologyIntegritySummary integrity={{
      state,
      deviceCount: 1,
      physicalLinkCount: state === "empty" ? 0 : 1,
      sources: ["unifi"],
      newestObservedAt: "2026-08-08T20:00:00.000Z",
      message: `${state} evidence`,
    }} />);

    expect(screen.getByText(`Topology evidence: ${state}`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Estate Discovery" }).getAttribute("href")).toBe("/platform/tools/discovery");
  });

  it("shows current evidence without a remediation action", () => {
    render(<TopologyIntegritySummary integrity={{
      state: "current",
      deviceCount: 3,
      physicalLinkCount: 2,
      sources: ["unifi"],
      newestObservedAt: null,
      message: "Current evidence",
    }} />);

    expect(screen.getByText("3 devices / 2 physical links")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Estate Discovery" })).toBeNull();
  });
});

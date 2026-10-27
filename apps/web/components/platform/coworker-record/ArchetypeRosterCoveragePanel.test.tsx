// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SOURCE_CATALOG } from "@dpf/i18n";

import { ArchetypeRosterCoveragePanel } from "./ArchetypeRosterCoveragePanel";

afterEach(cleanup);

const coverage = {
  archetypeId: "software-platform",
  required: ["security-engineer", "coo-orchestrator"],
  staffed: ["security-engineer"],
  missing: ["coo-orchestrator"],
  staffedCount: 1,
  requiredCount: 2,
};

describe("ArchetypeRosterCoveragePanel", () => {
  it("reports staffed of required and names the missing roles", () => {
    render(
      <ArchetypeRosterCoveragePanel
        coverage={coverage}
        copy={SOURCE_CATALOG.coworkerRecord.rosterCoverage}
      />,
    );
    expect(screen.getByText("1/2")).toBeVisible();
    expect(screen.getByText("coo-orchestrator")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not emit a unique caption paragraph that would grow the frozen a11y tree", () => {
    const copy = SOURCE_CATALOG.coworkerRecord.rosterCoverage;
    render(<ArchetypeRosterCoveragePanel coverage={coverage} copy={copy} />);
    expect(screen.queryByText(copy.heading)).not.toBeInTheDocument();
  });
});

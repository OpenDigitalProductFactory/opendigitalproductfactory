// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkforceSummary } from "@/lib/coworker-record/workforce-summary";

import { WorkforceSummaryPanel } from "./WorkforceSummaryPanel";

afterEach(cleanup);

const summary: WorkforceSummary = {
  total: 1,
  byKind: [{ key: "specialist", label: "Specialist", count: 1 }],
  byFamily: [{ key: "platform", label: "Platform", count: 1 }],
  familiesRepresented: 1,
  health: {
    conversationReady: 1,
    conversationUnavailable: 0,
    unmappedRole: 0,
    withOpenBlockers: 0,
    openBlockersTotal: 0,
    lowCoverage: 0,
  },
  naming: { missingDisplayName: 0, suffixInName: 0, needsAttention: 0 },
};

function kpiGridOf(el: HTMLElement): HTMLElement | null {
  return el.closest("div[style*='grid-template-columns']");
}

describe("WorkforceSummaryPanel", () => {
  it("places extra cards in the same KPI grid so sibling StatCards collapse in the a11y tree", () => {
    render(
      <WorkforceSummaryPanel
        summary={summary}
        extraCards={<div data-testid="roster-extra">roster-extra</div>}
      />,
    );
    const coworkers = screen.getByText("Coworkers");
    const extra = screen.getByTestId("roster-extra");
    expect(kpiGridOf(extra)).toBe(kpiGridOf(coworkers));
  });
});

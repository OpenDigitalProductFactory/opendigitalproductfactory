import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OwnerChangeView } from "@/lib/build/owner-change-view";
import { OwnerChangeProofPanel } from "./OwnerChangeProofPanel";

const view: OwnerChangeView = {
  changeId: "FB-CHANGE-A",
  title: "Make booking changes easier",
  outcome: "Customers can change a booking without calling.",
  now: "Checking the work",
  next: "Review proof before release.",
  health: "ready",
  brief: null,
  proof: {
    requestedOutcome: "Customers can change a booking without calling.",
    whatChanged: "Added self-service booking changes.",
    checks: [
      { key: "acceptance", label: "Outcome checks", state: "passed", summary: "1 outcome check passed.", observedAt: null },
      { key: "automated", label: "Automated checks", state: "stale", summary: "The Change was updated after these checks ran.", observedAt: "2026-07-30T12:00:00.000Z" },
      { key: "ux", label: "Experience review", state: "not-recorded", summary: "No completed experience-review result is recorded.", observedAt: null },
    ],
    openRisks: [],
  },
  pendingDecisionId: null,
  preview: { available: true, drivingThisChange: true },
  technicalDetailsAvailable: true,
};

describe("OwnerChangeProofPanel", () => {
  it("renders owner-readable preview and all proof states through report-kit", () => {
    const html = renderToStaticMarkup(
      <OwnerChangeProofPanel
        view={view}
        previewUrl="http://localhost:3035"
        onOpenBrief={vi.fn()}
        onOpenProof={vi.fn()}
      />,
    );

    expect(html).toContain("See what changed and what has been checked");
    expect(html).toContain("Open live preview");
    expect(html).toContain('data-intent="success"');
    expect(html).toContain('data-intent="warning"');
    expect(html).toContain("Not recorded");
    expect(html).not.toContain("FB-CHANGE-A");
  });
});

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProposalHistoryClient } from "./ProposalHistoryClient";
import type { ProposalRow } from "@/lib/proposal-data";

function row(proposalId: string, status: string): ProposalRow {
  return {
    proposalId,
    agentId: "AGT-100",
    actionType: "run_discovery_triage",
    parameters: {},
    status,
    proposedAt: "2026-10-01T00:00:00.000Z",
    decidedAt: status === "proposed" ? null : "2026-10-09T00:00:00.000Z",
    decidedByEmail: null,
    executedAt: null,
    resultEntityId: null,
    resultError: null,
  };
}

afterEach(cleanup);

// Characterisation: an "expired" legacy proposal falls through to the muted
// fallback colour and shows its status text, so Action History needs no change.
describe("ProposalHistoryClient (BI-753D69A9)", () => {
  it("renders an expired legacy proposal with the muted status colour, not the pending accent", () => {
    render(<ProposalHistoryClient proposals={[row("AP-1", "expired"), row("AP-2", "proposed")]} />);
    const badge = screen.getByText("expired");
    expect(badge.getAttribute("style")).toContain("var(--dpf-muted)");
    expect(screen.getByText("proposed").getAttribute("style")).toContain("var(--dpf-accent)");
  });
});

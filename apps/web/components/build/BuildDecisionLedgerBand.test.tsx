import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildDecisionLedgerBand } from "./BuildDecisionLedgerBand";
import type { BuildDecisionLedgerEntry } from "@/lib/build/decision-ledger";

// BI-EC934FC6 — Band 3 component render checks. renderToStaticMarkup (node env)
// per the report-kit testing convention; catches render-time regressions
// (e.g. StatusBadge usage) without a DOM.

function entry(over: Partial<BuildDecisionLedgerEntry> = {}): BuildDecisionLedgerEntry {
  return {
    id: "e1",
    phase: "plan",
    source: "kernel",
    theCall: "Keep this as one build",
    theOptions: ["Keep as one", "Split into three"],
    theWhy: "Small enough to ship safely in one go.",
    governance: true,
    unresolvedRisks: [],
    ...over,
  };
}

describe("BuildDecisionLedgerBand", () => {
  it("renders the heading and an honest empty state when there are no entries", () => {
    const html = renderToStaticMarkup(<BuildDecisionLedgerBand entries={[]} />);
    expect(html).toContain("AI Coworker decision");
    expect(html).toContain("No build decision is waiting on you");
  });

  it("summarizes the latest decision for the operator without dumping review prose", () => {
    const html = renderToStaticMarkup(
      <BuildDecisionLedgerBand entries={[entry({ unresolvedRisks: ["Coupon stacking unresolved"] })]} />,
    );
    expect(html).toContain("AI Coworker decision");
    expect(html).toContain("Current call: Keep this as one build");
    expect(html).toContain("Why: Small enough to ship safely in one go.");
    expect(html).toContain("Governed");
    expect(html).toContain("AI Coworker is carrying 1 technical concern");
    expect(html).not.toContain("Weighed:");
    expect(html).not.toContain("Coupon stacking unresolved");
  });

  it("renders an entry's call, weighed options, why, governance tag, and open risks in engineer view", () => {
    const html = renderToStaticMarkup(
      <BuildDecisionLedgerBand
        entries={[entry({ unresolvedRisks: ["Coupon stacking unresolved"] })]}
        engineerView
      />,
    );
    expect(html).toContain("The decisions we made");
    expect(html).toContain("Keep this as one build");
    expect(html).toContain("Keep as one vs Split into three");
    expect(html).toContain("Small enough to ship safely in one go.");
    expect(html).toContain("Governance");
    expect(html).toContain("Coupon stacking unresolved");
  });

  it("omits the options line and governance tag for a plain deliberation entry", () => {
    const html = renderToStaticMarkup(
      <BuildDecisionLedgerBand
        entries={[
          entry({
            id: "e2",
            source: "deliberation",
            theCall: "Accepted the plan after peer review",
            theOptions: [],
            governance: false,
          }),
        ]}
        engineerView
      />,
    );
    expect(html).toContain("Accepted the plan after peer review");
    expect(html).not.toContain("Weighed:");
    expect(html).not.toContain("Governance");
  });
});

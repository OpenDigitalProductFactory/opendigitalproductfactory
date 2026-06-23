import { describe, it, expect } from "vitest";
import {
  projectDecisionLedger,
  type DecisionInteractionInput,
} from "./decision-ledger";
import type {
  BuildDeliberationSummary,
  BuildDeliberationSummaryEntry,
} from "@/lib/feature-build-types";

// BI-EC934FC6 — Band 3 of the Build Studio overseer "Solution & Oversight"
// layer. These assert the PURE projector that unifies the two existing decision
// sources (deliberationSummary + DecisionInteraction) into one plain shape.
// Spec: docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md.

function delibEntry(
  over: Partial<BuildDeliberationSummaryEntry> = {},
): BuildDeliberationSummaryEntry {
  return {
    patternSlug: "review",
    deliberationRunId: "dr-1",
    consensusState: "consensus",
    rationaleSummary: "Because the scope was small enough.",
    evidenceQuality: "source-backed",
    unresolvedRisks: [],
    diversityLabel: "3 perspectives",
    ...over,
  };
}

function kernel(over: Partial<DecisionInteractionInput> = {}): DecisionInteractionInput {
  return {
    interactionId: "di-1",
    phaseFrom: "plan",
    phaseTo: "build",
    question: "Keep this as one build or split it?",
    options: ["Keep as one", "Split into three"],
    rationale: "Small enough to ship safely in one go.",
    principleConflict: false,
    createdAt: new Date("2026-06-23T00:00:00Z"),
    ...over,
  };
}

describe("projectDecisionLedger", () => {
  it("returns [] for no sources (honest empty state)", () => {
    expect(projectDecisionLedger(null, [])).toEqual([]);
    expect(projectDecisionLedger({}, [])).toEqual([]);
  });

  it("projects a deliberation entry into a plain call + why, carrying unresolved risks", () => {
    const summary: BuildDeliberationSummary = {
      plan: delibEntry({ unresolvedRisks: ["Coupon stacking unresolved"] }),
    };
    const ledger = projectDecisionLedger(summary, []);
    expect(ledger).toHaveLength(1);
    const [entry] = ledger;
    expect(entry.source).toBe("deliberation");
    expect(entry.governance).toBe(false);
    expect(entry.phase).toBe("plan");
    expect(entry.theCall).toBe("Accepted the plan after peer review");
    expect(entry.theWhy).toBe("Because the scope was small enough.");
    expect(entry.theOptions).toEqual([]);
    expect(entry.unresolvedRisks).toEqual(["Coupon stacking unresolved"]);
  });

  it("projects a kernel decision with options + a governance tag, phase from phaseTo", () => {
    const ledger = projectDecisionLedger(null, [kernel()]);
    expect(ledger).toHaveLength(1);
    const [entry] = ledger;
    expect(entry.source).toBe("kernel");
    expect(entry.governance).toBe(true);
    expect(entry.phase).toBe("build"); // derived from phaseTo
    expect(entry.theCall).toBe("Keep this as one build or split it?");
    expect(entry.theOptions).toEqual(["Keep as one", "Split into three"]);
    expect(entry.theWhy).toBe("Small enough to ship safely in one go.");
  });

  it("coerces object-shaped and malformed options without throwing", () => {
    const objOpts = projectDecisionLedger(null, [
      kernel({ options: [{ label: "A" }, { name: "B" }, { id: "C" }, { junk: 1 }] }),
    ]);
    expect(objOpts[0].theOptions).toEqual(["A", "B", "C"]);

    const badOpts = projectDecisionLedger(null, [kernel({ options: "not-an-array" })]);
    expect(badOpts[0].theOptions).toEqual([]);
  });

  it("normalizes an unknown kernel phase to plan", () => {
    const ledger = projectDecisionLedger(null, [
      kernel({ phaseFrom: null, phaseTo: "weird" }),
    ]);
    expect(ledger[0].phase).toBe("plan");
  });

  it("orders entries by phase, deliberation before kernel within a phase", () => {
    const summary: BuildDeliberationSummary = {
      ideate: delibEntry({ deliberationRunId: "dr-ide" }),
      review: delibEntry({ deliberationRunId: "dr-rev" }),
    };
    const decisions = [
      kernel({ interactionId: "di-plan", phaseFrom: "plan", phaseTo: "plan" }),
      kernel({ interactionId: "di-build", phaseFrom: "plan", phaseTo: "build" }),
    ];
    const ledger = projectDecisionLedger(summary, decisions);
    expect(ledger.map((e) => `${e.phase}:${e.source}`)).toEqual([
      "ideate:deliberation",
      "plan:kernel",
      "build:kernel",
      "review:deliberation",
    ]);
  });

  it("renders a non-consensus deliberation call honestly", () => {
    const summary: BuildDeliberationSummary = {
      review: delibEntry({ consensusState: "no-consensus", patternSlug: "debate" }),
    };
    const [entry] = projectDecisionLedger(summary, []);
    expect(entry.theCall).toBe("Flagged unresolved concerns in the review debate");
  });
});

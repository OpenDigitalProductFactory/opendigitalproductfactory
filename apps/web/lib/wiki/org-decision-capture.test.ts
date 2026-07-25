import { describe, expect, it } from "vitest";

import {
  buildStandingStancePage,
  deriveStandingTitle,
  validateOrgDecisionCapture,
} from "./org-decision-capture";

describe("validateOrgDecisionCapture", () => {
  it("rejects a missing interaction id and a too-short answer", () => {
    expect(
      validateOrgDecisionCapture({ interactionId: " ", answer: "Restore the account.", makeStanding: false }),
    ).toEqual({ ok: false, error: "Missing decision id." });
    const short = validateOrgDecisionCapture({ interactionId: "DI-1", answer: "ok", makeStanding: false });
    expect(short.ok).toBe(false);
  });

  it("normalizes whitespace and optionality", () => {
    const v = validateOrgDecisionCapture({
      interactionId: " DI-C9F8B475B652 ",
      answer: "  Restore access immediately and waive the lapsed period. ",
      rationale: "  ",
      makeStanding: true,
      standingTitle: "",
    });
    expect(v).toEqual({
      ok: true,
      interactionId: "DI-C9F8B475B652",
      answer: "Restore access immediately and waive the lapsed period.",
      rationale: null,
      makeStanding: true,
      standingTitle: null,
      chosenOptionId: null,
    });
  });
});

describe("deriveStandingTitle", () => {
  it("compacts whitespace and truncates long questions", () => {
    expect(deriveStandingTitle("Should we\n  do X?")).toBe("Should we do X?");
    const long = "A".repeat(120);
    const title = deriveStandingTitle(long);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("buildStandingStancePage", () => {
  it("derives a stable ruling slug, includes question + answer, targets the decision's class", () => {
    const page = buildStandingStancePage({
      interactionId: "DI-C9F8B475B652",
      question:
        "A long-time customer subscription lapsed because of a billing error on our side. Restore and waive?",
      domainClass: "risk-assessment",
      answer: "Restore access immediately and waive the lapsed period — the customer bears no fault.",
      rationale: "We absorb the cost of our own billing errors.",
      standingTitle: null,
    });

    expect(page.slug).toBe("stances/ruling-di-c9f8b475b652");
    expect(page.domainClasses).toEqual(["risk-assessment"]);
    expect(page.body).toContain("Our standing answer: Restore access immediately");
    expect(page.body).toContain("Why: We absorb the cost");
    expect(page.body).toContain("DI-C9F8B475B652");
    expect(page.abstract).toMatch(/^Restore access/);
    expect(page.title.length).toBeLessThanOrEqual(80);
  });

  it("honors an explicit standing title", () => {
    const page = buildStandingStancePage({
      interactionId: "DI-1",
      question: "Q?",
      domainClass: "plan-readiness",
      answer: "Split capacity between quality and the new offering.",
      rationale: null,
      standingTitle: "Quality first, growth in parallel",
    });
    expect(page.title).toBe("Quality first, growth in parallel");
    expect(page.body).not.toContain("Why:");
  });
});

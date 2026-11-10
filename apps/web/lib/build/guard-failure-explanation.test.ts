import { describe, expect, it } from "vitest";

import { explainGauntletFailure, explainGuardFailure } from "./guard-failure-explanation";

describe("explainGuardFailure", () => {
  it("routes a decision gate to the person who asked for the change", () => {
    // These ask about INTENT — does this change what users see, does it touch
    // stored data — and the requester is the best-placed person to answer.
    const explanation = explainGuardFailure("Data-Impact Gate");
    expect(explanation.remedy).toBe("self-serve");
    expect(explanation.recognized).toBe(true);
    expect(explanation.what).toContain("stored information");
  });

  it("routes a code-shape guard to a maintainer, with a specific reason", () => {
    const explanation = explainGuardFailure("Module Size Guard");
    expect(explanation.remedy).toBe("maintainer");
    expect(explanation.recognized).toBe(true);
    expect(explanation.what).toContain("already too large");
    expect(explanation.what).not.toContain("ratchet");
  });

  it("speaks plainly: no script names, ids or shell commands reach the reader", () => {
    for (const guard of [
      "Data-Impact Gate",
      "Module Size Guard",
      "Docs Impact Gate",
      "Seed Contribution Fit Gate",
      "UX Primitive Adoption Guard",
    ]) {
      const { what, nextAction } = explainGuardFailure(guard);
      const text = `${what} ${nextAction}`;
      expect(text, guard).not.toMatch(/\.mjs|\.ts\b|node scripts|pnpm |--update|BI-[0-9A-F]{8}/);
    }
  });

  it("degrades honestly for a guard it does not know", () => {
    // A confidently wrong translation is worse than the raw text, because the
    // raw text at least signals "this is for someone else".
    const explanation = explainGuardFailure("Some Guard Added Next Month");
    expect(explanation.recognized).toBe(false);
    expect(explanation.remedy).toBe("maintainer");
    expect(explanation.what).toContain("not one of the checks");
    expect(explanation.nextAction).toContain("maintainer");
  });

  it("defaults an unknown guard to maintainer, never to self-serve", () => {
    // Telling someone a problem is theirs to fix when it is not costs them an
    // hour before they find out, so the cautious default is the correct one.
    expect(explainGuardFailure("Unheard Of Guard").remedy).toBe("maintainer");
  });

  it("tolerates surrounding whitespace in the reported name", () => {
    expect(explainGuardFailure("  Module Size Guard  ").recognized).toBe(true);
  });
});

describe("explainGauntletFailure", () => {
  const RAW = "[pregate-preflight] 1 guard(s) FAILED\n  - Module Size Guard: node scripts/check-module-size.mjs";

  it("keeps the raw output verbatim", () => {
    // Translation fronts the evidence; it never replaces it.
    const briefing = explainGauntletFailure({ failedGuards: ["Module Size Guard"], output: RAW });
    expect(briefing.rawOutput).toBe(RAW);
  });

  it("leads with what the reader can do when everything is theirs", () => {
    const briefing = explainGauntletFailure({
      failedGuards: ["Data-Impact Gate", "Docs Impact Gate"],
      output: RAW,
    });
    expect(briefing.anySelfServe).toBe(true);
    expect(briefing.needsMaintainer).toBe(false);
    expect(briefing.headline).toContain("need an answer from you");
  });

  it("says plainly when nothing is the reader's to fix", () => {
    // A clean handoff is a good outcome, not a failure of the feature.
    const briefing = explainGauntletFailure({
      failedGuards: ["Module Size Guard", "Prose Lint Guard"],
      output: RAW,
    });
    expect(briefing.anySelfServe).toBe(false);
    expect(briefing.needsMaintainer).toBe(true);
    expect(briefing.headline).toContain("Nothing here is yours to fix");
  });

  it("distinguishes a mixed set rather than flattening it", () => {
    const briefing = explainGauntletFailure({
      failedGuards: ["Data-Impact Gate", "Module Size Guard"],
      output: RAW,
    });
    expect(briefing.anySelfServe).toBe(true);
    expect(briefing.needsMaintainer).toBe(true);
    expect(briefing.headline).toContain("Some need an answer from you");
  });

  it("never invents a guard when none was named", () => {
    const briefing = explainGauntletFailure({ failedGuards: [], output: "Error: Cannot find module" });
    expect(briefing.explanations).toEqual([]);
    expect(briefing.headline).toContain("did not say which check refused");
    expect(briefing.rawOutput).toBe("Error: Cannot find module");
  });

  it("explains every guard it is given", () => {
    const guards = ["Data-Impact Gate", "Module Size Guard", "Totally Unknown"];
    const briefing = explainGauntletFailure({ failedGuards: guards, output: RAW });
    expect(briefing.explanations.map((entry) => entry.guard)).toEqual(guards);
  });
});

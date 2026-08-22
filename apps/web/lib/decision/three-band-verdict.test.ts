import { describe, expect, it } from "vitest";

import {
  decide,
  resolveDecisionBands,
  resolveVerdict,
  verdictConfidence,
  VERDICT_RETRY_HINTS,
  type DecisionBands,
  type DecisionOption,
  type DecisionPrinciple,
} from "./option-scoring";
import { mapConsultOutcome } from "./kernel-consult-ledger";

const bands = (over: Partial<DecisionBands> = {}): DecisionBands => ({
  upper: 0.2,
  lower: -0.2,
  stakes: "elevated",
  ...over,
});

const principle = (over: Partial<DecisionPrinciple> = {}): DecisionPrinciple => ({
  id: "p1",
  name: "speed",
  tier: "principle",
  weight: 1,
  dimensionVector: { speed_to_value: 1 },
  ...over,
});

const option = (id: string, features: Record<string, number>): DecisionOption => ({
  id,
  description: `option ${id}`,
  features,
});

describe("BI-2107B5D2 — three-band verdict", () => {
  it("widens the uncertain band from both sides as stakes rise", () => {
    const routine = resolveDecisionBands(0.2, "routine");
    const elevated = resolveDecisionBands(0.2, "elevated");
    const high = resolveDecisionBands(0.2, "high");

    // Higher stakes demand MORE separation before proceeding...
    expect(high.upper).toBeGreaterThan(elevated.upper);
    expect(elevated.upper).toBeGreaterThan(routine.upper);
    // ...and LESS opposition before declining. Both edges move outward.
    expect(high.lower).toBeGreaterThan(elevated.lower);
    expect(elevated.lower).toBeGreaterThan(routine.lower);
  });

  it("treats a commandment conflict as a decline with a named cause, not an uncertainty", () => {
    expect(resolveVerdict({
      margin: 0.9,
      winnerComposite: 0.8,
      bands: bands(),
      commandmentConflict: true,
      featureCoverageWeak: false,
      sensitivityUnstable: false,
    })).toEqual({ verdict: "decline", verdictCause: "commandment-conflict" });
  });

  it("treats every option being opposed as a decline, not a failure to choose", () => {
    expect(resolveVerdict({
      margin: 0.9,
      winnerComposite: -0.5,
      bands: bands(),
      commandmentConflict: false,
      featureCoverageWeak: false,
      sensitivityUnstable: false,
    })).toEqual({ verdict: "decline", verdictCause: "all-options-opposed" });
  });

  it("keeps a low margin distinct from both assurances", () => {
    expect(resolveVerdict({
      margin: 0.05,
      winnerComposite: 0.5,
      bands: bands(),
      commandmentConflict: false,
      featureCoverageWeak: false,
      sensitivityUnstable: false,
    })).toEqual({ verdict: "uncertain", verdictCause: "low-margin" });
  });

  it("proceeds on a clear winner with no blockers", () => {
    expect(resolveVerdict({
      margin: 0.5,
      winnerComposite: 0.7,
      bands: bands(),
      commandmentConflict: false,
      featureCoverageWeak: false,
      sensitivityUnstable: false,
    })).toEqual({ verdict: "proceed", verdictCause: null });
  });

  it("computes confidence from the real margin, with assurances at or above the band edge", () => {
    const atEdge = verdictConfidence({
      optionId: "a", composite: 0.5, margin: 0.2, confidence: "high",
      verdict: "proceed", verdictCause: null, bands: bands(),
    });
    const wellClear = verdictConfidence({
      optionId: "a", composite: 0.5, margin: 0.6, confidence: "high",
      verdict: "proceed", verdictCause: null, bands: bands(),
    });
    const uncertain = verdictConfidence({
      optionId: "a", composite: 0.5, margin: 0.05, confidence: "low",
      verdict: "uncertain", verdictCause: "low-margin", bands: bands(),
    });

    expect(wellClear).toBeGreaterThan(atEdge);
    expect(atEdge).toBeGreaterThanOrEqual(0.5);
    expect(uncertain).toBeLessThan(0.5);
  });

  it("says what to change for every retryable cause, and refuses to pretend a conflict is retryable", () => {
    expect(VERDICT_RETRY_HINTS["commandment-conflict"]).toBeNull();
    for (const [cause, hint] of Object.entries(VERDICT_RETRY_HINTS)) {
      if (cause === "commandment-conflict") continue;
      expect(hint, `${cause} must name the input to change`).toBeTruthy();
    }
  });

  it("carries the effective band edges on the recommendation so a moved bar is visible later", () => {
    const result = decide(
      [option("a", { speed_to_value: 1, blast_radius: 0.5, cognitive_load: 0.5 }),
       option("b", { speed_to_value: 0, blast_radius: 0.5, cognitive_load: 0.5 })],
      [principle()],
      { stakes: "high" },
    );
    expect(result.recommendation?.bands?.stakes).toBe("high");
    expect(result.recommendation?.bands?.upper).toBeGreaterThan(0.2);
  });
});

describe("BI-2107B5D2 — the ledger records real margins, not constants", () => {
  const principles = [principle()];

  it("records different confidence for a narrow win than for a decisive one", () => {
    const narrow = decide(
      [option("a", { speed_to_value: 0.9, blast_radius: 0.5, cognitive_load: 0.5 }),
       option("b", { speed_to_value: 0.5, blast_radius: 0.5, cognitive_load: 0.5 })],
      principles,
    );
    const decisive = decide(
      [option("a", { speed_to_value: 1, blast_radius: 0.5, cognitive_load: 0.5 }),
       option("b", { speed_to_value: 0, blast_radius: 0.5, cognitive_load: 0.5 })],
      principles,
    );

    // Before this change both of these recorded exactly 0.9, so the margin
    // distribution the bands are tuned against did not exist.
    expect(mapConsultOutcome(narrow).confidenceScore)
      .not.toBe(mapConsultOutcome(decisive).confidenceScore);
  });

  it("never reports a corpus gap without saying what to change", () => {
    const noSignal = decide(
      [
        { id: "a", description: "a", features: {} },
        { id: "b", description: "b", features: {} },
      ],
      principles,
    );
    const outcome = mapConsultOutcome(noSignal);
    if (outcome.verdictCause === "insufficient-signal") {
      expect(outcome.retryHint).toBeTruthy();
      expect(outcome.outcomeType).toBe("escalate");
    }
  });

  it("routes an uncertain verdict to escalate and keeps its cause", () => {
    const narrow = decide(
      [option("a", { speed_to_value: 0.55, blast_radius: 0.5, cognitive_load: 0.5 }),
       option("b", { speed_to_value: 0.5, blast_radius: 0.5, cognitive_load: 0.5 })],
      principles,
    );
    if (narrow.recommendation?.verdict === "uncertain") {
      const outcome = mapConsultOutcome(narrow);
      expect(outcome.outcomeType).toBe("escalate");
      expect(outcome.verdictCause).toBeTruthy();
    }
  });
});

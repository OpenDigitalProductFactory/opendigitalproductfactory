import { describe, expect, it } from "vitest";
import { applyConstitutionalAlignment } from "./constitutional-alignment-application";
import type { AlignmentCorpora } from "./alignment-criteria";
import type { DecisionPerspectiveEvaluationResult } from "./types";

/**
 * BI-9E1E1939. Measured on the customer 0 install: 62 of 63 unresolved WWWD
 * escalations carried the constitutional-ambiguity rationale. The criteria
 * extractor's taxonomy is fixture-shaped, so any question outside it parses as
 * `ambiguous` — and an ambiguous PARSE was being treated as a corpus FINDING,
 * discarding an already-computed, semantically-grounded directional verdict.
 */

const CORPORA: AlignmentCorpora = {
  wwwd: [{
    ref: "wiki:stances/what-markets-and-opportunities-we-pursue-and-decline",
    text: "We build software platforms for software teams. We decline consumer physical retail: we do not sell toasters to fishermen from kiosks in Alaska.",
  }],
  portfolio: [{ ref: "product:dpf", text: "DPF software platform subscription for software teams." }],
  gtm: [{ ref: "wiki:how-we-decide", text: "We reach software teams through MSP partner channel subscriptions." }],
};

function evaluation(
  over: Partial<DecisionPerspectiveEvaluationResult> = {},
): DecisionPerspectiveEvaluationResult {
  return {
    outcomeType: "recommend",
    rationale: "Recommend APPROVING: your recorded stance supports this decision at confidence 0.75.",
    stanceAlignment: "approve",
    alignmentScore: 1,
    confidenceScore: 0.75,
    ...over,
  } as unknown as DecisionPerspectiveEvaluationResult;
}

describe("applyConstitutionalAlignment", () => {
  it("abstains when criteria are ambiguous, leaving the measured directional verdict intact", () => {
    // The live repro: a field-service privacy question. It carries none of the
    // extractor's fixture vocabulary, so criteria parse as ambiguous.
    const result = evaluation();
    applyConstitutionalAlignment({
      evaluation: result,
      question:
        "For field-service employee mobile features, under what conditions should the app collect and share an employee's location?",
      corpora: CORPORA,
    });

    expect(result.constitutionalAlignment?.criteria.status).toBe("ambiguous");
    // Abstain: the verdict the coverage path actually measured survives.
    expect(result.outcomeType).toBe("recommend");
    expect(result.stanceAlignment).toBe("approve");
    expect(result.alignmentScore).toBe(1);
    expect(result.rationale).toContain("Recommend APPROVING");
  });

  it("never reports stanceAlignment none when the coverage path measured one", () => {
    const result = evaluation();
    applyConstitutionalAlignment({
      evaluation: result,
      question: "What lawful basis governs employee-location and field data collection across jurisdictions?",
      corpora: CORPORA,
    });
    expect(result.stanceAlignment).not.toBe("none");
  });

  it("still vetoes an explicit corpus boundary (no regression of the off-mission decline)", () => {
    const result = evaluation();
    applyConstitutionalAlignment({
      evaluation: result,
      question:
        "Should we pursue selling toasters to fishermen from kiosks on the fishing docks in Alaska?",
      corpora: CORPORA,
    });

    expect(result.outcomeType).toBe("recommend");
    expect(result.stanceAlignment).toBe("decline");
    expect(result.alignmentScore).toBe(-1);
    expect(result.rationale).toContain("Recommend DECLINING");
  });

  it("records the alignment result for audit even when it abstains", () => {
    const result = evaluation();
    applyConstitutionalAlignment({
      evaluation: result,
      question: "run hive scout ingest: ",
      corpora: CORPORA,
    });
    expect(result.constitutionalAlignment).toBeDefined();
    expect(result.constitutionalAlignment?.verdict).toBe("escalate");
    expect(result.outcomeType).toBe("recommend");
  });
});

import { describe, expect, it } from "vitest";

import {
  buildBranchTurn,
  isAbstention,
  parseBranchPosition,
} from "./branch-execution";

describe("parseBranchPosition", () => {
  it("reads the contracted shape", () => {
    const p = parseBranchPosition(
      "RECOMMENDATION: fund now\nRATIONALE: The prerequisite blocks three funded rooms.",
    );
    expect(p.recommendation).toBe("fund now");
    expect(p.rationale).toBe("The prerequisite blocks three funded rooms.");
  });

  it("is case- and whitespace-tolerant about the labels", () => {
    const p = parseBranchPosition("  recommendation:   defer \n  rationale:  No owner yet. ");
    expect(p.recommendation).toBe("defer");
    expect(p.rationale).toBe("No owner yet.");
  });

  it("keeps a multi-line rationale whole", () => {
    const p = parseBranchPosition(
      "RECOMMENDATION: defer\nRATIONALE: First reason.\nSecond reason on its own line.",
    );
    expect(p.rationale).toContain("First reason.");
    expect(p.rationale).toContain("Second reason");
  });

  it("falls back to the first line when the model ignores the shape", () => {
    // A real answer must not be discarded over a formatting miss.
    const p = parseBranchPosition("Fund it now.\nThe dependency is already paid for.");
    expect(p.recommendation).toBe("Fund it now.");
    expect(p.rationale).toBe("The dependency is already paid for.");
  });

  it("reports nothing for an empty reply rather than inventing a position", () => {
    expect(parseBranchPosition("").recommendation).toBeNull();
    expect(parseBranchPosition("   \n  ").recommendation).toBeNull();
  });

  it("preserves the raw reply for audit", () => {
    const raw = "RECOMMENDATION: fund now\nRATIONALE: because.";
    expect(parseBranchPosition(raw).raw).toBe(raw);
  });
});

describe("isAbstention", () => {
  it("treats an explicit insufficient-evidence answer as no verdict", () => {
    expect(isAbstention(parseBranchPosition("RECOMMENDATION: insufficient evidence"))).toBe(true);
  });

  it("treats a real recommendation as a verdict", () => {
    expect(isAbstention(parseBranchPosition("RECOMMENDATION: fund now"))).toBe(false);
  });

  it("treats an empty reply as an abstention", () => {
    expect(isAbstention(parseBranchPosition(""))).toBe(true);
  });
});

describe("buildBranchTurn", () => {
  it("puts the brief in front of the branch", () => {
    const turn = buildBranchTurn({
      role: "debater",
      brief: "Should we fund the owner-appointment writer?",
      subject: "funding call",
    });
    expect(turn.messages[0].content).toContain("Should we fund");
    expect(turn.messages[0].content).toContain("funding call");
  });

  it("says so plainly when there is no brief, instead of inventing a subject", () => {
    const turn = buildBranchTurn({ role: "skeptic" });
    expect(turn.messages[0].content).toContain("No brief was supplied");
  });

  it("carries the role persona and the answer contract in the system prompt", () => {
    const turn = buildBranchTurn({ role: "skeptic", persona: "You are the skeptic." });
    expect(turn.systemPrompt).toContain("You are the skeptic.");
    expect(turn.systemPrompt).toContain("RECOMMENDATION:");
  });

  it("falls back to a role-derived persona when none is seeded", () => {
    const turn = buildBranchTurn({ role: "debater" });
    expect(turn.systemPrompt).toContain("debater");
  });
});

describe("parseBranchPosition — caller-supplied JSON contracts", () => {
  const envelope = [
    "```json",
    '{"recommendedAction":"adopt_option","draft":{"optionId":"defer"},',
    '"summary":"The owner is asked to keep this as engineering hygiene."}',
    "```",
  ].join("\n");

  it("keeps a fenced JSON envelope whole instead of taking the fence line", () => {
    // Regression: the first-line fallback returned "```json" as the panel's
    // verdict, which the caller's parser could not read.
    const p = parseBranchPosition(envelope);
    expect(p.recommendation).not.toBe("```json");
    expect(p.recommendation).toContain("recommendedAction");
    expect(() => JSON.parse(p.recommendation!)).not.toThrow();
  });

  it("surfaces the envelope's summary as the rationale", () => {
    expect(parseBranchPosition(envelope).rationale).toContain("engineering hygiene");
  });

  it("handles an unfenced JSON object", () => {
    const p = parseBranchPosition('{"recommendedAction":"no_change"}');
    expect(p.recommendation).toContain("no_change");
  });

  it("keeps unparseable JSON whole rather than shredding it", () => {
    const p = parseBranchPosition('```json\n{"recommendedAction": "adopt_o\n```');
    expect(p.recommendation).toContain("recommendedAction");
    expect(p.rationale).toBeNull();
  });

  it("still prefers the line contract when the model uses it", () => {
    const p = parseBranchPosition("RECOMMENDATION: fund now\nRATIONALE: because.");
    expect(p.recommendation).toBe("fund now");
  });
});

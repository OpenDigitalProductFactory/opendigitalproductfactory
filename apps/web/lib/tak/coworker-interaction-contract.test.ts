import { describe, expect, it } from "vitest";
import {
  COWORKER_INTERACTION_CONTRACT_HEADING,
  formatCoworkerOperationalCloseout,
  withCoworkerInteractionContract,
} from "./coworker-interaction-contract";

describe("coworker interaction contract", () => {
  it("appends the contract to prompts once", () => {
    const prompt = withCoworkerInteractionContract("Base prompt");
    const twice = withCoworkerInteractionContract(prompt);

    expect(prompt).toContain("Base prompt");
    expect(prompt).toContain(COWORKER_INTERACTION_CONTRACT_HEADING);
    expect(prompt).toContain("Status:");
    expect(prompt).toContain("Evidence:");
    expect(prompt).toContain("Next action:");
    expect(prompt).toContain("Owner:");
    expect(twice.match(new RegExp(COWORKER_INTERACTION_CONTRACT_HEADING, "g"))).toHaveLength(1);
  });

  it("carries the clarify-vs-proceed / ask-less discipline (BI-0806FFF5)", () => {
    const prompt = withCoworkerInteractionContract("Base prompt");
    expect(prompt).toContain("Clarify vs proceed");
    // Ask-less: prefer a stated assumption; at most one focused question.
    expect(prompt).toMatch(/at most ONE focused question/i);
    expect(prompt).toMatch(/reasonable assumption/i);
    // Act on your own recommendation instead of handing back a menu.
    expect(prompt).toMatch(/Act on your own recommendation/i);
  });

  it("instructs the coworker to offer button decisions via the dpf-decision sentinel", () => {
    const prompt = withCoworkerInteractionContract("Base prompt");
    expect(prompt).toContain("BUTTON DECISIONS");
    expect(prompt).toContain("dpf-decision");
    // The degenerate proceed-case must map to a single recommended "Go" button.
    expect(prompt).toContain('"label":"Go"');
    expect(prompt).toContain('"recommended":true');
  });

  it("formats deterministic closeouts with the required four fields", () => {
    expect(formatCoworkerOperationalCloseout({
      status: "ready for PR",
      evidence: "typecheck and scoped tests passed on branch feat/example",
      nextAction: "open the governed PR",
      owner: "agent",
    })).toBe([
      "Status: ready for PR",
      "Evidence: typecheck and scoped tests passed on branch feat/example",
      "Next action: open the governed PR",
      "Owner: agent",
    ].join("\n"));
  });
});

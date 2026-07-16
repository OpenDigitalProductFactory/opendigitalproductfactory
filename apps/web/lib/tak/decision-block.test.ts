import { describe, it, expect } from "vitest";
import {
  parseDecisionFromContent,
  normalizeDecision,
  formatDecisionSentinel,
  MAX_DECISION_OPTIONS,
  type CoworkerDecision,
} from "./decision-block";

describe("parseDecisionFromContent", () => {
  it("returns no decision for plain content", () => {
    const { cleanedContent, decision } = parseDecisionFromContent("Just a normal reply.");
    expect(decision).toBeNull();
    expect(cleanedContent).toBe("Just a normal reply.");
  });

  it("extracts a degenerate single Go decision and strips the sentinel", () => {
    const content =
      'All set — ready to start.\n<!--dpf-decision:{"options":[{"label":"Go","recommended":true}]}-->';
    const { cleanedContent, decision } = parseDecisionFromContent(content);
    expect(cleanedContent).toBe("All set — ready to start.");
    expect(decision).not.toBeNull();
    expect(decision!.options).toHaveLength(1);
    expect(decision!.options[0]).toMatchObject({
      label: "Go",
      value: "Go",
      kind: "answer",
      recommended: true,
    });
    expect(decision!.options[0]!.id).toBeTruthy();
    expect(decision!.freeTextAllowed).toBe(true);
  });

  it("extracts a multi-option decision with prompt and preserves order", () => {
    const content = [
      "Here is where we stand.",
      formatDecisionSentinel({
        prompt: "Where should I start?",
        freeTextAllowed: true,
        options: [
          { id: "render", label: "Fix the render first", value: "Fix the render first", kind: "approve", recommended: true },
          { id: "cli", label: "Prioritize the CLI saturation", value: "Prioritize the CLI saturation", kind: "answer" },
        ],
      }),
    ].join("\n");
    const { cleanedContent, decision } = parseDecisionFromContent(content);
    expect(cleanedContent).toBe("Here is where we stand.");
    expect(decision!.prompt).toBe("Where should I start?");
    expect(decision!.options.map((o) => o.label)).toEqual([
      "Fix the render first",
      "Prioritize the CLI saturation",
    ]);
    expect(decision!.options[0]!.recommended).toBe(true);
    expect(decision!.options[1]!.recommended).toBeUndefined();
  });

  it("strips a malformed sentinel and degrades to prose (no raw marker leaks)", () => {
    const content = 'Proceeding.\n<!--dpf-decision:{not valid json}-->';
    const { cleanedContent, decision } = parseDecisionFromContent(content);
    expect(decision).toBeNull();
    expect(cleanedContent).toBe("Proceeding.");
    expect(cleanedContent).not.toContain("dpf-decision");
  });

  it("round-trips via formatDecisionSentinel", () => {
    const decision: CoworkerDecision = {
      prompt: "Ship it?",
      freeTextAllowed: true,
      options: [
        { id: "ship-0", label: "Ship", value: "Ship", kind: "approve", recommended: true },
        { id: "hold-1", label: "Hold", value: "Hold", kind: "reject" },
      ],
    };
    const content = `Done.\n${formatDecisionSentinel(decision)}`;
    const parsed = parseDecisionFromContent(content).decision;
    expect(parsed).toEqual(decision);
  });
});

describe("normalizeDecision", () => {
  it("rejects input with no valid options", () => {
    expect(normalizeDecision({ options: [] })).toBeNull();
    expect(normalizeDecision({ options: [{ label: "" }] })).toBeNull();
    expect(normalizeDecision({ options: "nope" })).toBeNull();
    expect(normalizeDecision(null)).toBeNull();
    expect(normalizeDecision(42)).toBeNull();
  });

  it("defaults value to label and kind to answer", () => {
    const decision = normalizeDecision({ options: [{ label: "Continue" }] })!;
    expect(decision.options[0]).toMatchObject({ label: "Continue", value: "Continue", kind: "answer" });
  });

  it("keeps only the first recommended option as primary", () => {
    const decision = normalizeDecision({
      options: [
        { label: "A", recommended: true },
        { label: "B", recommended: true },
      ],
    })!;
    expect(decision.options[0]!.recommended).toBe(true);
    expect(decision.options[1]!.recommended).toBeUndefined();
  });

  it("dedupes options by label (case-insensitive)", () => {
    const decision = normalizeDecision({
      options: [{ label: "Go" }, { label: "go" }, { label: "Wait" }],
    })!;
    expect(decision.options.map((o) => o.label)).toEqual(["Go", "Wait"]);
  });

  it("caps options at MAX_DECISION_OPTIONS", () => {
    const many = Array.from({ length: MAX_DECISION_OPTIONS + 4 }, (_, i) => ({ label: `Opt ${i}` }));
    const decision = normalizeDecision({ options: many })!;
    expect(decision.options).toHaveLength(MAX_DECISION_OPTIONS);
  });

  it("rejects an unknown kind by falling back to answer", () => {
    const decision = normalizeDecision({ options: [{ label: "X", kind: "detonate" }] })!;
    expect(decision.options[0]!.kind).toBe("answer");
  });

  it("honors freeTextAllowed=false", () => {
    const decision = normalizeDecision({ options: [{ label: "Only this" }], freeTextAllowed: false })!;
    expect(decision.freeTextAllowed).toBe(false);
  });
});

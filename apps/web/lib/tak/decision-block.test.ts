import { describe, it, expect } from "vitest";
import {
  parseDecisionFromContent,
  normalizeDecision,
  deriveDecisionFromProse,
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

describe("deriveDecisionFromProse (fallback when the model emits no sentinel)", () => {
  it("recovers a two-way choice from the exact live-miss closeout", () => {
    // Observed live: Haiku ended on this with no sentinel and no button rendered.
    const content =
      "Done. The plan is recorded.\n\n**Next action:** Triage the plan into child items, or promote to Build Studio.\n\nWhat's your call — break this into phase-based work items, or move to the next priority?";
    const decision = deriveDecisionFromProse(content)!;
    expect(decision).not.toBeNull();
    expect(decision.options.map((o) => o.value)).toEqual([
      "Break this into phase-based work items",
      "Move to the next priority",
    ]);
    expect(decision.options[0]!.recommended).toBe(true);
    expect(decision.options[1]!.recommended).toBeUndefined();
    expect(decision.freeTextAllowed).toBe(true);
  });

  it("does NOT fire on a noun disjunction (no comma before 'or')", () => {
    // "reliability or incidents" is a list, not a choice — a wrong button here
    // would be worse than none.
    const content =
      "Here is the situation.\n\nWant me to pull the backlog items tagged for reliability or incidents?";
    expect(deriveDecisionFromProse(content)).toBeNull();
  });

  it("does NOT fire when the message does not end in a question", () => {
    expect(deriveDecisionFromProse("I can break this into work items, or move on. Let me know.")).toBeNull();
  });

  it("does NOT fire on a plain statement", () => {
    expect(deriveDecisionFromProse("The plan is attached and ready for review.")).toBeNull();
  });

  it("strips a 'would you like me to' lead-in and keeps clean option clauses", () => {
    const content =
      "Would you like me to check the progress on the two active builds, or list the in-flight coordination tasks?";
    const decision = deriveDecisionFromProse(content)!;
    expect(decision.options.map((o) => o.value)).toEqual([
      "Check the progress on the two active builds",
      "List the in-flight coordination tasks",
    ]);
  });

  it("truncates a long label but keeps the full value for the reply", () => {
    const content =
      "What next — draft a very detailed multi-phase implementation plan covering every rollout step, or defer it?";
    const decision = deriveDecisionFromProse(content)!;
    expect(decision.options[0]!.label.length).toBeLessThanOrEqual(56);
    expect(decision.options[0]!.value.length).toBeGreaterThan(decision.options[0]!.label.length);
  });

  it("parseDecisionFromContent uses the prose fallback when no sentinel is present", () => {
    const content = "Plan done.\n\nWhat's your call — ship it now, or hold for review?";
    const { cleanedContent, decision } = parseDecisionFromContent(content);
    expect(cleanedContent).toBe(content); // prose is NOT stripped
    expect(decision!.options.map((o) => o.value)).toEqual(["Ship it now", "Hold for review"]);
  });

  it("an explicit sentinel still wins over the prose fallback", () => {
    const content =
      'Ready.\n<!--dpf-decision:{"options":[{"label":"Go","recommended":true}]}-->\nProceed with A, or B?';
    const { decision } = parseDecisionFromContent(content);
    expect(decision!.options).toHaveLength(1);
    expect(decision!.options[0]!.label).toBe("Go");
  });
});

describe("deriveDecisionFromProse — long real-world clauses (BI-AE7058FB)", () => {
  // Verbatim closeout observed live on /customer during the EP-UX-AUDITOR portal
  // survey (2026-08-04). The old 90-char clause cap rejected the first option
  // (~117 chars), so a textbook two-option choice produced NO buttons at all.
  const LIVE_CUSTOMER_CLOSEOUT =
    "Based on the customer overview page, the highest-value next step is to review the onboarding journey for your top accounts. " +
    "Would you like me to start by analyzing the onboarding journey for your highest-value accounts to surface the most critical friction points, " +
    "or would you prefer to review the underlying customer data and engagement metrics first?";

  it("recovers both options from the live /customer closeout", () => {
    const decision = deriveDecisionFromProse(LIVE_CUSTOMER_CLOSEOUT);
    expect(decision).not.toBeNull();
    expect(decision!.options).toHaveLength(2);
  });

  it("marks the first option recommended so buttons render recommended-first", () => {
    const decision = deriveDecisionFromProse(LIVE_CUSTOMER_CLOSEOUT)!;
    expect(decision.options[0]!.recommended).toBe(true);
    expect(decision.options[1]!.recommended).toBeUndefined();
  });

  it("strips the repeated lead-in so the second button reads as an imperative", () => {
    const decision = deriveDecisionFromProse(LIVE_CUSTOMER_CLOSEOUT)!;
    expect(decision.options[1]!.value).toMatch(/^Review the underlying customer data/);
    expect(decision.options[1]!.value).not.toMatch(/would you prefer/i);
  });

  it("still truncates the visible label while keeping the full submitted value", () => {
    const decision = deriveDecisionFromProse(LIVE_CUSTOMER_CLOSEOUT)!;
    for (const option of decision.options) {
      expect(option.label.length).toBeLessThanOrEqual(56);
      expect(option.value.length).toBeGreaterThanOrEqual(option.label.length);
    }
  });

  it("still refuses a paragraph-sized clause — the cap bounds runaway prose", () => {
    const runaway = `Should I ${"a".repeat(200)}, or ${"b".repeat(200)}?`;
    expect(deriveDecisionFromProse(runaway)).toBeNull();
  });

  it("still refuses a noun disjunction with no comma", () => {
    expect(
      deriveDecisionFromProse("Should this be tagged for reliability or incidents?"),
    ).toBeNull();
  });
});

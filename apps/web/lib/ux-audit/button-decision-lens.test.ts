import { describe, expect, it } from "vitest";
import {
  evaluateButtonDecision,
  expectedCarrier,
  isDecisionCloseout,
  type ButtonDecisionObservation,
} from "./button-decision-lens";
import { formatDecisionSentinel } from "@/lib/tak/decision-block";

function observation(
  overrides: Partial<ButtonDecisionObservation> = {},
): ButtonDecisionObservation {
  return {
    route: "/workspace",
    panelPresent: true,
    reply: "I can take either path. Shall I break this into work items, or move to the next priority?",
    buttons: [
      { label: "Break this into work items", recommended: true },
      { label: "Move to the next priority", recommended: false },
    ],
    ...overrides,
  };
}

describe("isDecisionCloseout", () => {
  it("recognizes an enumerated comma-or choice", () => {
    expect(
      isDecisionCloseout("Should I break this into work items, or move to the next priority?"),
    ).toBe(true);
  });

  it("recognizes a bare proceed question", () => {
    expect(isDecisionCloseout("That is everything I found. Shall I go ahead?")).toBe(true);
  });

  it("does not fire on a question buried mid-paragraph", () => {
    expect(
      isDecisionCloseout("You asked what changed? Three files moved. I have logged them all."),
    ).toBe(false);
  });

  it("does not fire on empty text", () => {
    expect(isDecisionCloseout("   ")).toBe(false);
  });
});

describe("expectedCarrier", () => {
  it("attributes a valid sentinel", () => {
    const sentinel = formatDecisionSentinel({
      options: [{ id: "go-0", label: "Go", value: "Go", kind: "answer", recommended: true }],
      freeTextAllowed: true,
    });
    expect(expectedCarrier(`Ready when you are.${sentinel}`)).toBe("sentinel");
  });

  it("attributes a prose closeout to the fallback", () => {
    expect(
      expectedCarrier("Should I fix the render first, or prioritize the CLI saturation?"),
    ).toBe("prose-fallback");
  });

  it("attributes plain prose to no carrier", () => {
    expect(expectedCarrier("All three items are now closed.")).toBe("none");
  });
});

describe("evaluateButtonDecision", () => {
  it("passes when recommended-first buttons render", () => {
    expect(evaluateButtonDecision(observation())).toEqual([]);
  });

  it("passes silently when the coworker did not close on a decision", () => {
    const findings = evaluateButtonDecision(
      observation({ reply: "All three items are now closed.", buttons: [] }),
    );
    expect(findings).toEqual([]);
  });

  it("flags a decision closeout that rendered as free text", () => {
    const findings = evaluateButtonDecision(observation({ buttons: [] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("important");
    expect(findings[0]!.issue).toContain("rendered no decision buttons");
  });

  it("flags buttons with no recommended option", () => {
    const findings = evaluateButtonDecision(
      observation({
        buttons: [
          { label: "Break this into work items", recommended: false },
          { label: "Move to the next priority", recommended: false },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("minor");
    expect(findings[0]!.issue).toContain("none is marked recommended");
  });

  it("flags a recommended option that is not first", () => {
    const findings = evaluateButtonDecision(
      observation({
        buttons: [
          { label: "Move to the next priority", recommended: false },
          { label: "Break this into work items", recommended: true },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.issue).toContain("position 2 of 2");
  });

  it("flags an unlabeled button as an accessible-name defect", () => {
    const findings = evaluateButtonDecision(
      observation({
        buttons: [
          { label: "Break this into work items", recommended: true },
          { label: "  ", recommended: false },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("accessibility");
    expect(findings[0]!.wcagRef).toBe("4.1.2 Name, Role, Value");
  });

  it("reports a missing panel as critical and stops", () => {
    const findings = evaluateButtonDecision(observation({ panelPresent: false, buttons: [] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("critical");
    expect(findings[0]!.element).toBe('[data-agent-panel="true"]');
  });

  it("reports an empty reply as a NOT-RUN, never a pass", () => {
    const findings = evaluateButtonDecision(observation({ reply: "", buttons: [] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("critical");
    expect(findings[0]!.issue).toContain("NOT-RUN");
  });
});

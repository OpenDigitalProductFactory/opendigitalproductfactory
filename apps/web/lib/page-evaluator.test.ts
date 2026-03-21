import { describe, expect, it } from "vitest";
import {
  categorizeAxeViolation,
  groupFindingsByCategory,
  type UxFinding,
} from "./page-evaluator";

describe("categorizeAxeViolation", () => {
  it("maps color-contrast to contrast category", () => {
    const finding = categorizeAxeViolation({
      id: "color-contrast",
      impact: "serious",
      description: "Elements must have sufficient color contrast",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.8/color-contrast",
      nodes: [{ html: "<span>text</span>", target: ["span.label"] }],
    });
    expect(finding.category).toBe("contrast");
    expect(finding.severity).toBe("critical");
    expect(finding.wcagRef).toBe("1.4.3 Contrast (Minimum)");
  });

  it("maps missing label to accessibility category", () => {
    const finding = categorizeAxeViolation({
      id: "label",
      impact: "critical",
      description: "Form elements must have labels",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.8/label",
      nodes: [{ html: "<input type='text'>", target: ["input"] }],
    });
    expect(finding.category).toBe("accessibility");
    expect(finding.severity).toBe("critical");
  });

  it("maps button-name to accessibility category", () => {
    const finding = categorizeAxeViolation({
      id: "button-name",
      impact: "critical",
      description: "Buttons must have discernible text",
      helpUrl: "",
      nodes: [{ html: "<button></button>", target: ["button"] }],
    });
    expect(finding.category).toBe("accessibility");
  });
});

describe("groupFindingsByCategory", () => {
  it("groups findings by category", () => {
    const findings: UxFinding[] = [
      { severity: "critical", category: "contrast", element: "span", issue: "Low contrast", recommendation: "Fix it", wcagRef: "1.4.3" },
      { severity: "minor", category: "contrast", element: "p", issue: "Low contrast 2", recommendation: "Fix it 2", wcagRef: "1.4.3" },
      { severity: "critical", category: "accessibility", element: "input", issue: "No label", recommendation: "Add label" },
    ];
    const grouped = groupFindingsByCategory(findings);
    expect(Object.keys(grouped)).toHaveLength(2);
    expect(grouped["contrast"]).toHaveLength(2);
    expect(grouped["accessibility"]).toHaveLength(1);
  });

  it("returns empty object for empty findings", () => {
    const grouped = groupFindingsByCategory([]);
    expect(Object.keys(grouped)).toHaveLength(0);
  });
});

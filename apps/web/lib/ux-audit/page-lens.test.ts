import { describe, expect, it } from "vitest";
import {
  cognitiveLoadFinding,
  normalizeEvaluatePageResult,
  normalizeRawFinding,
  COGNITIVE_LOAD_IMPORTANT_THRESHOLD,
  COGNITIVE_LOAD_MINOR_THRESHOLD,
} from "./page-lens";

describe("normalizeRawFinding", () => {
  it("keeps a well-formed finding intact", () => {
    expect(
      normalizeRawFinding({
        severity: "critical",
        category: "contrast",
        element: "button.primary",
        issue: "Text contrast is 2.1:1",
        recommendation: "Raise to 4.5:1",
        wcagRef: "1.4.3 Contrast (Minimum)",
      }),
    ).toEqual({
      severity: "critical",
      category: "contrast",
      element: "button.primary",
      issue: "Text contrast is 2.1:1",
      recommendation: "Raise to 4.5:1",
      wcagRef: "1.4.3 Contrast (Minimum)",
    });
  });

  it("downgrades an unknown severity/category rather than dropping the finding", () => {
    const finding = normalizeRawFinding({
      severity: "blocker",
      category: "vibes",
      issue: "Something is off",
    });
    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe("minor");
    expect(finding!.category).toBe("accessibility");
    expect(finding!.element).toBe("unknown");
  });

  it("accepts the model's alternate field names", () => {
    const finding = normalizeRawFinding({
      severity: "important",
      category: "focus",
      selector: "a.skip-link",
      description: "No visible focus ring",
      fix: "Add :focus-visible styling",
      wcag: "2.4.7 Focus Visible",
    });
    expect(finding!.element).toBe("a.skip-link");
    expect(finding!.issue).toBe("No visible focus ring");
    expect(finding!.recommendation).toBe("Add :focus-visible styling");
    expect(finding!.wcagRef).toBe("2.4.7 Focus Visible");
  });

  it("rejects a finding with no issue text", () => {
    expect(normalizeRawFinding({ severity: "critical", element: "div" })).toBeNull();
    expect(normalizeRawFinding("not an object")).toBeNull();
    expect(normalizeRawFinding(null)).toBeNull();
  });
});

describe("cognitiveLoadFinding", () => {
  it("stays silent below the minor band", () => {
    expect(cognitiveLoadFinding({ cognitiveLoad: 0.1 })).toBeNull();
    expect(cognitiveLoadFinding(null)).toBeNull();
    expect(cognitiveLoadFinding({ cognitiveLoad: "dense" })).toBeNull();
  });

  it("reports a minor finding inside the minor band", () => {
    const finding = cognitiveLoadFinding({ cognitiveLoad: COGNITIVE_LOAD_MINOR_THRESHOLD });
    expect(finding!.severity).toBe("minor");
    expect(finding!.issue).toContain("0.55");
  });

  it("reports an important finding at the wall-of-cards level", () => {
    const finding = cognitiveLoadFinding({
      cognitiveLoad: COGNITIVE_LOAD_IMPORTANT_THRESHOLD,
      controlCountEstimate: 24,
      reasoning: "Twenty-four competing cards",
    });
    expect(finding!.severity).toBe("important");
    expect(finding!.issue).toContain("~24 visible controls");
    expect(finding!.issue).toContain("Twenty-four competing cards");
  });
});

describe("normalizeEvaluatePageResult", () => {
  it("folds findings and the cognitive-load signal into one list", () => {
    const findings = normalizeEvaluatePageResult({
      findings: [
        { severity: "critical", category: "contrast", issue: "Low contrast" },
        { nonsense: true },
      ],
      visualCognitiveLoad: { cognitiveLoad: 0.8, reasoning: "Dense" },
    });
    expect(findings).toHaveLength(2);
    expect(findings[0]!.issue).toBe("Low contrast");
    expect(findings[1]!.category).toBe("responsive");
  });

  it("returns an empty list for a genuinely clean page", () => {
    expect(normalizeEvaluatePageResult({ findings: [], visualCognitiveLoad: null })).toEqual([]);
    expect(normalizeEvaluatePageResult(null)).toEqual([]);
  });
});

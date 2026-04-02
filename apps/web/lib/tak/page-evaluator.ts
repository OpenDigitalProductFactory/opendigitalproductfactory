// Page evaluation engine — axe-core accessibility auditing + finding categorization.
// Playwright interaction (live page analysis) is handled by the evaluate_page MCP tool.
// This module provides pure functions for finding processing.

export type UxFinding = {
  severity: "critical" | "important" | "minor";
  category: "contrast" | "accessibility" | "focus" | "semantic-html" | "color-only" | "css-compliance" | "responsive";
  element: string;
  issue: string;
  recommendation: string;
  wcagRef?: string;
};

export type PageEvaluation = {
  url: string;
  screenshot: string | null;
  axeViolationCount: number;
  findings: UxFinding[];
};

type AxeNode = { html: string; target: string[] };
type AxeViolation = {
  id: string;
  impact: string | null;
  description: string;
  helpUrl: string;
  nodes: AxeNode[];
};

const WCAG_MAP: Record<string, string> = {
  "color-contrast": "1.4.3 Contrast (Minimum)",
  "color-contrast-enhanced": "1.4.6 Contrast (Enhanced)",
  "label": "1.3.1 Info and Relationships",
  "button-name": "4.1.2 Name, Role, Value",
  "link-name": "4.1.2 Name, Role, Value",
  "image-alt": "1.1.1 Non-text Content",
  "input-image-alt": "1.1.1 Non-text Content",
  "heading-order": "1.3.1 Info and Relationships",
  "document-title": "2.4.2 Page Titled",
  "html-has-lang": "3.1.1 Language of Page",
  "focus-order-semantics": "2.4.3 Focus Order",
  "tabindex": "2.4.3 Focus Order",
};

const CONTRAST_RULES = new Set(["color-contrast", "color-contrast-enhanced"]);
const FOCUS_RULES = new Set(["focus-order-semantics", "tabindex", "focus-visible"]);

function mapImpactToSeverity(impact: string | null): UxFinding["severity"] {
  if (impact === "critical" || impact === "serious") return "critical";
  if (impact === "moderate") return "important";
  return "minor";
}

function mapRuleToCategory(ruleId: string): UxFinding["category"] {
  if (CONTRAST_RULES.has(ruleId)) return "contrast";
  if (FOCUS_RULES.has(ruleId)) return "focus";
  if (ruleId.includes("color-only") || ruleId === "link-in-text-block") return "color-only";
  return "accessibility";
}

export function categorizeAxeViolation(violation: AxeViolation): UxFinding {
  const firstNode = violation.nodes[0];
  const element = firstNode?.target?.join(" > ") ?? firstNode?.html?.slice(0, 80) ?? "unknown";

  return {
    severity: mapImpactToSeverity(violation.impact),
    category: mapRuleToCategory(violation.id),
    element,
    issue: violation.description,
    recommendation: `See ${violation.helpUrl}`,
    wcagRef: WCAG_MAP[violation.id],
  };
}

export function groupFindingsByCategory(
  findings: UxFinding[],
): Record<string, UxFinding[]> {
  const grouped: Record<string, UxFinding[]> = {};
  for (const finding of findings) {
    if (!grouped[finding.category]) grouped[finding.category] = [];
    grouped[finding.category]!.push(finding);
  }
  return grouped;
}

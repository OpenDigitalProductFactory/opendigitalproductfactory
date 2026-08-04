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

/**
 * What a browser-use extraction actually produced (BI-C3768478, extending the
 * BI-1BAA177C NOT-RUN contract).
 *
 * `browse_extract` answers HTTP 200 with `status: "completed"` even when its
 * agent failed every step — the payload is then the repr of an empty history,
 * `AgentHistoryList(all_results=[], all_model_outputs=[])`. Read naively that
 * becomes "0 findings", i.e. a clean page, which is the single most dangerous
 * thing a UX auditor can report. Observed on-machine 2026-08-04: the sidecar's
 * pinned LLM was absent from the model runner, so every extraction returned that
 * empty history and `evaluate_page` announced "Found 0 UX/accessibility issues".
 *
 * A clean page and a run that never happened are different answers. This is the
 * one place that tells them apart.
 */
export type ExtractionOutcome =
  | { kind: "findings"; raw: Array<Record<string, unknown>> }
  | { kind: "not-run"; reason: string };

const EMPTY_AGENT_HISTORY = /AgentHistoryList\(\s*all_results\s*=\s*\[\s*\]/;

export function interpretExtraction(data: unknown): ExtractionOutcome {
  if (data === null || data === undefined) {
    return { kind: "not-run", reason: "the browser agent returned no extraction payload" };
  }

  let value: unknown = data;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return { kind: "not-run", reason: "the browser agent returned an empty extraction payload" };
    }
    if (EMPTY_AGENT_HISTORY.test(text)) {
      return {
        kind: "not-run",
        reason:
          "the browser agent produced no model output (empty AgentHistoryList) — check the sidecar's LLM_MODEL is present on the configured endpoint",
      };
    }
    try {
      value = JSON.parse(text);
    } catch {
      return {
        kind: "not-run",
        reason: `the browser agent returned a non-JSON extraction payload: ${text.slice(0, 160)}`,
      };
    }
  }

  // A findings array is the contract. `[]` is a legitimately clean page.
  if (Array.isArray(value)) {
    return { kind: "findings", raw: value as Array<Record<string, unknown>> };
  }

  if (typeof value === "object" && Array.isArray((value as { findings?: unknown }).findings)) {
    return {
      kind: "findings",
      raw: (value as { findings: Array<Record<string, unknown>> }).findings,
    };
  }

  return {
    kind: "not-run",
    reason: "the browser agent's extraction payload was not a findings array",
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

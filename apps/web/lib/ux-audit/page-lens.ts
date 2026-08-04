// Real page-lens evaluator (EP-UX-AUDITOR Phase 2, BI-C3768478).
//
// Adapts the shipped `evaluate_page` MCP tool — browser-use navigation + AI
// extraction + visual-cognitive-load — into the `PageLensEvaluator` seam the
// Phase-1 orchestrator injects. No browser protocol is re-implemented here: the
// auditor calls the governed tool and normalizes its findings into `UxFinding`.
//
// The load-bearing rule is BI-1BAA177C's NOT-RUN contract: when browser-use
// could not drive the browser, `evaluate_page` returns success:false /
// degraded:true. That is NOT a clean page, so this adapter THROWS — `runSurvey`
// records the route as an error entry with a `concerns` verdict rather than
// reporting a false "zero findings".

import type { UxFinding } from "@/lib/tak/page-evaluator";
import type { PageLensEvaluator } from "@/lib/ux-audit/portal-survey";
import {
  callDpfMcpTool,
  type DpfMcpConfig,
} from "@/lib/ux-audit/dpf-mcp-client";

export type { UxFinding };

const SEVERITIES = new Set<UxFinding["severity"]>(["critical", "important", "minor"]);
const CATEGORIES = new Set<UxFinding["category"]>([
  "contrast",
  "accessibility",
  "focus",
  "semantic-html",
  "color-only",
  "css-compliance",
  "responsive",
]);

// How dense a page may be before the visual-cognitive-load signal is a finding.
// `cognitiveLoad` is the 0..1 scale from lib/decision/visual-cognitive-load.ts.
// Bands are anchored on that module's spike calibration (2026-06-15): a clean
// single-action card scored 0.10, a dense 24-card dashboard 0.75. So 0.55 is
// "denser than a comfortable operator page" (minor) and 0.75 is "at the measured
// wall-of-cards level" (important).
export const COGNITIVE_LOAD_IMPORTANT_THRESHOLD = 0.75;
export const COGNITIVE_LOAD_MINOR_THRESHOLD = 0.55;

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Coerce one raw finding from the AI extraction into a valid `UxFinding`.
 * The extraction is model-produced, so every field is defensively normalized and
 * unknown severities/categories fall back to the conservative end rather than
 * being dropped (a dropped finding is invisible; a downgraded one is still read).
 */
export function normalizeRawFinding(raw: unknown): UxFinding | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;

  const issue = text(rec.issue ?? rec.description, "");
  if (!issue) return null;

  const severity = SEVERITIES.has(rec.severity as UxFinding["severity"])
    ? (rec.severity as UxFinding["severity"])
    : "minor";
  const category = CATEGORIES.has(rec.category as UxFinding["category"])
    ? (rec.category as UxFinding["category"])
    : "accessibility";

  const finding: UxFinding = {
    severity,
    category,
    element: text(rec.element ?? rec.selector, "unknown"),
    issue,
    recommendation: text(rec.recommendation ?? rec.fix, "No recommendation supplied."),
  };
  const wcagRef = text(rec.wcagRef ?? rec.wcag, "");
  if (wcagRef) finding.wcagRef = wcagRef;
  return finding;
}

/** The `visualCognitiveLoad` block as it rides on the evaluate_page payload. */
export type CognitiveLoadPayload = {
  cognitiveLoad?: unknown;
  visualDensity?: unknown;
  controlCountEstimate?: unknown;
  reasoning?: unknown;
};

type EvaluatePageData = {
  findings?: unknown;
  degraded?: boolean;
  reason?: string;
  visualCognitiveLoad?: CognitiveLoadPayload | null;
};

/**
 * Turn a visual-cognitive-load score into a finding. This is the signal the
 * accessibility rules cannot see — a page can be WCAG-clean and still be an
 * unreadable wall (spec §4.4 enterprise density).
 */
export function cognitiveLoadFinding(
  load: CognitiveLoadPayload | null | undefined,
): UxFinding | null {
  const score = typeof load?.cognitiveLoad === "number" ? load.cognitiveLoad : null;
  if (score === null || !Number.isFinite(score)) return null;
  if (score < COGNITIVE_LOAD_MINOR_THRESHOLD) return null;

  const reasoning =
    typeof load?.reasoning === "string" && load.reasoning.trim()
      ? ` — ${load.reasoning.trim()}`
      : "";
  const controls =
    typeof load?.controlCountEstimate === "number" && Number.isFinite(load.controlCountEstimate)
      ? ` (~${load.controlCountEstimate} visible controls)`
      : "";

  return {
    severity: score >= COGNITIVE_LOAD_IMPORTANT_THRESHOLD ? "important" : "minor",
    category: "responsive",
    element: "page",
    issue: `Visual cognitive load measured ${score.toFixed(2)} on a 0-1 scale${controls}${reasoning}`,
    recommendation:
      "Reduce simultaneous demands on the first viewport: group related controls, defer secondary detail behind progressive disclosure, and cut competing emphasis.",
  };
}

/** Normalize a whole `evaluate_page` payload into findings. */
export function normalizeEvaluatePageResult(data: unknown): UxFinding[] {
  const payload = (typeof data === "object" && data !== null ? data : {}) as EvaluatePageData;
  const rawFindings = Array.isArray(payload.findings) ? payload.findings : [];

  const findings: UxFinding[] = [];
  for (const raw of rawFindings) {
    const finding = normalizeRawFinding(raw);
    if (finding) findings.push(finding);
  }

  const load = cognitiveLoadFinding(payload.visualCognitiveLoad);
  if (load) findings.push(load);

  return findings;
}

export type PageLensOptions = {
  config: DpfMcpConfig;
  /** Origin the survey drives, e.g. http://localhost:3000. */
  baseUrl: string;
  timeoutMs?: number;
};

/**
 * Build the injected `PageLensEvaluator`. Throws on a NOT-RUN so the orchestrator
 * reports the route honestly instead of recording a clean page.
 */
export function createPageLensEvaluator(options: PageLensOptions): PageLensEvaluator {
  const origin = options.baseUrl.replace(/\/+$/, "");

  return async function evaluatePageLens(route: string): Promise<UxFinding[]> {
    const url = `${origin}${route}`;
    const result = await callDpfMcpTool(
      options.config,
      "evaluate_page",
      { url },
      { id: `ux-audit-page-${route}`, timeoutMs: options.timeoutMs ?? 240_000 },
    );

    const payload = (typeof result.data === "object" && result.data !== null
      ? result.data
      : {}) as EvaluatePageData & { success?: boolean; error?: string };

    if (result.isError || payload.success === false || payload.degraded === true) {
      const reason = payload.reason ?? payload.error ?? result.text ?? "unknown reason";
      throw new Error(`evaluate_page did NOT RUN for ${route}: ${reason}`);
    }

    return normalizeEvaluatePageResult(payload);
  };
}

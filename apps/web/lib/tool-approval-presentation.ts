// Declarative, fail-closed approval card presentation metadata co-located with
// RegisteredToolDefinition (BI-CF03AA73, DI-CC33A7978BBB).
//
// Deliberately a dependency-free leaf module so apps/web/lib/mcp-tool-types.ts
// can reference it without introducing any import cycle.

import type { ToolConsequence } from "@dpf/validators/gpp/tool-facts";

/**
 * Consequence & reversibility posture shown as one semantic badge on an
 * approval card. Maps 1:1 to STATUS_INTENT.approvalPosture in statusColors.ts.
 */
export type ApprovalPosture =
  | "reversible"
  | "bounded"
  | "outward"
  | "authority"
  | "irreversible"
  | "unverified";

export type ToolApprovalParamLabel = {
  /** Human-readable label shown in the Technical evidence drawer (e.g. "Trigger"). */
  label: string;
  /** Optional map from stringified scalar values to plain human strings. */
  valueLabels?: Readonly<Record<string, string>>;
};

/**
 * Co-located owner-facing presentation metadata for one registered platform tool.
 *
 * Fail-closed rules:
 *  - `allowedParams` lists every parameter key this summary accounts for. Any
 *    captured request carrying an unexpected key outside `allowedParams` is
 *    treated as unverified so material fields are never hidden behind static copy.
 *  - `allowEmptyParams` defaults to false. Only tools whose schema has no
 *    required inputs and safe defaults (such as scheduled triage/sweeps) opt in.
 *  - `reversibility` must never soften a tool's declared `consequence`
 *    (`outward`, `irreversible`, `authority`).
 */
export type ToolApprovalPresentation = {
  /** Plain-language owner question (<= 8 words, e.g. "Run daily inventory triage?"). */
  question: string;
  /** Concrete 1-sentence statement of what happens if authorized. */
  what: string;
  /** Concrete 1-sentence statement of scope, impact, and reversibility. */
  impact: string;
  /** Concise plain-language "Why now" context when no cleaner rationale is recorded. */
  whyDefault?: string;
  /** Optional short note for what declining does (e.g. "Declining skips today's pass."). */
  declineDoes?: string;
  /** Optional plain scope label when no workroom or backlog title applies. */
  scopeLabel?: string;
  /** Declared posture — enforced against ToolDefinition.consequence by invariant tests. */
  reversibility: Exclude<ApprovalPosture, "unverified">;
  /** Exact parameter keys accounted for by this presentation. */
  allowedParams: readonly string[];
  /** Whether an explicitly empty `{}` payload is valid for this presentation. */
  allowEmptyParams?: boolean;
  /** Optional human labels and scalar value formatters for drawer display. */
  paramLabels?: Readonly<Record<string, ToolApprovalParamLabel>>;
};

/**
 * Verify that a presentation's declared posture never contradicts or weakens
 * the tool's authoritative `consequence` declaration.
 */
export function isApprovalPresentationCompatibleWithConsequence(
  presentation: ToolApprovalPresentation,
  consequence: ToolConsequence | null | undefined,
): boolean {
  if (!consequence) return true;
  if (consequence === "irreversible") return presentation.reversibility === "irreversible";
  if (consequence === "outward") {
    return presentation.reversibility === "outward" || presentation.reversibility === "irreversible";
  }
  if (consequence === "authority") {
    return presentation.reversibility === "authority" || presentation.reversibility === "irreversible";
  }
  return false;
}

/**
 * True only when the captured parameters strictly fit the presentation's
 * declared `allowedParams` (and `allowEmptyParams` when `{}`).
 */
export function matchesApprovalPresentationParams(
  presentation: ToolApprovalPresentation,
  params: Record<string, unknown> | null,
  hasEmptyOriginal: boolean,
): boolean {
  if (!params) {
    return hasEmptyOriginal && presentation.allowEmptyParams === true;
  }
  const keys = Object.keys(params);
  if (keys.length === 0) {
    return presentation.allowEmptyParams === true;
  }
  const allowed = new Set(presentation.allowedParams);
  return keys.every((key) => allowed.has(key));
}

/** Format a single parameter key/value using optional presentation labels. */
export function formatPresentationParam(
  presentation: ToolApprovalPresentation | null | undefined,
  key: string,
  value: unknown,
  fallbackLabel: string,
  fallbackValue: string,
): { label: string; value: string } {
  const spec = presentation?.paramLabels?.[key];
  if (!spec) return { label: fallbackLabel, value: fallbackValue };
  const scalarKey =
    typeof value === "string" || typeof value === "boolean" || typeof value === "number"
      ? String(value)
      : null;
  const mapped = scalarKey !== null ? spec.valueLabels?.[scalarKey] : undefined;
  return {
    label: spec.label,
    value: mapped ?? fallbackValue,
  };
}

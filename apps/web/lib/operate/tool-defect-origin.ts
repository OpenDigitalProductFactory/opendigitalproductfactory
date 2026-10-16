// BI-891E4E11 — one backlog origin per broken tool.
//
// The work-pattern observer keys a repeated tool failure per coworker and
// route, which is right for coworker-scoped evidence. Projected into the
// backlog unchanged, it filed one item per coworker (capability need) and one
// per agent+route signal (improvement signal): 75 open "Stabilize repeated
// <tool> tool failure" items for 16 tools on 2026-10-14. A repeated tool
// failure is a defect of the TOOL, so every projection path files it under
// this origin and backlog ingest folds each observation into one item as an
// occurrence. Grant denials stay per coworker: a missing grant is that
// coworker's gap, not the tool's.

export const TOOL_DEFECT_ORIGIN_KIND = "tool-defect";

/**
 * The tool-scoped backlog origin for a repeated-tool-failure observation, read
 * from the observer's structured evidence (never parsed from a title). Null for
 * any other observation, which keeps its own origin.
 */
export function toolDefectOrigin(evidence: unknown): { kind: string; id: string } | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const { signal, toolName } = evidence as { signal?: unknown; toolName?: unknown };
  if (signal !== "tool-failure" || typeof toolName !== "string" || !toolName.trim()) return null;
  return { kind: TOOL_DEFECT_ORIGIN_KIND, id: toolName.trim() };
}

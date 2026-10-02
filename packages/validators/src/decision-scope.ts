// Owning scopes are declared by the source authority, never inferred from prose.
export const DECISION_SCOPES = ["wwmd", "wwwd", "wsid"] as const;
export type DecisionScope = (typeof DECISION_SCOPES)[number];
export function isDecisionScope(value: unknown): value is DecisionScope {
  return typeof value === "string" && (DECISION_SCOPES as readonly string[]).includes(value);
}

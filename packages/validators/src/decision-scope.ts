// Owning scopes are declared by the source authority, never inferred from prose.
import { DECISION_SCOPES, type DecisionScope } from "./decision-scopes.js";
export { DECISION_SCOPES, type DecisionScope } from "./decision-scopes.js";
export function isDecisionScope(value: unknown): value is DecisionScope {
  return typeof value === "string" && (DECISION_SCOPES as readonly string[]).includes(value);
}

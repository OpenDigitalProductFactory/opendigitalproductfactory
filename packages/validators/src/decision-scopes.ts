/** Existing DPF decision scopes; ownership and authority stay with each host. */
export const DECISION_SCOPES = ["wwmd", "wwwd", "wsid"] as const;
export type DecisionScope = (typeof DECISION_SCOPES)[number];

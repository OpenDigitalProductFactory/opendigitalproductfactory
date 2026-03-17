import type { GovernanceDecision, RiskBand } from "./governance-types";
import type { SensitivityLevel } from "./agent-router-types";

const RISK_BAND_ORDER: Record<RiskBand, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

type ActiveGrant = {
  maxRiskBand: RiskBand;
  allowsRequestedScope: boolean;
  expiresAt: Date;
  now: Date;
};

export type ResolveGovernedActionInput = {
  humanAllowed: boolean;
  agentPolicyAllowed: boolean;
  riskBand: RiskBand;
  agentMaxRiskBand: RiskBand;
  activeGrant: ActiveGrant | null;
};

export type ResolveGovernedActionResult = {
  decision: GovernanceDecision;
  rationaleCode:
    | "human_context_denied"
    | "agent_policy_denied"
    | "grant_required"
    | "grant_expired"
    | "grant_scope_denied"
    | "grant_risk_exceeded"
    | "baseline_intersection"
    | "delegation_grant";
};

function exceedsRiskBand(requested: RiskBand, allowed: RiskBand): boolean {
  return RISK_BAND_ORDER[requested] > RISK_BAND_ORDER[allowed];
}

function allow(rationaleCode: ResolveGovernedActionResult["rationaleCode"]): ResolveGovernedActionResult {
  return { decision: "allow", rationaleCode };
}

function deny(rationaleCode: ResolveGovernedActionResult["rationaleCode"]): ResolveGovernedActionResult {
  return { decision: "deny", rationaleCode };
}

function requireApproval(rationaleCode: ResolveGovernedActionResult["rationaleCode"]): ResolveGovernedActionResult {
  return { decision: "require_approval", rationaleCode };
}

export function resolveGovernedAction(input: ResolveGovernedActionInput): ResolveGovernedActionResult {
  if (!input.humanAllowed) return deny("human_context_denied");
  if (!input.agentPolicyAllowed) return deny("agent_policy_denied");

  const withinBaselineRisk = !exceedsRiskBand(input.riskBand, input.agentMaxRiskBand);
  if (withinBaselineRisk) return allow("baseline_intersection");

  if (!input.activeGrant) return requireApproval("grant_required");
  if (input.activeGrant.expiresAt <= input.activeGrant.now) return requireApproval("grant_expired");
  if (!input.activeGrant.allowsRequestedScope) return deny("grant_scope_denied");
  if (exceedsRiskBand(input.riskBand, input.activeGrant.maxRiskBand)) return deny("grant_risk_exceeded");

  return allow("delegation_grant");
}

export type SensitivityOverrideRequest = {
  pageSensitivity: SensitivityLevel;
  requestedSensitivity: SensitivityLevel;
  employeeId: string;
};

export type SensitivityOverrideResult = {
  decision: "allow" | "deny";
  rationale: string;
};

const SENSITIVITY_ORDER: Record<SensitivityLevel, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

/** A downgrade is only valid when requested level is LOWER than page level. */
export function resolveSensitivityOverride(
  request: SensitivityOverrideRequest,
): SensitivityOverrideResult {
  if (SENSITIVITY_ORDER[request.requestedSensitivity] >= SENSITIVITY_ORDER[request.pageSensitivity]) {
    return { decision: "deny", rationale: "Requested sensitivity is not lower than page sensitivity" };
  }
  return { decision: "allow", rationale: `Employee ${request.employeeId} approved downgrade from ${request.pageSensitivity} to ${request.requestedSensitivity}` };
}

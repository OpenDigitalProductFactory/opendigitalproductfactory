import type { GovernanceDecision, RiskBand } from "./governance-types";

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

export type RiskBand = "low" | "medium" | "high" | "critical";

export type GovernanceDecision = "allow" | "deny" | "require_approval";

export type DefaultActionScope = {
  actionFamilies: string[];
  resourceTypes: string[];
  maxRiskBand: RiskBand;
  constraints?: {
    tenantScoped?: boolean;
    teamScoped?: boolean;
    objectRefs?: string[];
  };
};

export type DelegationGrantScope = {
  actionFamilies: string[];
  resourceTypes: string[];
  maxRiskBand: RiskBand;
  objectRefs?: string[];
  workflowKeys?: string[];
  constraints?: {
    tenantScoped?: boolean;
    teamScoped?: boolean;
    singleTargetUserId?: string;
  };
};

export type PrincipalContext = {
  authenticatedSubject:
    | { kind: "user"; userId: string }
    | { kind: "customer_contact"; contactId: string };
  actingHuman:
    | { kind: "user"; userId: string }
    | { kind: "customer_contact"; contactId: string };
  actingAgent?: { agentId: string };
  teamIds: string[];
  platformRoleIds: string[];
  effectiveCapabilities: string[];
  delegationGrantIds: string[];
};

export type AuthorityRequest = {
  actionKey: string;
  objectRef?: string;
  riskBand: RiskBand;
  actingAgentId?: string | null;
};

import type { InternalAIDoc } from "@/lib/identity/aidoc-resolver";
import type { GaidAuthorizationClass } from "@/lib/identity/authorization-classes";

export type InternalAgentCardInterface =
  | "mcp"
  | "a2a-internal"
  | "task-run"
  | "supervisor-control";

export type InternalAgentCardSecurityScheme = {
  id: string;
  type: "dpf-capability" | "agent-grant" | "hitl" | "mcp-token";
  description: string;
};

export type InternalAgentCardSkill = {
  label: string;
  taskType: string | null;
  capability: string | null;
};

export type RuntimeAuthoritySnapshot = {
  agentId: string;
  routeContext: string | null;
  actingPrincipalRef: string | null;
  actingPrincipalGaid: string | null;
  agentGaid: string | null;
  aidocValidationState: InternalAIDoc["validation_state"] | "unlinked";
  operatingProfileFingerprint: string | null;
  hitlTier: number;
  hitlPolicy: string | null;
  sensitivity: string;
  toolGrantCount: number;
  exposedToolCount: number;
  authorizationClasses: GaidAuthorizationClass[];
  requiresApprovalForSideEffects: boolean;
  limitations: string[];
  supervisorDecisionState: RuntimeSupervisorDecisionState;
};

export type RuntimeSupervisorDecisionState = {
  pendingProposalCount: number;
  latestPendingProposal: {
    proposalId: string;
    actionType: string;
    proposedAt: string;
  } | null;
  recentReceiptCount: number;
  latestReceipt: {
    receiptId: string;
    toolExecutionId: string;
    toolName: string;
    receiptStatus: string;
    executionStatus: string;
    createdAt: string;
  } | null;
};

export type InternalAgentCard = {
  schemaVersion: "dpf.agent-card.v1";
  agentId: string;
  name: string;
  description: string | null;
  status: string;
  lifecycleStage: string;
  interfaces: InternalAgentCardInterface[];
  skills: InternalAgentCardSkill[];
  capabilities: string[];
  toolGrants: string[];
  exposedTools: string[];
  securitySchemes: InternalAgentCardSecurityScheme[];
  securityRequirements: string[];
  extensions: {
    tak: {
      sensitivity: string;
      hitlTier: number;
      hitlPolicy: string | null;
      autonomyLevel: string | null;
      allowDelegation: boolean;
      maxDelegationRiskBand: string | null;
      operatingProfileFingerprint: string | null;
      authority: RuntimeAuthoritySnapshot;
    };
    gaid: {
      gaid: string | null;
      aidocRef: string | null;
      authorizationClasses: GaidAuthorizationClass[];
      validationState: InternalAIDoc["validation_state"] | "unlinked";
    };
  };
};

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
    approvalId: string;
    proposalId: string;
    threadId: string;
    messageId: string;
    actionType: string;
    actionLabel: string;
    actionSummary: string;
    actionDetails: Array<{ label: string; value: string }>;
    proposedAt: string;
    decisionEndpoint: string;
  } | null;
  /**
   * BI-7BCC87BB (founder decision DI-FFD78D222548): pending approval requests
   * (CoworkerActionEnvelope) beside legacy proposals. Optional so card
   * projections built before PR-B still type-check; the service always sets them.
   */
  pendingEnvelopeCount?: number;
  latestPendingEnvelope?: SupervisorPendingEnvelope | null;
  /** Which of the two is newest, for the card to show; null when nothing is pending. */
  latestPendingKind?: "proposal" | "envelope" | null;
  recentReceiptCount: number;
  latestReceipt: {
    receiptId: string;
    toolExecutionId: string;
    toolName: string;
    receiptKind: string;
    receiptStatus: string;
    executionStatus: string;
    expiresAt: string;
    createdAt: string;
    journalHref: string;
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

/** A pending approval request on the supervisor card, decided with the shared envelope buttons. */
export type SupervisorPendingEnvelope = {
  envelopeId: string;
  /** The person whose authority it lends: the only one who decides, unless an admin decides on their behalf. */
  delegatingUserId: string;
  ownerLabel: string;
  toolName: string;
  actionLabel: string;
  rationale: string;
  proposedAt: string;
  expiresAt: string | null;
  approveHref: string;
  declineHref: string;
};

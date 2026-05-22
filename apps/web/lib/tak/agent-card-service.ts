import { prisma } from "@dpf/db";

import { resolveAIDocForAgent, type InternalAIDoc } from "@/lib/identity/aidoc-resolver";

import { getToolGrantMapping } from "./agent-grants";
import type {
  InternalAgentCard,
  InternalAgentCardSecurityScheme,
  InternalAgentCardSkill,
  RuntimeAuthoritySnapshot,
  RuntimeSupervisorDecisionState,
} from "./agent-card-types";

type AgentCardDb = Pick<typeof prisma, "agent" | "agentActionProposal" | "toolExecution">;

type AgentCardAgent = {
  agentId: string;
  name: string;
  description: string | null;
  status: string;
  lifecycleStage: string;
  sensitivity: string;
  hitlTierDefault: number;
  executionConfig: {
    executionType: string | null;
    defaultModelId: string | null;
  } | null;
  governanceProfile: {
    autonomyLevel: string | null;
    hitlPolicy: string | null;
    allowDelegation: boolean;
    maxDelegationRiskBand: string | null;
  } | null;
  skills: InternalAgentCardSkill[];
  toolGrants: Array<{ grantKey: string }>;
};

export type ResolveInternalAgentCardOptions = {
  routeContext?: string | null;
  actingPrincipalRef?: string | null;
  actingPrincipalGaid?: string | null;
  db?: AgentCardDb;
};

export type ListInternalAgentCardsOptions = Omit<ResolveInternalAgentCardOptions, "db"> & {
  db?: AgentCardDb;
};

export type InternalAgentCardProjectionSource = {
  agent: AgentCardAgent;
  aidoc: InternalAIDoc | null;
  supervisorDecisionState?: RuntimeSupervisorDecisionState;
  routeContext?: string | null;
  actingPrincipalRef?: string | null;
  actingPrincipalGaid?: string | null;
};

const INTERFACES: InternalAgentCard["interfaces"] = [
  "mcp",
  "a2a-internal",
  "task-run",
  "supervisor-control",
];

const SECURITY_SCHEMES: InternalAgentCardSecurityScheme[] = [
  {
    id: "dpf-capability",
    type: "dpf-capability",
    description: "The acting user or principal must have the platform capability for the requested action.",
  },
  {
    id: "agent-grant",
    type: "agent-grant",
    description: "The agent must have a matching grant for the requested tool.",
  },
  {
    id: "hitl",
    type: "hitl",
    description: "Consequential or side-effecting work may require human review or approval.",
  },
  {
    id: "mcp-token",
    type: "mcp-token",
    description: "External MCP callers must present a scoped DPF MCP token.",
  },
];

const SECURITY_REQUIREMENTS = [
  "user capability must allow the requested action",
  "agent grant must allow the requested tool",
  "route context must expose the requested capability",
  "side-effecting work may require HITL proposal approval",
];

const EMPTY_SUPERVISOR_DECISION_STATE: RuntimeSupervisorDecisionState = {
  pendingProposalCount: 0,
  latestPendingProposal: null,
  recentReceiptCount: 0,
  latestReceipt: null,
};

function createEmptySupervisorDecisionState(): RuntimeSupervisorDecisionState {
  return { ...EMPTY_SUPERVISOR_DECISION_STATE };
}

function buildDecisionEndpoint(approvalId: string): string {
  return `/api/v1/governance/approvals/${encodeURIComponent(approvalId)}`;
}

function buildJournalHref(params: { toolExecutionId: string; receiptId: string }): string {
  const executionId = encodeURIComponent(params.toolExecutionId);
  const receiptId = encodeURIComponent(params.receiptId);
  return `/platform/audit/journal?executionId=${executionId}&receiptId=${receiptId}`;
}

const AGENT_CARD_SELECT = {
  agentId: true,
  name: true,
  description: true,
  status: true,
  lifecycleStage: true,
  sensitivity: true,
  hitlTierDefault: true,
  executionConfig: {
    select: {
      executionType: true,
      defaultModelId: true,
    },
  },
  governanceProfile: {
    select: {
      autonomyLevel: true,
      hitlPolicy: true,
      allowDelegation: true,
      maxDelegationRiskBand: true,
    },
  },
  skills: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      label: true,
      taskType: true,
      capability: true,
    },
  },
  toolGrants: {
    select: {
      grantKey: true,
    },
  },
};

function sortedUnique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function deriveExposedTools(grantKeys: string[], aidoc: InternalAIDoc | null): string[] {
  if (aidoc) {
    return [...aidoc.tool_surface].sort();
  }

  const grantSet = new Set(grantKeys);
  return Object.entries(getToolGrantMapping())
    .filter(([, requiredGrants]) => requiredGrants.some((grantKey) => grantSet.has(grantKey)))
    .map(([toolName]) => toolName)
    .sort();
}

function requiresApprovalForSideEffects(agent: AgentCardAgent): boolean {
  const hitlPolicy = agent.governanceProfile?.hitlPolicy ?? null;
  return agent.hitlTierDefault < 3 || (hitlPolicy !== null && hitlPolicy !== "none");
}

function buildLimitations(params: {
  aidoc: InternalAIDoc | null;
  agent: AgentCardAgent;
  exposedTools: string[];
}): string[] {
  const limitations: string[] = [];

  if (!params.aidoc) {
    limitations.push("agent has no resolved GAID/AIDoc projection");
  }

  if (requiresApprovalForSideEffects(params.agent)) {
    limitations.push("side-effecting actions require proposal or review before execution");
  }

  if (!params.agent.governanceProfile?.allowDelegation) {
    limitations.push("delegation is not enabled for this agent");
  }

  if (params.exposedTools.length === 0) {
    limitations.push("no tools are exposed by the current grant set");
  }

  return limitations;
}

function buildAuthoritySnapshot(params: {
  agent: AgentCardAgent;
  aidoc: InternalAIDoc | null;
  grantKeys: string[];
  exposedTools: string[];
  supervisorDecisionState?: RuntimeSupervisorDecisionState;
  routeContext?: string | null;
  actingPrincipalRef?: string | null;
  actingPrincipalGaid?: string | null;
}): RuntimeAuthoritySnapshot {
  const authorizationClasses = params.aidoc?.authorization_classes ?? [];
  const limitations = buildLimitations({
    aidoc: params.aidoc,
    agent: params.agent,
    exposedTools: params.exposedTools,
  });

  return {
    agentId: params.agent.agentId,
    routeContext: params.routeContext ?? null,
    actingPrincipalRef: params.actingPrincipalRef ?? null,
    actingPrincipalGaid: params.actingPrincipalGaid ?? null,
    agentGaid: params.aidoc?.gaid ?? null,
    aidocValidationState: params.aidoc?.validation_state ?? "unlinked",
    operatingProfileFingerprint: params.aidoc?.operating_profile_fingerprint ?? null,
    hitlTier: params.agent.hitlTierDefault,
    hitlPolicy: params.agent.governanceProfile?.hitlPolicy ?? null,
    sensitivity: params.agent.sensitivity,
    toolGrantCount: params.grantKeys.length,
    exposedToolCount: params.exposedTools.length,
    authorizationClasses,
    requiresApprovalForSideEffects: requiresApprovalForSideEffects(params.agent),
    limitations,
    supervisorDecisionState: params.supervisorDecisionState ?? createEmptySupervisorDecisionState(),
  };
}

export function projectInternalAgentCard(
  source: InternalAgentCardProjectionSource,
): InternalAgentCard {
  const grantKeys = sortedUnique(source.agent.toolGrants.map((grant) => grant.grantKey));
  const capabilities = sortedUnique(source.agent.skills.map((skill) => skill.capability));
  const exposedTools = deriveExposedTools(grantKeys, source.aidoc);
  const authorizationClasses = source.aidoc?.authorization_classes ?? [];
  const authority = buildAuthoritySnapshot({
    agent: source.agent,
    aidoc: source.aidoc,
    grantKeys,
    exposedTools,
    supervisorDecisionState: source.supervisorDecisionState,
    routeContext: source.routeContext,
    actingPrincipalRef: source.actingPrincipalRef,
    actingPrincipalGaid: source.actingPrincipalGaid,
  });

  return {
    schemaVersion: "dpf.agent-card.v1",
    agentId: source.agent.agentId,
    name: source.agent.name,
    description: source.agent.description,
    status: source.agent.status,
    lifecycleStage: source.agent.lifecycleStage,
    interfaces: INTERFACES,
    skills: source.agent.skills.map((skill) => ({
      label: skill.label,
      taskType: skill.taskType,
      capability: skill.capability,
    })),
    capabilities,
    toolGrants: grantKeys,
    exposedTools,
    securitySchemes: SECURITY_SCHEMES,
    securityRequirements: SECURITY_REQUIREMENTS,
    extensions: {
      tak: {
        sensitivity: source.agent.sensitivity,
        hitlTier: source.agent.hitlTierDefault,
        hitlPolicy: source.agent.governanceProfile?.hitlPolicy ?? null,
        autonomyLevel: source.agent.governanceProfile?.autonomyLevel ?? null,
        allowDelegation: source.agent.governanceProfile?.allowDelegation ?? false,
        maxDelegationRiskBand: source.agent.governanceProfile?.maxDelegationRiskBand ?? null,
        operatingProfileFingerprint: source.aidoc?.operating_profile_fingerprint ?? null,
        authority,
      },
      gaid: {
        gaid: source.aidoc?.gaid ?? null,
        aidocRef: source.aidoc?.gaid ?? null,
        authorizationClasses,
        validationState: source.aidoc?.validation_state ?? "unlinked",
      },
    },
  };
}

async function getSupervisorDecisionStateForAgents(
  agentIds: string[],
  db: AgentCardDb,
): Promise<Map<string, RuntimeSupervisorDecisionState>> {
  const stateByAgentId = new Map(
    agentIds.map((agentId) => [agentId, createEmptySupervisorDecisionState()]),
  );

  if (agentIds.length === 0) {
    return stateByAgentId;
  }

  const [pendingProposals, receiptExecutions] = await Promise.all([
    db.agentActionProposal.findMany({
      where: {
        agentId: { in: agentIds },
        status: "proposed",
      },
      orderBy: { proposedAt: "desc" },
      select: {
        id: true,
        proposalId: true,
        threadId: true,
        messageId: true,
        agentId: true,
        actionType: true,
        proposedAt: true,
      },
    }),
    db.toolExecution.findMany({
      where: {
        agentId: { in: agentIds },
        receipt: { isNot: null },
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(100, agentIds.length * 10),
      select: {
        id: true,
        agentId: true,
        toolName: true,
        createdAt: true,
        receipt: {
          select: {
            id: true,
            toolExecutionId: true,
            receiptKind: true,
            receiptStatus: true,
            executionStatus: true,
            expiresAt: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  for (const proposal of pendingProposals) {
    const current = stateByAgentId.get(proposal.agentId) ?? createEmptySupervisorDecisionState();
    stateByAgentId.set(proposal.agentId, {
      ...current,
      pendingProposalCount: current.pendingProposalCount + 1,
      latestPendingProposal: current.latestPendingProposal ?? {
        approvalId: proposal.id,
        proposalId: proposal.proposalId,
        threadId: proposal.threadId,
        messageId: proposal.messageId,
        actionType: proposal.actionType,
        proposedAt: proposal.proposedAt.toISOString(),
        decisionEndpoint: buildDecisionEndpoint(proposal.id),
      },
    });
  }

  for (const execution of receiptExecutions) {
    if (!execution.receipt) continue;
    const current = stateByAgentId.get(execution.agentId) ?? createEmptySupervisorDecisionState();
    stateByAgentId.set(execution.agentId, {
      ...current,
      recentReceiptCount: current.recentReceiptCount + 1,
      latestReceipt: current.latestReceipt ?? {
        receiptId: execution.receipt.id,
        toolExecutionId: execution.receipt.toolExecutionId,
        toolName: execution.toolName,
        receiptKind: execution.receipt.receiptKind,
        receiptStatus: execution.receipt.receiptStatus,
        executionStatus: execution.receipt.executionStatus,
        expiresAt: execution.receipt.expiresAt.toISOString(),
        createdAt: execution.receipt.createdAt.toISOString(),
        journalHref: buildJournalHref({
          toolExecutionId: execution.receipt.toolExecutionId,
          receiptId: execution.receipt.id,
        }),
      },
    });
  }

  return stateByAgentId;
}

export async function resolveInternalAgentCard(
  agentId: string,
  options: ResolveInternalAgentCardOptions = {},
): Promise<InternalAgentCard | null> {
  const db = options.db ?? prisma;
  const agent = await db.agent.findUnique({
    where: { agentId },
    select: AGENT_CARD_SELECT,
  });

  if (!agent) {
    return null;
  }

  const aidoc = await resolveAIDocForAgent(agent.agentId);
  const supervisorDecisionState = (await getSupervisorDecisionStateForAgents([agent.agentId], db)).get(
    agent.agentId,
  );

  return projectInternalAgentCard({
    agent,
    aidoc,
    supervisorDecisionState,
    routeContext: options.routeContext,
    actingPrincipalRef: options.actingPrincipalRef,
    actingPrincipalGaid: options.actingPrincipalGaid,
  });
}

export async function listInternalAgentCards(
  options: ListInternalAgentCardsOptions = {},
): Promise<InternalAgentCard[]> {
  const db = options.db ?? prisma;
  const agents = await db.agent.findMany({
    orderBy: { name: "asc" },
    select: AGENT_CARD_SELECT,
  });
  const supervisorStateByAgentId = await getSupervisorDecisionStateForAgents(
    agents.map((agent) => agent.agentId),
    db,
  );

  return Promise.all(
    agents.map(async (agent) =>
      projectInternalAgentCard({
        agent,
        aidoc: await resolveAIDocForAgent(agent.agentId),
        supervisorDecisionState: supervisorStateByAgentId.get(agent.agentId),
        routeContext: options.routeContext,
        actingPrincipalRef: options.actingPrincipalRef,
        actingPrincipalGaid: options.actingPrincipalGaid,
      }),
    ),
  );
}

import { prisma } from "@dpf/db";

import {
  projectInternalAIDoc,
  type AIDocProjectionSource,
  type InternalAIDoc,
} from "./aidoc-resolver";
import { type GaidAuthorizationClass } from "./authorization-classes";

type SnapshotDb = Pick<typeof prisma, "agent" | "principalAlias" | "agentModelConfig" | "userFact">;

export type AgentIdentitySnapshot = {
  id: string;
  agentId: string;
  name: string;
  status: string;
  lifecycleStage: string;
  humanSupervisorId: string | null;
  linkedPrincipalId: string | null;
  gaid: string | null;
  aidoc: InternalAIDoc | null;
  authorizationClasses: GaidAuthorizationClass[];
  operatingProfileFingerprint: string | null;
  validationState: InternalAIDoc["validation_state"] | "unlinked";
  toolSurfaceCount: number;
  promptClassRefCount: number;
  memoryFactCurrentCount: number;
  memoryFactPendingRevalidationCount: number;
  memoryFactLegacyCount: number;
};

export type AgentIdentitySnapshotSummary = {
  totalAgents: number;
  linkedAgents: number;
  projectedAgents: number;
  unlinkedAgents: number;
  validatedAgents: number;
  pendingRevalidationAgents: number;
  staleAgents: number;
  portableAuthorizationClassCount: number;
};

export async function listAgentIdentitySnapshots(
  db: SnapshotDb = prisma,
): Promise<AgentIdentitySnapshot[]> {
  const agents = await db.agent.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      agentId: true,
      name: true,
      status: true,
      lifecycleStage: true,
      sensitivity: true,
      hitlTierDefault: true,
      humanSupervisorId: true,
      executionConfig: {
        select: {
          defaultModelId: true,
          executionType: true,
          temperature: true,
          maxTokens: true,
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
        select: {
          label: true,
          taskType: true,
        },
      },
      toolGrants: {
        select: {
          grantKey: true,
        },
      },
    },
  });

  const [aliases, modelConfigs, memoryFacts] = await Promise.all([
    db.principalAlias.findMany({
      where: {
        aliasType: { in: ["agent", "gaid"] },
        issuer: "",
      },
      select: {
        aliasType: true,
        aliasValue: true,
        principalId: true,
      },
    }),
    db.agentModelConfig.findMany({
      where: {
        agentId: {
          in: agents.map((agent) => agent.agentId),
        },
      },
      select: {
        agentId: true,
        minimumTier: true,
        pinnedProviderId: true,
        pinnedModelId: true,
        budgetClass: true,
      },
    }),
    db.userFact.findMany({
      where: {
        supersededAt: null,
      },
      select: {
        sourceAgentId: true,
        validatedAgainstFingerprint: true,
      },
    }),
  ]);

  const principalIdByAgentId = new Map(
    aliases
      .filter((alias) => alias.aliasType === "agent")
      .map((alias) => [alias.aliasValue, alias.principalId]),
  );
  const gaidByPrincipalId = new Map(
    aliases
      .filter((alias) => alias.aliasType === "gaid")
      .map((alias) => [alias.principalId, alias.aliasValue]),
  );
  const modelConfigByAgentId = new Map(
    modelConfigs.map((config) => [config.agentId, config]),
  );
  const memoryFactsByAgentId = new Map<
    string,
    Array<{ sourceAgentId: string | null; validatedAgainstFingerprint: string | null }>
  >();
  for (const fact of memoryFacts) {
    if (!fact.sourceAgentId) continue;
    const existing = memoryFactsByAgentId.get(fact.sourceAgentId) ?? [];
    existing.push(fact);
    memoryFactsByAgentId.set(fact.sourceAgentId, existing);
  }

  return agents.map((agent) => {
    const linkedPrincipalId = principalIdByAgentId.get(agent.agentId) ?? null;
    const gaid = linkedPrincipalId ? gaidByPrincipalId.get(linkedPrincipalId) ?? null : null;
    const aidoc = gaid && linkedPrincipalId
      ? projectInternalAIDoc({
          gaid,
          principalRef: linkedPrincipalId,
          agent: agent as AIDocProjectionSource["agent"],
          modelConfig: modelConfigByAgentId.get(agent.agentId) ?? null,
        })
      : null;
    const operatingProfileFingerprint = aidoc?.operating_profile_fingerprint ?? null;
    const memoryFactsForAgent = memoryFactsByAgentId.get(agent.agentId) ?? [];
    const memoryFactCurrentCount = operatingProfileFingerprint
      ? memoryFactsForAgent.filter(
          (fact) => fact.validatedAgainstFingerprint === operatingProfileFingerprint,
        ).length
      : 0;
    const memoryFactPendingRevalidationCount = operatingProfileFingerprint
      ? memoryFactsForAgent.filter(
          (fact) =>
            fact.validatedAgainstFingerprint !== null &&
            fact.validatedAgainstFingerprint !== operatingProfileFingerprint,
        ).length
      : 0;
    const memoryFactLegacyCount = memoryFactsForAgent.filter(
      (fact) => fact.validatedAgainstFingerprint === null,
    ).length;

    return {
      id: agent.id,
      agentId: agent.agentId,
      name: agent.name,
      status: agent.status,
      lifecycleStage: agent.lifecycleStage,
      humanSupervisorId: agent.humanSupervisorId,
      linkedPrincipalId,
      gaid,
      aidoc,
      authorizationClasses: aidoc?.authorization_classes ?? [],
      operatingProfileFingerprint,
      validationState: aidoc?.validation_state ?? "unlinked",
      toolSurfaceCount: aidoc?.tool_surface.length ?? 0,
      promptClassRefCount: aidoc?.prompt_class_refs.length ?? 0,
      memoryFactCurrentCount,
      memoryFactPendingRevalidationCount,
      memoryFactLegacyCount,
    };
  });
}

export function summarizeAgentIdentitySnapshots(
  snapshots: AgentIdentitySnapshot[],
): AgentIdentitySnapshotSummary {
  const portableAuthorizationClasses = new Set<string>();

  for (const snapshot of snapshots) {
    for (const authClass of snapshot.authorizationClasses) {
      portableAuthorizationClasses.add(authClass);
    }
  }

  return {
    totalAgents: snapshots.length,
    linkedAgents: snapshots.filter((snapshot) => snapshot.linkedPrincipalId !== null).length,
    projectedAgents: snapshots.filter((snapshot) => snapshot.aidoc !== null).length,
    unlinkedAgents: snapshots.filter((snapshot) => snapshot.validationState === "unlinked").length,
    validatedAgents: snapshots.filter((snapshot) => snapshot.validationState === "validated").length,
    pendingRevalidationAgents: snapshots.filter(
      (snapshot) => snapshot.validationState === "pending-revalidation",
    ).length,
    staleAgents: snapshots.filter((snapshot) => snapshot.validationState === "stale").length,
    portableAuthorizationClassCount: portableAuthorizationClasses.size,
  };
}

import { prisma } from "@dpf/db";

import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import { computeMetadataHash } from "@/lib/routing/metadata-hash";

import {
  mapLocalPolicyToPortableClasses,
  type GaidAuthorizationClass,
} from "./authorization-classes";

const INTERNAL_ISSUER = "";

type AIDocDb = Pick<typeof prisma, "principalAlias" | "agent" | "agentModelConfig">;

export type AIDocProjectionSource = {
  gaid: string;
  principalRef: string;
  agent: {
    agentId: string;
    name: string;
    status: string;
    sensitivity: string;
    hitlTierDefault: number;
    lifecycleStage: string;
    executionConfig: {
      defaultModelId: string | null;
      executionType: string | null;
      temperature: number | null;
      maxTokens: number | null;
    } | null;
    governanceProfile: {
      autonomyLevel: string | null;
      hitlPolicy: string | null;
      allowDelegation: boolean;
      maxDelegationRiskBand: string | null;
    } | null;
    skills: Array<{
      label: string;
      taskType: string | null;
    }>;
    toolGrants: Array<{
      grantKey: string;
    }>;
  };
  modelConfig: {
    minimumTier: string | null;
    pinnedProviderId: string | null;
    pinnedModelId: string | null;
    budgetClass: string | null;
  } | null;
};

export type InternalAIDoc = {
  gaid: string;
  issuer: string;
  subject_type: "agent";
  subject_name: string;
  principal_ref: string;
  status: string;
  exposure_state: "private";
  validation_state: "validated" | "pending-revalidation" | "stale";
  lifecycle_stage: string;
  data_sensitivity_profile: string;
  model_binding: {
    default_model_id: string | null;
    pinned_provider_id: string | null;
    pinned_model_id: string | null;
    minimum_tier: string | null;
    budget_class: string | null;
    execution_type: string | null;
    temperature: number | null;
    max_tokens: number | null;
  };
  hitl_profile: {
    default_tier: number;
    policy: string | null;
    autonomy_level: string | null;
    allow_delegation: boolean;
    max_delegation_risk_band: string | null;
  };
  prompt_class_refs: string[];
  tool_surface: string[];
  authorization_classes: GaidAuthorizationClass[];
  operating_profile_fingerprint: string;
};

function parseIssuerFromGaid(gaid: string): string {
  const parts = gaid.split(":");
  return parts[2] ?? "dpf.internal";
}

function deriveToolSurface(grantKeys: string[]): string[] {
  const grantSet = new Set(grantKeys);
  const toolMap = getToolGrantMapping();

  return Object.entries(toolMap)
    .filter(([, requiredGrants]) => requiredGrants.some((grantKey) => grantSet.has(grantKey)))
    .map(([toolName]) => toolName)
    .sort();
}

function derivePromptClassRefs(
  skills: Array<{ label: string; taskType: string | null }>,
): string[] {
  return skills
    .map((skill) => `${skill.taskType ?? "conversation"}:${skill.label}`)
    .sort();
}

function buildOperatingProfileFingerprint(input: {
  modelBinding: InternalAIDoc["model_binding"];
  grantKeys: string[];
  promptClassRefs: string[];
  hitlDefault: number;
  sensitivity: string;
}): string {
  return computeMetadataHash({
    hitl_default: input.hitlDefault,
    model_binding: input.modelBinding,
    prompt_class_refs: [...input.promptClassRefs].sort(),
    sensitivity: input.sensitivity,
    tool_grants_sorted: [...input.grantKeys].sort(),
  });
}

export function projectInternalAIDoc(source: AIDocProjectionSource): InternalAIDoc {
  const grantKeys = source.agent.toolGrants.map((grant) => grant.grantKey).sort();
  const promptClassRefs = derivePromptClassRefs(source.agent.skills);
  const modelBinding: InternalAIDoc["model_binding"] = {
    default_model_id: source.agent.executionConfig?.defaultModelId ?? null,
    pinned_provider_id: source.modelConfig?.pinnedProviderId ?? null,
    pinned_model_id: source.modelConfig?.pinnedModelId ?? null,
    minimum_tier: source.modelConfig?.minimumTier ?? null,
    budget_class: source.modelConfig?.budgetClass ?? null,
    execution_type: source.agent.executionConfig?.executionType ?? null,
    temperature: source.agent.executionConfig?.temperature ?? null,
    max_tokens: source.agent.executionConfig?.maxTokens ?? null,
  };

  return {
    gaid: source.gaid,
    issuer: parseIssuerFromGaid(source.gaid),
    subject_type: "agent",
    subject_name: source.agent.name,
    principal_ref: source.principalRef,
    status: source.agent.status,
    exposure_state: "private",
    validation_state: source.agent.status === "active" ? "validated" : "stale",
    lifecycle_stage: source.agent.lifecycleStage,
    data_sensitivity_profile: source.agent.sensitivity,
    model_binding: modelBinding,
    hitl_profile: {
      default_tier: source.agent.hitlTierDefault,
      policy: source.agent.governanceProfile?.hitlPolicy ?? null,
      autonomy_level: source.agent.governanceProfile?.autonomyLevel ?? null,
      allow_delegation: source.agent.governanceProfile?.allowDelegation ?? false,
      max_delegation_risk_band: source.agent.governanceProfile?.maxDelegationRiskBand ?? null,
    },
    prompt_class_refs: promptClassRefs,
    tool_surface: deriveToolSurface(grantKeys),
    authorization_classes: mapLocalPolicyToPortableClasses(grantKeys),
    operating_profile_fingerprint: buildOperatingProfileFingerprint({
      modelBinding,
      grantKeys,
      promptClassRefs,
      hitlDefault: source.agent.hitlTierDefault,
      sensitivity: source.agent.sensitivity,
    }),
  };
}

export async function resolveInternalAIDoc(
  gaid: string,
  db: AIDocDb = prisma,
): Promise<InternalAIDoc | null> {
  const gaidAlias = await db.principalAlias.findFirst({
    where: {
      aliasType: "gaid",
      aliasValue: gaid,
      issuer: INTERNAL_ISSUER,
    },
    include: {
      principal: {
        select: {
          principalId: true,
          displayName: true,
          status: true,
        },
      },
    },
  });

  if (!gaidAlias?.principal) {
    return null;
  }

  const agentAlias = await db.principalAlias.findFirst({
    where: {
      principalId: gaidAlias.principalId,
      aliasType: "agent",
      issuer: INTERNAL_ISSUER,
    },
    select: {
      aliasValue: true,
    },
  });

  if (!agentAlias?.aliasValue) {
    return null;
  }

  const agent = await db.agent.findUnique({
    where: { agentId: agentAlias.aliasValue },
    select: {
      agentId: true,
      name: true,
      status: true,
      sensitivity: true,
      hitlTierDefault: true,
      lifecycleStage: true,
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

  if (!agent) {
    return null;
  }

  const modelConfig = await db.agentModelConfig.findUnique({
    where: { agentId: agent.agentId },
    select: {
      minimumTier: true,
      pinnedProviderId: true,
      pinnedModelId: true,
      budgetClass: true,
    },
  });

  return projectInternalAIDoc({
    gaid,
    principalRef: gaidAlias.principal.principalId,
    agent,
    modelConfig,
  });
}

export async function resolveAIDocForAgent(
  agentId: string,
  db: AIDocDb = prisma,
): Promise<InternalAIDoc | null> {
  const agentAlias = await db.principalAlias.findFirst({
    where: {
      aliasType: "agent",
      aliasValue: agentId,
      issuer: INTERNAL_ISSUER,
    },
    select: {
      principalId: true,
    },
  });

  if (!agentAlias?.principalId) {
    return null;
  }

  const gaidAlias = await db.principalAlias.findFirst({
    where: {
      principalId: agentAlias.principalId,
      aliasType: "gaid",
      issuer: INTERNAL_ISSUER,
    },
    select: {
      aliasValue: true,
    },
  });

  if (!gaidAlias?.aliasValue) {
    return null;
  }

  return resolveInternalAIDoc(gaidAlias.aliasValue, db);
}

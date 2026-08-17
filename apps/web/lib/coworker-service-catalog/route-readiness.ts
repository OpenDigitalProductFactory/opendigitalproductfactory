import { prisma } from "@dpf/db";

import {
  resolveDispatchPostures,
  type DispatchPosture,
} from "@/lib/golden-triangle/dispatch";
import { getLocalOnlyInference } from "@/lib/inference/local-only";
import {
  buildEffectiveRequestContract,
  buildInitialRouteContext,
} from "@/lib/inference/route-contract-builder";
import {
  DEFAULT_MINIMUM_CAPABILITIES,
  DEFAULT_MINIMUM_CONTEXT_TOKENS,
  type AgentMinimumCapabilities,
} from "@/lib/routing/agent-capability-types";
import {
  capacityRoutingExclusionReason,
  type CapacitySnapshot,
} from "@/lib/routing/capacity-routing-exclude";
import { satisfiesMinimumDimensions } from "@/lib/routing/cost-ranking";
import {
  loadEndpointManifests,
  loadOverrides,
  loadPolicyRules,
} from "@/lib/routing/loader";
import {
  isValidTier,
  TIER_MINIMUM_DIMENSIONS,
} from "@/lib/routing/quality-tiers";
import type { RequestContract } from "@/lib/routing/request-contract";
import { routeEndpointV2 } from "@/lib/routing/pipeline-v2";
import { getTaskRequirement } from "@/lib/routing/task-requirements";
import type { TaskRequirement } from "@/lib/routing/task-router-types";
import type {
  EndpointManifest,
  EndpointOverride,
  PolicyRuleEval,
  SensitivityLevel,
} from "@/lib/routing/types";
import { TASK_TYPES } from "@/lib/task-types";

export type CoworkerRouteConfiguration = {
  agentId: string;
  sensitivity: string;
  minimumTier: string;
  pinnedProviderId: string | null;
  pinnedModelId: string | null;
  budgetClass: string;
  minimumCapabilities: unknown;
  minimumContextTokens: number | null;
};

export type CoworkerRoutingReadinessSnapshot = {
  endpoints: EndpointManifest[];
  policyRules: PolicyRuleEval[];
  overrides: EndpointOverride[];
  capacityByProvider: ReadonlyMap<string, CapacitySnapshot>;
  localOnlyInference: boolean;
  postureByAgent?: ReadonlyMap<string, DispatchPosture | null>;
  taskRequirement?: TaskRequirement | null;
  overridesByTaskType?: ReadonlyMap<string, EndpointOverride[]>;
  taskRequirementByTaskType?: ReadonlyMap<string, TaskRequirement | null>;
  loadError?: string;
};

export type CoworkerServiceReadinessProbe = {
  taskType: string;
  prompt: string;
  requiresToolUse: boolean;
};

export type CoworkerRouteReadiness = {
  ready: boolean;
  reason: string;
  providerId?: string;
  modelId?: string;
  /**
   * Worst-case check at the payload-screening escalation ceiling
   * (BI-E2CCFAC1). Present when the declared level was ready but real turns
   * can be escalated to a level with zero eligible endpoints — the false
   * green that let a "ready" coworker die on every real turn.
   */
  escalated?: {
    sensitivity: SensitivityLevel;
    ready: boolean;
    reason: string;
  };
};

const SENSITIVITY_LEVELS = new Set<SensitivityLevel>([
  "development",
  "public",
  "internal",
  "confidential",
  "restricted",
]);

const BUDGET_CLASSES = new Set<RequestContract["budgetClass"]>([
  "minimize_cost",
  "balanced",
  "quality_first",
]);
const REGISTERED_TASK_TYPES = new Set(
  TASK_TYPES.map((taskType) => taskType.id),
);

export async function loadCoworkerRoutingReadinessSnapshot(
  agentIds: readonly string[] = [],
  taskTypes: readonly string[] = ["conversation"],
): Promise<CoworkerRoutingReadinessSnapshot> {
  try {
    const requestedTaskTypes = [...new Set(["conversation", ...taskTypes])];
    const [
      endpoints,
      policyRules,
      capacityRows,
      localOnlyInference,
      postureByAgent,
    ] = await Promise.all([
      loadEndpointManifests(),
      loadPolicyRules(),
      prisma.providerCapacityStatus
        .findMany({
          select: { providerId: true, state: true, retryAt: true },
        }),
      getLocalOnlyInference(),
      resolveDispatchPostures(agentIds),
    ]);
    const taskInputs = await Promise.all(
      requestedTaskTypes.map(async (taskType) => {
        const [overrides, taskRequirement] = await Promise.all([
          loadOverrides(taskType),
          getTaskRequirement(taskType),
        ]);
        return [taskType, overrides, taskRequirement ?? null] as const;
      }),
    );
    const overridesByTaskType = new Map(
      taskInputs.map(([taskType, overrides]) => [taskType, overrides]),
    );
    const taskRequirementByTaskType = new Map(
      taskInputs.map(([taskType, , requirement]) => [taskType, requirement]),
    );

    return {
      endpoints,
      policyRules,
      overrides: overridesByTaskType.get("conversation") ?? [],
      capacityByProvider: new Map(
        capacityRows.map(
          (row: {
            providerId: string;
            state: string;
            retryAt: Date | null;
          }) => [
          row.providerId,
          {
            state: row.state,
            retryAtMs: row.retryAt?.getTime() ?? null,
          },
        ]),
      ),
      localOnlyInference,
      postureByAgent,
      taskRequirement:
        taskRequirementByTaskType.get("conversation") ?? null,
      overridesByTaskType,
      taskRequirementByTaskType,
    };
  } catch {
    return {
      endpoints: [],
      policyRules: [],
      overrides: [],
      capacityByProvider: new Map(),
      localOnlyInference: false,
      postureByAgent: new Map(),
      loadError:
        "Routing readiness could not be confirmed. Review AI readiness.",
    };
  }
}

export async function projectCoworkerRouteReadiness(
  config: CoworkerRouteConfiguration,
  snapshot: CoworkerRoutingReadinessSnapshot,
  probe: CoworkerServiceReadinessProbe = {
    taskType: "conversation",
    prompt: "Start a conversation.",
    requiresToolUse: false,
  },
): Promise<CoworkerRouteReadiness> {
  if (snapshot.loadError) {
    return blockedReadiness(snapshot.loadError);
  }

  const sensitivity = SENSITIVITY_LEVELS.has(
    config.sensitivity as SensitivityLevel,
  )
    ? (config.sensitivity as SensitivityLevel)
    : "internal";

  const declared = await evaluateReadinessAtSensitivity(
    config,
    snapshot,
    probe,
    sensitivity,
  );

  // BI-E2CCFAC1: the declared level is a FLOOR, not the level real turns run
  // at — payload screening escalates a turn carrying restricted-class content
  // (invoices, bank details, personal records) to "restricted" regardless of
  // what the agent declares. A coworker declared "confidential" handles exactly
  // that material daily, so its readiness promise must hold at the escalation
  // ceiling too. Evaluating only the declared level is how the catalog reported
  // "ready" for a Finance coworker whose every real turn died with zero
  // eligible endpoints.
  if (declared.ready && sensitivity === "confidential") {
    const ceiling = await evaluateReadinessAtSensitivity(
      config,
      snapshot,
      probe,
      "restricted",
    );
    if (!ceiling.ready) {
      return {
        ready: false,
        reason:
          "Ready at its declared level, but turns that touch restricted data — which payload screening escalates automatically — have no eligible model, so those turns will fail. Review AI readiness for the restricted data class.",
        escalated: {
          sensitivity: "restricted",
          ready: false,
          reason: ceiling.reason,
        },
      };
    }
  }

  return declared;
}

async function evaluateReadinessAtSensitivity(
  config: CoworkerRouteConfiguration,
  snapshot: CoworkerRoutingReadinessSnapshot,
  probe: CoworkerServiceReadinessProbe,
  sensitivity: SensitivityLevel,
): Promise<CoworkerRouteReadiness> {
  const minimumCapabilities = normalizeMinimumCapabilities(
    config.minimumCapabilities,
  );
  const minimumDimensions = isValidTier(config.minimumTier)
    ? TIER_MINIMUM_DIMENSIONS[config.minimumTier]
    : TIER_MINIMUM_DIMENSIONS.adequate;
  const budgetClass = BUDGET_CLASSES.has(
    config.budgetClass as RequestContract["budgetClass"],
  )
    ? (config.budgetClass as RequestContract["budgetClass"])
    : "balanced";
  const options = {
    taskType: probe.taskType,
    budgetClass,
    minimumDimensions,
    minimumCapabilities,
    agentMinimumContextTokens:
      config.minimumContextTokens ?? DEFAULT_MINIMUM_CONTEXT_TOKENS,
    agentId: config.agentId,
    ...(config.pinnedProviderId
      ? { preferredProviderId: config.pinnedProviderId }
      : {}),
    ...(config.pinnedModelId
      ? { preferredModelId: config.pinnedModelId }
      : {}),
  };
  const posture =
    snapshot.postureByAgent?.get(config.agentId) ?? null;
  const routeContext = buildInitialRouteContext({
    sensitivity,
    options,
    posture,
    localOnlyInference: snapshot.localOnlyInference,
  });
  const contract = await buildEffectiveRequestContract({
    taskType: probe.taskType,
    messages: [{ role: "user", content: probe.prompt }],
    tools: probe.requiresToolUse ? [{}] : [],
    routeContext,
    options,
    taskRequirement:
      snapshot.taskRequirementByTaskType?.get(probe.taskType) ??
      (probe.taskType === "conversation" ? snapshot.taskRequirement : null),
  });
  const decision = await routeEndpointV2(
    snapshot.endpoints,
    contract,
    snapshot.policyRules,
    snapshot.overridesByTaskType?.get(probe.taskType) ??
      (probe.taskType === "conversation" ? snapshot.overrides : []),
    {
      skipRecipe: true,
      capacityByProvider: snapshot.capacityByProvider,
      preferences: {
        ...(options.preferredProviderId
          ? { preferredProviderId: options.preferredProviderId }
          : {}),
        ...(options.preferredModelId
          ? { preferredModelId: options.preferredModelId }
          : {}),
      },
    },
  );
  const selected = decision.selectedEndpoint
    ? snapshot.endpoints.find(
        (endpoint) => endpoint.id === decision.selectedEndpoint,
      )
    : null;

  if (
    !selected ||
    !satisfiesMinimumDimensions(
      selected,
      contract.minimumDimensions,
    )
  ) {
    return blockedReadiness();
  }

  // Live dispatch degrades through a sole provider, but the directory makes a
  // stronger owner-facing promise: a provider known to need human repair is
  // not advertised as a conversation the user can start successfully.
  const capacityReason = capacityRoutingExclusionReason(
    snapshot.capacityByProvider.get(selected.providerId),
    Date.now(),
  );
  if (capacityReason) {
    return blockedReadiness(
      "The configured provider needs attention before this coworker can respond.",
    );
  }

  return {
    ready: true,
    reason: "A configured route satisfies this coworker's requirements.",
    providerId: selected.providerId,
    modelId: selected.modelId,
  };
}

export function parseCoworkerServiceReadinessProbe(
  metadata: unknown,
): CoworkerServiceReadinessProbe | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const probe = (metadata as Record<string, unknown>).readinessProbe;
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) {
    return null;
  }
  const value = probe as Record<string, unknown>;
  if (
    typeof value.taskType !== "string" ||
    value.taskType.trim().length === 0 ||
    !REGISTERED_TASK_TYPES.has(value.taskType.trim()) ||
    typeof value.prompt !== "string" ||
    value.prompt.trim().length === 0 ||
    typeof value.requiresToolUse !== "boolean"
  ) {
    return null;
  }
  return {
    taskType: value.taskType.trim(),
    prompt: value.prompt.trim(),
    requiresToolUse: value.requiresToolUse,
  };
}

function normalizeMinimumCapabilities(
  value: unknown,
): AgentMinimumCapabilities {
  if (value === null || value === undefined) {
    return DEFAULT_MINIMUM_CAPABILITIES;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_MINIMUM_CAPABILITIES;
  }
  return value as AgentMinimumCapabilities;
}

function blockedReadiness(
  reason = "No configured model satisfies this coworker's routing requirements.",
): CoworkerRouteReadiness {
  return {
    ready: false,
    reason,
  };
}

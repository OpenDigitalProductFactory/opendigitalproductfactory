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
  loadError?: string;
};

export type CoworkerRouteReadiness = {
  ready: boolean;
  reason: string;
  providerId?: string;
  modelId?: string;
};

const SENSITIVITY_LEVELS = new Set<SensitivityLevel>([
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

export async function loadCoworkerRoutingReadinessSnapshot(
  agentIds: readonly string[] = [],
): Promise<CoworkerRoutingReadinessSnapshot> {
  try {
    const [
      endpoints,
      policyRules,
      overrides,
      capacityRows,
      localOnlyInference,
      postureByAgent,
      taskRequirement,
    ] = await Promise.all([
      loadEndpointManifests(),
      loadPolicyRules(),
      loadOverrides("conversation"),
      prisma.providerCapacityStatus
        .findMany({
          select: { providerId: true, state: true, retryAt: true },
        }),
      getLocalOnlyInference(),
      resolveDispatchPostures(agentIds),
      getTaskRequirement("conversation"),
    ]);

    return {
      endpoints,
      policyRules,
      overrides,
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
      taskRequirement: taskRequirement ?? null,
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
): Promise<CoworkerRouteReadiness> {
  if (snapshot.loadError) {
    return blockedReadiness(snapshot.loadError);
  }

  const sensitivity = SENSITIVITY_LEVELS.has(
    config.sensitivity as SensitivityLevel,
  )
    ? (config.sensitivity as SensitivityLevel)
    : "internal";
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
    taskType: "conversation",
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
    taskType: "conversation",
    messages: [{ role: "user", content: "Start a conversation." }],
    tools: [{}],
    routeContext,
    options,
    taskRequirement: snapshot.taskRequirement,
  });
  const decision = await routeEndpointV2(
    snapshot.endpoints,
    contract,
    snapshot.policyRules,
    snapshot.overrides,
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

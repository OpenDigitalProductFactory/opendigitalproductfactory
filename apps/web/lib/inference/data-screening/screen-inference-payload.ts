import type { ChatMessage } from "@/lib/inference/ai-inference";
import type {
  DestinationClass,
  ProcessingPurposeKey,
} from "@/lib/govern/data/taxonomy";
import type { RequestContract } from "@/lib/routing/request-contract";
import type { ActivityContract } from "@/lib/routing/activity-contract";
import { classifyInferencePayload } from "./classify-payload";
import { evaluateInferenceDispatchPolicy } from "./evaluate-inference-policy";
import type {
  GovernedPayloadHint,
  InferenceDataScreenResult,
  InferencePayloadSensitivity,
} from "./types";

const DEFAULT_ORGANIZATION_ID = "org:local-install";

const SENSITIVITY_RANK: Readonly<Record<RequestContract["sensitivity"], number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

type ScreenRouteContextInput = Partial<InferenceDataScreenResult["routeContext"]> & {
  sensitivity?: string;
};

export type ScreenInferencePayloadInput = {
  organizationId?: string | null;
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: Array<Record<string, unknown>>;
  taskType?: string;
  routeContext?: ScreenRouteContextInput;
  activityContract?: ActivityContract;
  governedData?: readonly GovernedPayloadHint[];
  destinationClass?: DestinationClass;
  purpose?: ProcessingPurposeKey | string;
};

export function screenInferencePayload(
  input: ScreenInferencePayloadInput,
): InferenceDataScreenResult {
  const governedData = mergeGovernedHints(
    input.governedData,
    hintsFromActivity(input.activityContract),
  );
  const classification = classifyInferencePayload({
    messages: input.messages,
    systemPrompt: input.systemPrompt,
    tools: input.tools,
    taskType: input.taskType,
    governedData,
  });
  const destinationClass = input.destinationClass ?? "external-service";
  const policy = evaluateInferenceDispatchPolicy({
    organizationId: input.organizationId ?? DEFAULT_ORGANIZATION_ID,
    classification,
    governedData,
    destinationClass,
    purpose: input.purpose,
  });

  const originalSensitivity = normalizeSensitivity(input.routeContext?.sensitivity);
  const sensitivity = strongestSensitivity(originalSensitivity, classification.overallSensitivity);
  const routeEffect = policy.effect === "deny" || policy.effect === "review"
    ? "local-only"
    : "allow";
  const residencyPolicy = routeEffect === "local-only"
    ? stricterResidency(input.routeContext?.residencyPolicy, "local_only")
    : input.routeContext?.residencyPolicy;

  return {
    routeContext: {
      sensitivity,
      ...(input.routeContext?.allowedProviders !== undefined
        ? { allowedProviders: normalizeProviderIds(input.routeContext.allowedProviders) }
        : {}),
      ...(input.routeContext?.deniedProviders !== undefined
        ? { deniedProviders: normalizeProviderIds(input.routeContext.deniedProviders) }
        : {}),
      ...(residencyPolicy !== undefined ? { residencyPolicy } : {}),
    },
    receipt: {
      schemaVersion: "inference-data-screen/v1",
      screenId: classification.receipt.screenId,
      decisionIds: policy.decisionIds,
      inputHash: classification.receipt.inputHash,
      classifiedDataClasses: policy.classifiedDataClasses,
      policyEffect: policy.effect,
      routeEffect,
      destinationClass,
      transformation: classification.receipt.transformation,
      explanationCodes: policy.explanationCodes,
      obligationKinds: policy.obligations.map((obligation) => obligation.kind).sort(),
      rawPayloadStored: false,
    },
  };
}

function normalizeSensitivity(value: string | undefined): RequestContract["sensitivity"] {
  return value === "public" ||
    value === "internal" ||
    value === "confidential" ||
    value === "restricted"
    ? value
    : "internal";
}

function strongestSensitivity(
  left: RequestContract["sensitivity"],
  right: InferencePayloadSensitivity,
): RequestContract["sensitivity"] {
  return SENSITIVITY_RANK[left] >= SENSITIVITY_RANK[right] ? left : right;
}

function stricterResidency(
  left: RequestContract["residencyPolicy"] | undefined,
  right: NonNullable<RequestContract["residencyPolicy"]>,
): NonNullable<RequestContract["residencyPolicy"]> {
  const rank = { any_enabled: 0, approved_cloud: 1, local_only: 2 } as const;
  const current = left ?? "any_enabled";
  return rank[current] >= rank[right] ? current : right;
}

function normalizeProviderIds(providerIds: readonly string[]): string[] {
  return [...new Set(providerIds.map((providerId) => providerId.trim()).filter(Boolean))].sort();
}

function hintsFromActivity(activity: ActivityContract | undefined): GovernedPayloadHint[] {
  if (!activity?.governedData) return [];
  const data = activity.governedData;
  return data.assetIds.map((assetId) => ({
    assetId,
    fieldIds: data.fieldIds,
    classificationKnown: false,
    purpose: data.processingPurpose,
  }));
}

function mergeGovernedHints(
  first: readonly GovernedPayloadHint[] | undefined,
  second: readonly GovernedPayloadHint[],
): GovernedPayloadHint[] | undefined {
  const merged = [...(first ?? []), ...second];
  return merged.length > 0 ? merged : undefined;
}

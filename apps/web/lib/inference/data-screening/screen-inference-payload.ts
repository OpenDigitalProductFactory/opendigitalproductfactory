import type { ChatMessage } from "@/lib/inference/ai-inference";
import type {
  DestinationClass,
  ProcessingPurposeKey,
} from "@/lib/govern/data/taxonomy";
import type { RequestContract } from "@/lib/routing/request-contract";
import type { ActivityContract } from "@/lib/routing/activity-contract";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { classifyInferencePayload } from "./classify-payload";
import { evaluateInferenceDispatchPolicy } from "./evaluate-inference-policy";
import type {
  GovernedPayloadHint,
  InferenceDataScreenReceipt,
  InferenceDataScreenResult,
  InferencePayloadSensitivity,
  InferencePolicyVersionSnapshot,
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
  /**
   * Reads live asset/classification/authority versions. The callback is ephemeral
   * and invoked again at the final dispatch seam; it is never persisted.
   */
  policyVersionSource?: () => Partial<InferencePolicyVersionSnapshot>;
  /** Safe evidence that a prior PDP-authorized projection transform was applied. */
  appliedTransformation?: {
    transformation: "masked" | "tokenized";
    decisionIds: string[];
    decisionVersions: InferenceDataScreenReceipt["decisionVersions"];
    classifiedDataClasses: InferenceDataScreenReceipt["classifiedDataClasses"];
    explanationCodes: string[];
    obligationKinds: string[];
  };
  /** Recomputes the safe source-transform authority at final dispatch. */
  appliedTransformationSource?: () => NonNullable<
    ScreenInferencePayloadInput["appliedTransformation"]
  >;
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
  const policyVersions = input.policyVersionSource?.();
  const prior = input.appliedTransformationSource?.() ?? input.appliedTransformation;
  const policy = evaluateInferenceDispatchPolicy({
    organizationId: input.organizationId ?? DEFAULT_ORGANIZATION_ID,
    classification,
    governedData,
    destinationClass,
    purpose: input.purpose,
    assetVersion: policyVersions?.assetVersion,
    classificationVersion: policyVersions?.classificationVersion,
    authorityVersion: policyVersions?.authorityVersion,
    policyBundleVersion: policyVersions?.policyBundleVersion,
    transformation: prior?.transformation ?? "none",
  });

  const originalSensitivity = normalizeSensitivity(input.routeContext?.sensitivity);
  // A verified projection transform changes the payload being routed, not the
  // source/output classification retained in the receipt. Caller sensitivity
  // is still a floor and can never be lowered here.
  const routedPayloadSensitivity = prior
    ? "internal"
    : classification.overallSensitivity;
  const sensitivity = strongestSensitivity(originalSensitivity, routedPayloadSensitivity);
  const maskRequired = policy.obligations.some((obligation) => obligation.kind === "mask");
  const routeEffect = policy.effect === "deny" ||
    policy.effect === "review" ||
    (maskRequired && !prior)
    ? "local-only"
    : "allow";
  const residencyPolicy = routeEffect === "local-only"
    ? stricterResidency(input.routeContext?.residencyPolicy, "local_only")
    : input.routeContext?.residencyPolicy;
  const allowedProviders = input.routeContext?.allowedProviders === undefined
    ? undefined
    : localOnlyAllowedProviders(
        normalizeProviderIds(input.routeContext.allowedProviders),
        routeEffect,
      );

  return {
    routeContext: {
      sensitivity,
      ...(allowedProviders !== undefined ? { allowedProviders } : {}),
      ...(input.routeContext?.deniedProviders !== undefined
        ? { deniedProviders: normalizeProviderIds(input.routeContext.deniedProviders) }
        : {}),
      ...(residencyPolicy !== undefined ? { residencyPolicy } : {}),
    },
    receipt: {
      schemaVersion: "inference-data-screen/v1",
      screenId: classification.receipt.screenId,
      decisionIds: uniqueSorted([...(prior?.decisionIds ?? []), ...policy.decisionIds]),
      decisionVersions: uniqueDecisionVersions([
        ...(prior?.decisionVersions ?? []),
        ...policy.decisions.map((decision) => ({
          decisionId: decision.decisionId,
          assetVersion: decision.assetVersion,
          classificationVersion: decision.classificationVersion,
          authorityVersion: decision.authorityVersion,
        })),
      ]),
      inputHash: classification.receipt.inputHash,
      classifiedDataClasses: uniqueSorted([
        ...(prior?.classifiedDataClasses ?? []),
        ...policy.classifiedDataClasses,
      ]),
      policyEffect: policy.effect,
      routeEffect,
      destinationClass,
      transformation: prior?.transformation ?? classification.receipt.transformation,
      explanationCodes: uniqueSorted([
        ...(prior?.explanationCodes ?? []),
        ...policy.explanationCodes,
      ]),
      obligationKinds: uniqueSorted([
        ...(prior?.obligationKinds ?? []),
        ...policy.obligations.map((obligation) => obligation.kind),
      ]),
      rawPayloadStored: false,
    },
    classification,
    decisions: policy.decisions,
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

function localOnlyAllowedProviders(
  providerIds: string[],
  routeEffect: InferenceDataScreenResult["receipt"]["routeEffect"],
): string[] {
  return routeEffect === "local-only"
    ? providerIds.filter(isLocalProviderId)
    : providerIds;
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

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniqueDecisionVersions(
  versions: InferenceDataScreenReceipt["decisionVersions"],
): InferenceDataScreenReceipt["decisionVersions"] {
  return [...new Map(versions.map((version) => [version.decisionId, version])).values()]
    .sort((a, b) => a.decisionId.localeCompare(b.decisionId));
}

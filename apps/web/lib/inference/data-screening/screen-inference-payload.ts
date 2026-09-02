import type { ChatMessage } from "@/lib/inference/ai-inference";
import type {
  DestinationClass,
  ProcessingPurposeKey,
} from "@/lib/govern/data/taxonomy";
import type { RequestContract } from "@/lib/routing/request-contract";
import type { ActivityContract } from "@/lib/routing/activity-contract";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { classifyInferencePayload, isVocabularyOnlyEvidence } from "./classify-payload";
import { evaluateInferenceDispatchPolicy } from "./evaluate-inference-policy";
import type {
  GovernedPayloadHint,
  InferenceDataScreenReceipt,
  InferenceDataScreenResult,
  InferencePayloadSensitivity,
  InferenceMatchProvenance,
  InferencePolicyVersionSnapshot,
} from "./types";
import { hasVerticalPolicyPacks } from "./vertical-policy-packs";
import { SENSITIVITY_RANK } from "./sensitivity-rank";

const DEFAULT_ORGANIZATION_ID = "org:local-install";

/** Collapse repeat matches of the same rule at the same path; a payload that
 *  trips one rule fifty times needs one provenance row, not fifty. */
function dedupeMatchProvenance(
  rows: readonly InferenceMatchProvenance[],
): InferenceMatchProvenance[] {
  const seen = new Map<string, InferenceMatchProvenance>();
  for (const row of rows) {
    const key = `${row.dataClass}|${row.path}|${row.reason}|${row.confidence}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()].sort((a, b) =>
    a.dataClass.localeCompare(b.dataClass) || a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason),
  );
}

// Shared with the drift rollup, which must agree on what "above" means when it
// decides whether a declared route label sits higher than its measured payload.


type ScreenRouteContextInput = Partial<InferenceDataScreenResult["routeContext"]> & {
  sensitivity?: string;
};

export type ScreenInferencePayloadInput = {
  organizationId?: string | null;
  messages: ChatMessage[];
  systemPrompt: string;
  /** Platform-authored instruction spans within `systemPrompt` (BI-463BE12A). */
  systemPromptInstructionSpans?: string[];
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
    systemPromptInstructionSpans: input.systemPromptInstructionSpans,
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

  const originalSensitivity = normalizeRoutingSensitivity(input.routeContext?.sensitivity);
  const declaredPayloadSensitivity = originalSensitivity === "development"
    ? "public"
    : originalSensitivity;
  // A verified projection transform changes the payload being routed, not the
  // source/output classification retained in the receipt. Caller sensitivity
  // is still a floor and can never be lowered here.
  const routedPayloadSensitivity = prior
    ? "internal"
    : originalSensitivity === "development" &&
        governedData === undefined &&
        classification.dataClasses.every((dataClass) => dataClass === "source-code")
      ? "public"
      : classification.overallSensitivity;
  const sensitivity = strongestSensitivity(originalSensitivity, routedPayloadSensitivity);
  const maskRequired = policy.obligations.some((obligation) => obligation.kind === "mask");
  // A mask obligation clamps the turn local so nothing leaves unredacted. That
  // is right whenever there is something to redact — and a no-op when the only
  // evidence is corroboration-gated vocabulary, because a domain was named and
  // no value was found. Clamping then protects nothing and makes a coworker
  // unreachable for its own subject: asking for help with payroll measured
  // confidential, attached a mask with nothing to mask, and fenced the turn
  // (BI-67CAF494, RouteDecisionLog screen_2781e0797c3307ed).
  //
  // Narrow by construction. One precise match, any declared governed hint, or a
  // deny/review effect and the clamp stands.
  const maskHasNothingToRedact =
    maskRequired && isVocabularyOnlyEvidence(classification.matches, input.governedData);
  const routeEffect = policy.effect === "deny" ||
    policy.effect === "review" ||
    (maskRequired && !prior && !maskHasNothingToRedact)
    ? "local-only"
    : "allow";
  const residencyPolicy = routeEffect === "local-only"
    ? stricterResidency(input.routeContext?.residencyPolicy, "local_only")
    : prior && hasVerticalPolicyPacks(policy.classifiedDataClasses)
      ? stricterResidency(input.routeContext?.residencyPolicy, "approved_cloud")
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
      policyPackVersions: policy.policyPackVersions,
      // Path + rule + confidence only — never the matched value, so the receipt
      // stays rawPayloadStored:false while a local-only verdict becomes
      // diagnosable from the record instead of by re-deriving the payload.
      matchProvenance: dedupeMatchProvenance(
        classification.matches.map((match) => ({
          dataClass: match.dataClass,
          path: match.path,
          reason: match.reason,
          confidence: match.confidence,
        })),
      ),
      // The declared route label is a floor (strongestSensitivity above), so a
      // route can route above what its payload measures. Recording both sides
      // — plus whether the floor actually bound — makes that drift visible in
      // the record instead of only re-derivable by re-composing the payload.
      // Levels, never values: rawPayloadStored stays false.
      //
      // declaredSensitivity is the business-data floor applied by screening.
      // `development` stays available to endpoint routing, but maps to `public`
      // here because it is not itself a business-data confidentiality level.
      measuredSensitivity: routedPayloadSensitivity,
      declaredSensitivity: declaredPayloadSensitivity,
      sensitivityFloorApplied: sensitivity !== routedPayloadSensitivity,
      rawPayloadStored: false,
    },
    classification,
    decisions: policy.decisions,
  };
}

function normalizeRoutingSensitivity(value: string | undefined): RequestContract["sensitivity"] {
  if (value === "development") return value;
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
  if (left === "development") {
    return right === "public" ? "development" : right;
  }
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

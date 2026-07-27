import {
  ALL_PROCESSING_PURPOSES,
  EFFECT_RANK,
  isDataAssetId,
  isDataFieldId,
  type DataCategory,
  type DataEffect,
  type DataAssetId,
  type DataFieldId,
  type DataProtectionTransformation,
  type DestinationClass,
  type ProcessingPurposeKey,
} from "@/lib/govern/data/taxonomy";
import {
  evaluateDataPolicy,
  type DataPolicyDecision,
  type PolicyEvaluationContext,
} from "@/lib/govern/data/policy-decision";
import {
  DATA_EXECUTABLE_POLICIES,
  type DataExecutablePolicy,
  type DataObligation,
} from "@/lib/govern/data/executable-policies";
import { assertObligationsEnforceable, PepCapabilityError } from "@/lib/govern/data/policy-enforcement";
import { aiWorkloadDataBindingFor } from "@/lib/routing/provider-suitability/workload-profile";
import type {
  GovernedPayloadHint,
  InferenceDataClass,
  InferencePayloadClassification,
} from "./types";
import {
  getVerticalSensitiveDataPolicyPack,
  policyPackVersionsForClasses,
  verticalSensitiveDataPoliciesForClasses,
} from "./vertical-policy-packs";

const DEFAULT_SYNTHETIC_ASSET: DataAssetId = "data:inference-payload";
const DEFAULT_VERSION = "screen-v1";

const DATA_CLASS_CATEGORIES: Readonly<Record<InferenceDataClass, readonly DataCategory[]>> = {
  "customer-records": ["identity", "contact", "operational"],
  "employee-records": ["identity", "personal-attribute", "financial", "operational"],
  "payments-finance": ["financial", "operational"],
  "health-phi": ["identity", "personal-attribute", "operational"],
  "student-records": ["identity", "personal-attribute", "operational"],
  "legal-privileged": ["content", "operational"],
  "security-logs": ["telemetry", "security-audit"],
  "criminal-justice": ["identity", "security-audit", "operational"],
  "safety-sensitive": ["identity", "personal-attribute", "operational"],
  "youth-sensitive": ["identity", "contact", "personal-attribute", "content"],
  "public-sector-records": ["identity", "operational"],
  "regulated-decisioning": ["derived-analytic", "operational"],
  "source-code": ["content", "configuration"],
  "secrets-credentials": ["credential-secret"],
  "unknown-governed-data": ["operational"],
};

export type InferencePolicyEvaluationInput = {
  organizationId: string;
  classification: InferencePayloadClassification;
  governedData?: readonly GovernedPayloadHint[];
  destinationClass: DestinationClass;
  purpose?: ProcessingPurposeKey | string;
  environmentKnown?: boolean;
  assetVersion?: string;
  classificationVersion?: string;
  authorityVersion?: string;
  policyBundleVersion?: string;
  policies?: readonly DataExecutablePolicy[];
  transformation?: DataProtectionTransformation;
};

export type InferencePolicyEvaluation = {
  pepKind: "inference-dispatch";
  effect: DataEffect;
  obligations: DataObligation[];
  decisionIds: string[];
  decisions: DataPolicyDecision[];
  explanationCodes: string[];
  classifiedDataClasses: InferenceDataClass[];
  destinationClass: DestinationClass;
  policyPackVersions: string[];
};

export function evaluateInferenceDispatchPolicy(
  input: InferencePolicyEvaluationInput,
): InferencePolicyEvaluation {
  const classifiedDataClasses = [...input.classification.dataClasses];
  const hasGovernedHints = Boolean(input.governedData?.length);
  const needsPdp =
    classifiedDataClasses.length > 0 ||
    hasGovernedHints ||
    input.classification.overallSensitivity === "confidential" ||
    input.classification.overallSensitivity === "restricted";

  if (!needsPdp) {
    return {
      pepKind: "inference-dispatch",
      effect: "allow",
      obligations: [],
      decisionIds: [],
      decisions: [],
      explanationCodes: ["no-governed-payload-detected"],
      classifiedDataClasses,
      destinationClass: input.destinationClass,
      policyPackVersions: [],
    };
  }

  const policyPackVersions = input.policies
    ? []
    : policyPackVersionsForClasses(classifiedDataClasses);
  const policies = input.policies ?? [
    ...DATA_EXECUTABLE_POLICIES,
    ...verticalSensitiveDataPoliciesForClasses(classifiedDataClasses),
  ];
  const decisions = buildPolicyContexts(input).map((ctx) =>
    evaluateDataPolicy(ctx, policies)
  );
  const effect = strongestInferencePolicyEffect(decisions.map((decision) => decision.effect));
  const obligations = effect === "deny" || effect === "review"
    ? []
    : uniqueObligations(decisions.flatMap((decision) => decision.obligations));
  try {
    assertObligationsEnforceable("inference-dispatch", obligations);
  } catch (error) {
    if (error instanceof PepCapabilityError) {
      return {
        pepKind: "inference-dispatch",
        effect: "deny",
        obligations: [],
        decisionIds: decisions.map((decision) => decision.decisionId),
        decisions,
        explanationCodes: uniqueSorted([
          ...decisions.map((decision) => decision.explanationCode),
          "inference-pep-obligation-unenforceable",
        ]),
        classifiedDataClasses,
        destinationClass: input.destinationClass,
        policyPackVersions,
      };
    }
    throw error;
  }

  return {
    pepKind: "inference-dispatch",
    effect,
    obligations,
    decisionIds: decisions.map((decision) => decision.decisionId),
    decisions,
    explanationCodes: uniqueSorted(decisions.map((decision) => decision.explanationCode)),
    classifiedDataClasses,
    destinationClass: input.destinationClass,
    policyPackVersions,
  };
}

function buildPolicyContexts(
  input: InferencePolicyEvaluationInput,
): PolicyEvaluationContext[] {
  if (input.classification.dataClasses.length === 0) {
    return [buildPolicyContext(input)];
  }
  return uniqueSorted(input.classification.dataClasses).map((dataClass) => {
    const pack = getVerticalSensitiveDataPolicyPack(dataClass);
    const binding = dataClass === "unknown-governed-data"
      ? pack
      : aiWorkloadDataBindingFor(dataClass);
    return buildPolicyContext(input, {
      asset: pack.assetId,
      sensitivity: binding.sensitivity,
      categories: binding.categories,
      classificationKnown: dataClass !== "unknown-governed-data",
    });
  });
}

function buildPolicyContext(
  input: InferencePolicyEvaluationInput,
  override?: {
    asset: DataAssetId;
    sensitivity: InferencePayloadClassification["overallSensitivity"];
    categories: readonly DataCategory[];
    classificationKnown: boolean;
  },
): PolicyEvaluationContext {
  const governedData = input.governedData ?? [];
  const governedAssetId = governedData
    .map((hint) => hint.assetId)
    .find((assetId): assetId is DataAssetId => Boolean(assetId && isDataAssetId(assetId)));
  const asset = override?.asset ?? governedAssetId ?? DEFAULT_SYNTHETIC_ASSET;
  const fields = uniqueSorted(
    governedData.flatMap((hint) => hint.fieldIds ?? []).filter(isDataFieldId),
  ) as DataFieldId[];
  const classificationKnown = (override?.classificationKnown ?? true) &&
    !input.classification.dataClasses.includes("unknown-governed-data") &&
    !governedData.some((hint) => !hint.classificationKnown);

  return {
    organizationId: input.organizationId,
    action: input.destinationClass === "external-service" ? "export" : "project",
    asset,
    fields,
    purpose: resolvePurpose(input.purpose, governedData),
    destination: input.destinationClass,
    transformation: input.transformation ?? "none",
    classification: {
      known: classificationKnown,
      sensitivity: override?.sensitivity ?? input.classification.overallSensitivity,
      categories: override?.categories
        ? [...override.categories]
        : categoriesForClasses(input.classification.dataClasses),
    },
    environmentKnown: input.environmentKnown ?? true,
    assetVersion: input.assetVersion ?? DEFAULT_VERSION,
    classificationVersion: input.classificationVersion ?? input.classification.receipt.inputHash,
    authorityVersion: input.authorityVersion ?? DEFAULT_VERSION,
    policyBundleVersion: input.policyBundleVersion ?? DEFAULT_VERSION,
  };
}

function resolvePurpose(
  explicitPurpose: ProcessingPurposeKey | string | undefined,
  governedData: readonly GovernedPayloadHint[],
): ProcessingPurposeKey {
  const candidate = explicitPurpose ?? governedData.find((hint) => hint.purpose)?.purpose;
  return isProcessingPurpose(candidate) ? candidate : "coworker-assistance";
}

function isProcessingPurpose(value: unknown): value is ProcessingPurposeKey {
  return typeof value === "string" && ALL_PROCESSING_PURPOSES.includes(value as ProcessingPurposeKey);
}

function categoriesForClasses(dataClasses: readonly InferenceDataClass[]): DataCategory[] {
  return uniqueSorted(dataClasses.flatMap((dataClass) => DATA_CLASS_CATEGORIES[dataClass] ?? []));
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniqueObligations(obligations: readonly DataObligation[]): DataObligation[] {
  const byCanonicalValue = new Map<string, DataObligation>();
  for (const obligation of obligations) {
    const key = JSON.stringify(canonicalize(obligation));
    byCanonicalValue.set(key, obligation);
  }
  return [...byCanonicalValue.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, obligation]) => obligation);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function strongestInferencePolicyEffect(
  effects: readonly DataEffect[],
): DataEffect {
  return effects.reduce<DataEffect>((strongest, effect) =>
    EFFECT_RANK[effect] > EFFECT_RANK[strongest] ? effect : strongest,
  "allow");
}

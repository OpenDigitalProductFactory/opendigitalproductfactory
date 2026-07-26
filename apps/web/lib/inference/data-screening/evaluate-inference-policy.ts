import {
  ALL_PROCESSING_PURPOSES,
  EFFECT_RANK,
  isDataAssetId,
  isDataFieldId,
  type DataCategory,
  type DataEffect,
  type DataAssetId,
  type DataFieldId,
  type DestinationClass,
  type ProcessingPurposeKey,
} from "@/lib/govern/data/taxonomy";
import {
  evaluateDataPolicy,
  type DataPolicyDecision,
  type PolicyEvaluationContext,
} from "@/lib/govern/data/policy-decision";
import type { DataExecutablePolicy, DataObligation } from "@/lib/govern/data/executable-policies";
import { assertObligationsEnforceable, PepCapabilityError } from "@/lib/govern/data/policy-enforcement";
import type {
  GovernedPayloadHint,
  InferenceDataClass,
  InferencePayloadClassification,
} from "./types";

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
    };
  }

  const ctx = buildPolicyContext(input);
  const decision = evaluateDataPolicy(ctx, input.policies);
  try {
    assertObligationsEnforceable("inference-dispatch", decision.obligations);
  } catch (error) {
    if (error instanceof PepCapabilityError) {
      return {
        pepKind: "inference-dispatch",
        effect: "deny",
        obligations: [],
        decisionIds: [decision.decisionId],
        decisions: [decision],
        explanationCodes: [decision.explanationCode, "inference-pep-obligation-unenforceable"],
        classifiedDataClasses,
        destinationClass: input.destinationClass,
      };
    }
    throw error;
  }

  return {
    pepKind: "inference-dispatch",
    effect: decision.effect,
    obligations: decision.obligations,
    decisionIds: [decision.decisionId],
    decisions: [decision],
    explanationCodes: [decision.explanationCode],
    classifiedDataClasses,
    destinationClass: input.destinationClass,
  };
}

function buildPolicyContext(input: InferencePolicyEvaluationInput): PolicyEvaluationContext {
  const governedData = input.governedData ?? [];
  const governedAssetId = governedData
    .map((hint) => hint.assetId)
    .find((assetId): assetId is DataAssetId => Boolean(assetId && isDataAssetId(assetId)));
  const asset = governedAssetId ?? DEFAULT_SYNTHETIC_ASSET;
  const fields = uniqueSorted(
    governedData.flatMap((hint) => hint.fieldIds ?? []).filter(isDataFieldId),
  ) as DataFieldId[];
  const classificationKnown =
    !input.classification.dataClasses.includes("unknown-governed-data") &&
    !governedData.some((hint) => !hint.classificationKnown);

  return {
    organizationId: input.organizationId,
    action: input.destinationClass === "external-service" ? "export" : "project",
    asset,
    fields,
    purpose: resolvePurpose(input.purpose, governedData),
    destination: input.destinationClass,
    classification: {
      known: classificationKnown,
      sensitivity: input.classification.overallSensitivity,
      categories: categoriesForClasses(input.classification.dataClasses),
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

export function strongestInferencePolicyEffect(
  effects: readonly DataEffect[],
): DataEffect {
  return effects.reduce<DataEffect>((strongest, effect) =>
    EFFECT_RANK[effect] > EFFECT_RANK[strongest] ? effect : strongest,
  "allow");
}

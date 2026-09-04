import type {
  DataCategory,
  DataEffect,
  DataAssetId,
  DataSensitivity,
} from "@/lib/govern/data/taxonomy";
import type {
  DataExecutablePolicy,
  DataObligation,
} from "@/lib/govern/data/executable-policies";
import {
  aiWorkloadDataBindingFor,
} from "@/lib/routing/provider-suitability/workload-profile";
import type { InferenceDataClass } from "./types";

type PublicProviderEligibility =
  | "never"
  | "protected-only"
  | "approved-with-evidence";

export type VerticalSensitiveDataPolicyPack = {
  id: string;
  version: string;
  dataClass: InferenceDataClass;
  assetId: DataAssetId;
  sensitivity: DataSensitivity;
  categories: DataCategory[];
  applicableArchetypeCategories: string[];
  publicProviderEligibility: PublicProviderEligibility;
  protectedExternalEffect: Extract<DataEffect, "allow-with-obligations" | "review" | "deny">;
  maskingEligibility: "allowed" | "conditional" | "prohibited";
  retentionPromptCode: string;
  refusalCode: string;
  requiredProviderEvidence: string[];
  /**
   * Whether an UNTRANSFORMED payload of this class may leave for an external
   * service, or whether it must be masked/tokenized first (BI-35FAE2DB follow-up).
   *
   * Default is `requires-transformation` — the conservative platform stance, and
   * what every regulated class keeps. `permitted` is for classes where masking
   * destroys the very thing being sent, so the protection is CONTRACTUAL
   * (the pack's requiredProviderEvidence: no-training / zero-retention) rather
   * than transformational. Source code is the case: you cannot review masked
   * code. Without this, a pack could declare `allow-with-obligations` and still
   * deny every real payload, because the generated policy only matched
   * transformations the class never undergoes.
   */
  untransformedExternalExport: "permitted" | "requires-transformation";
  authorityRefs: string[];
  policies: DataExecutablePolicy[];
};

type PackDefinition = Omit<
  VerticalSensitiveDataPolicyPack,
  "assetId" | "sensitivity" | "categories" | "policies"
> & {
  dataClass: Exclude<InferenceDataClass, "unknown-governed-data">;
};

const AUTHORITY = {
  hhsHipaa: "https://www.hhs.gov/hipaa/for-professionals/security/index.html",
  ftcSafeguards: "https://www.ftc.gov/legal-library/browse/rules/safeguards-rule",
  ftcDataSecurity: "https://www.ftc.gov/business-guidance/privacy-security/data-security",
  fbiCjis: "https://www.fbi.gov/services/cjis",
  ferpa: "https://studentprivacy.ed.gov/ferpa",
  coppa: "https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions",
  eeocAda: "https://www.eeoc.gov/laws/guidance/ada-primer-small-business",
  abaConfidentiality:
    "https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_6_confidentiality_of_information/",
  nistAiRmf:
    "https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10",
  nistControls: "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
} as const;

const DEFINITIONS: readonly PackDefinition[] = [
  {
    id: "vertical-customer-records",
    version: "1.0.0",
    dataClass: "customer-records",
    applicableArchetypeCategories: ["*"],
    publicProviderEligibility: "protected-only",
    protectedExternalEffect: "allow-with-obligations",
    maskingEligibility: "allowed",
    retentionPromptCode: "retention-customer-purpose-limited",
    refusalCode: "boundary-customer-protection-required",
    requiredProviderEvidence: ["no-training", "retention-reviewed", "contract-reviewed"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.ftcDataSecurity, AUTHORITY.nistControls],
  },
  {
    id: "vertical-employee-records",
    version: "1.0.0",
    dataClass: "employee-records",
    applicableArchetypeCategories: ["*"],
    publicProviderEligibility: "approved-with-evidence",
    protectedExternalEffect: "allow-with-obligations",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-employee-need-to-know",
    refusalCode: "boundary-employee-authorization-required",
    requiredProviderEvidence: ["no-training", "access-controls", "contract-reviewed"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.eeocAda, AUTHORITY.nistControls],
  },
  {
    id: "vertical-payments-finance",
    version: "1.0.0",
    dataClass: "payments-finance",
    applicableArchetypeCategories: ["banking-financial-services", "professional-services"],
    publicProviderEligibility: "approved-with-evidence",
    protectedExternalEffect: "allow-with-obligations",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-financial-schedule-required",
    refusalCode: "boundary-financial-safeguards-required",
    requiredProviderEvidence: ["financial-customer-info-reviewed", "encryption", "contract-reviewed"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.ftcSafeguards, AUTHORITY.nistControls],
  },
  {
    id: "vertical-health-phi",
    version: "1.0.0",
    dataClass: "health-phi",
    applicableArchetypeCategories: ["healthcare-wellness"],
    publicProviderEligibility: "approved-with-evidence",
    protectedExternalEffect: "allow-with-obligations",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-clinical-schedule-required",
    refusalCode: "boundary-health-safeguards-required",
    requiredProviderEvidence: ["baa-on-file", "no-training", "regional-processing"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.hhsHipaa, AUTHORITY.nistControls],
  },
  {
    id: "vertical-student-records",
    version: "1.0.0",
    dataClass: "student-records",
    applicableArchetypeCategories: ["education-training"],
    publicProviderEligibility: "approved-with-evidence",
    protectedExternalEffect: "allow-with-obligations",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-student-purpose-limited",
    refusalCode: "boundary-student-disclosure-authority-required",
    requiredProviderEvidence: ["student-data-terms-reviewed", "no-training", "access-controls"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.ferpa, AUTHORITY.nistControls],
  },
  {
    id: "vertical-youth-sensitive",
    version: "1.0.0",
    dataClass: "youth-sensitive",
    applicableArchetypeCategories: ["education-training", "healthcare-wellness"],
    publicProviderEligibility: "never",
    protectedExternalEffect: "review",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-youth-minimize",
    refusalCode: "boundary-youth-human-authorization-required",
    requiredProviderEvidence: ["verified-parental-or-authorized-role", "purpose-reviewed"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.coppa, AUTHORITY.ferpa],
  },
  {
    id: "vertical-legal-privileged",
    version: "1.0.0",
    dataClass: "legal-privileged",
    applicableArchetypeCategories: ["professional-services"],
    publicProviderEligibility: "never",
    protectedExternalEffect: "review",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-legal-hold-aware",
    refusalCode: "boundary-legal-role-review-required",
    requiredProviderEvidence: ["legal-role-authorized", "confidentiality-terms-reviewed"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.abaConfidentiality, AUTHORITY.nistControls],
  },
  {
    id: "vertical-criminal-justice",
    version: "1.0.0",
    dataClass: "criminal-justice",
    applicableArchetypeCategories: ["public-sector", "security-services"],
    publicProviderEligibility: "never",
    protectedExternalEffect: "deny",
    maskingEligibility: "prohibited",
    retentionPromptCode: "retention-cjis-governed",
    refusalCode: "boundary-cjis-governed-environment-required",
    requiredProviderEvidence: ["cjis-boundary-approved"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.fbiCjis, AUTHORITY.nistControls],
  },
  {
    id: "vertical-safety-sensitive",
    version: "1.0.0",
    dataClass: "safety-sensitive",
    applicableArchetypeCategories: ["healthcare-wellness", "public-sector", "security-services"],
    publicProviderEligibility: "never",
    protectedExternalEffect: "review",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-safety-case-controlled",
    refusalCode: "boundary-safety-human-checkpoint-required",
    requiredProviderEvidence: ["accountable-human-owner", "purpose-reviewed"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.nistAiRmf, AUTHORITY.nistControls],
  },
  {
    id: "vertical-public-sector-records",
    version: "1.0.0",
    dataClass: "public-sector-records",
    applicableArchetypeCategories: ["public-sector"],
    publicProviderEligibility: "never",
    protectedExternalEffect: "review",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-public-record-schedule-required",
    refusalCode: "boundary-agency-purpose-review-required",
    requiredProviderEvidence: ["agency-purpose-authorized", "regional-processing"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.nistControls],
  },
  {
    id: "vertical-security-logs",
    version: "1.0.0",
    dataClass: "security-logs",
    applicableArchetypeCategories: ["*"],
    publicProviderEligibility: "approved-with-evidence",
    protectedExternalEffect: "allow-with-obligations",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-security-evidence-schedule",
    refusalCode: "boundary-security-provider-evidence-required",
    requiredProviderEvidence: ["security-controls-reviewed", "no-training", "regional-processing"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.nistControls],
  },
  {
    id: "vertical-regulated-decisioning",
    version: "1.0.0",
    dataClass: "regulated-decisioning",
    applicableArchetypeCategories: ["banking-financial-services", "healthcare-wellness", "public-sector"],
    publicProviderEligibility: "never",
    protectedExternalEffect: "review",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-decision-evidence-required",
    refusalCode: "boundary-regulated-human-decision-owner-required",
    requiredProviderEvidence: ["human-decision-owner", "decision-evidence-profile"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.nistAiRmf],
  },
  {
    id: "vertical-source-code",
    version: "1.0.0",
    dataClass: "source-code",
    applicableArchetypeCategories: ["software-platform"],
    publicProviderEligibility: "protected-only",
    protectedExternalEffect: "allow-with-obligations",
    maskingEligibility: "conditional",
    retentionPromptCode: "retention-source-purpose-limited",
    refusalCode: "boundary-source-provider-evidence-required",
    requiredProviderEvidence: ["no-training", "zero-retention", "repository-authorized"],
    // Masked source code cannot be reviewed, refactored or reasoned about — the
    // transformation destroys the payload's entire purpose. This pack already
    // states the real control: a provider carrying no-training, zero-retention
    // and repository-authorized evidence. So untransformed export is the
    // supported path here, and the obligation (logUse) still applies.
    untransformedExternalExport: "permitted",
    authorityRefs: [AUTHORITY.nistControls],
  },
  {
    id: "vertical-secrets-credentials",
    version: "1.0.0",
    dataClass: "secrets-credentials",
    applicableArchetypeCategories: ["*"],
    publicProviderEligibility: "never",
    protectedExternalEffect: "deny",
    maskingEligibility: "prohibited",
    retentionPromptCode: "retention-credential-none",
    refusalCode: "boundary-credential-omit-and-rotate",
    requiredProviderEvidence: ["local-secret-boundary"],
    untransformedExternalExport: "requires-transformation",
    authorityRefs: [AUTHORITY.nistControls],
  },
] as const;

function logUseObligation(dataClass: InferenceDataClass): DataObligation {
  return {
    kind: "log-use",
    evidenceClass: `inference-${dataClass}`,
    minimumRetentionClass: "telemetry-bounded",
  };
}

function executablePolicy(input: {
  id: string;
  version: string;
  dataClass: InferenceDataClass;
  assetId: DataAssetId;
  effect: VerticalSensitiveDataPolicyPack["protectedExternalEffect"];
  untransformedExternalExport: VerticalSensitiveDataPolicyPack["untransformedExternalExport"];
  authorityRef: string;
}): DataExecutablePolicy {
  return {
    id: `${input.id}-protected-external`,
    version: input.version,
    precedenceLevel: "mandatory-authority",
    match: {
      actions: ["export"],
      assets: [input.assetId],
      destinations: ["external-service"],
      // Only classes that explicitly opt in may match an untransformed payload;
      // every regulated class keeps the masked/tokenized-only contract.
      transformations: input.untransformedExternalExport === "permitted"
        ? ["none", "masked", "tokenized"]
        : ["masked", "tokenized"],
    },
    effect: input.effect,
    ...(input.effect === "allow-with-obligations"
      ? { obligations: [logUseObligation(input.dataClass)] }
      : {}),
    authorityRef: input.authorityRef,
    explanationCode: `boundary-${input.dataClass}-${input.effect}`,
    effectiveFrom: "2026-07-27",
  };
}

function materialize(definition: PackDefinition): VerticalSensitiveDataPolicyPack {
  const binding = aiWorkloadDataBindingFor(definition.dataClass);
  return {
    ...definition,
    assetId: binding.assetId,
    sensitivity: binding.sensitivity,
    categories: [...binding.categories],
    applicableArchetypeCategories: [...definition.applicableArchetypeCategories],
    requiredProviderEvidence: [...definition.requiredProviderEvidence],
    untransformedExternalExport: definition.untransformedExternalExport,
    authorityRefs: [...definition.authorityRefs],
    policies: [executablePolicy({
      id: definition.id,
      version: definition.version,
      dataClass: definition.dataClass,
      assetId: binding.assetId,
      effect: definition.protectedExternalEffect,
      untransformedExternalExport: definition.untransformedExternalExport,
      authorityRef: definition.authorityRefs[0],
    })],
  };
}

const UNKNOWN_PACK: VerticalSensitiveDataPolicyPack = {
  id: "vertical-unknown-governed-data",
  version: "1.0.0",
  dataClass: "unknown-governed-data",
  assetId: "data:inference-payload",
  sensitivity: "restricted",
  categories: ["operational"],
  applicableArchetypeCategories: ["*"],
  publicProviderEligibility: "never",
  protectedExternalEffect: "deny",
  maskingEligibility: "prohibited",
  retentionPromptCode: "retention-unknown-classify-first",
  refusalCode: "boundary-unknown-classify-before-dispatch",
  requiredProviderEvidence: ["governed-classification"],
  untransformedExternalExport: "requires-transformation",
  authorityRefs: [AUTHORITY.nistControls],
  policies: [executablePolicy({
    id: "vertical-unknown-governed-data",
    version: "1.0.0",
    dataClass: "unknown-governed-data",
    assetId: "data:inference-payload",
    effect: "deny",
    untransformedExternalExport: "requires-transformation",
    authorityRef: AUTHORITY.nistControls,
  })],
};

export const VERTICAL_SENSITIVE_DATA_POLICY_PACKS: readonly VerticalSensitiveDataPolicyPack[] = [
  ...DEFINITIONS.map(materialize),
  UNKNOWN_PACK,
].sort((left, right) => left.dataClass.localeCompare(right.dataClass));

const PACK_BY_CLASS = new Map(
  VERTICAL_SENSITIVE_DATA_POLICY_PACKS.map((pack) => [pack.dataClass, pack]),
);

export function getVerticalSensitiveDataPolicyPack(
  dataClass: InferenceDataClass,
): VerticalSensitiveDataPolicyPack {
  const pack = PACK_BY_CLASS.get(dataClass);
  if (!pack) throw new Error(`No vertical sensitive-data policy pack for "${dataClass}".`);
  return pack;
}

export function verticalSensitiveDataPoliciesForClasses(
  dataClasses: readonly InferenceDataClass[],
): DataExecutablePolicy[] {
  return uniqueClasses(dataClasses).flatMap(
    (dataClass) => getVerticalSensitiveDataPolicyPack(dataClass).policies,
  );
}

export function policyPackVersionsForClasses(
  dataClasses: readonly InferenceDataClass[],
): string[] {
  return uniqueClasses(dataClasses)
    .map((dataClass) => {
      const pack = getVerticalSensitiveDataPolicyPack(dataClass);
      return `${pack.id}@${pack.version}`;
    })
    .sort();
}

export function hasVerticalPolicyPacks(
  dataClasses: readonly InferenceDataClass[],
): boolean {
  return dataClasses.length > 0;
}

function uniqueClasses(
  dataClasses: readonly InferenceDataClass[],
): InferenceDataClass[] {
  return [...new Set(dataClasses)].sort();
}

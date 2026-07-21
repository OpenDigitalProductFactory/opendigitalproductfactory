import type { OperationalValueStreamStageKey } from "@dpf/storefront-templates";
import type { ActivityContract } from "../activity-contract";
import { deriveAiWorkloadDataProfile } from "./workload-profile";
import type {
  AiWorkloadClassKey,
  AiWorkloadDataProfile,
  CompileProviderSuitabilityInput,
} from "./types";

export type ProviderSuitabilityOccupationFocus = {
  occupationKey: string;
  archetypeCategories: string[];
  archetypeIds: string[];
};

export type DeriveProviderSuitabilityWorkContextInput = {
  archetypeId: string | null;
  archetypeCategory: string | null;
  valueStreamStage: OperationalValueStreamStageKey | null;
  activity: ActivityContract;
  /** Profiles already resolved by govern/data; these always outrank workload defaults. */
  governedProfiles?: AiWorkloadDataProfile[];
  /** Focuses explanations/recommendations only and never changes enforced profiles. */
  occupation?: ProviderSuitabilityOccupationFocus | null;
};

export type ProviderSuitabilityWorkContext = {
  archetypeId: string | null;
  archetypeCategory: string | null;
  valueStreamStage: OperationalValueStreamStageKey | null;
  activityId: string;
  activityClass: ActivityContract["activityClass"];
  workloadClasses: AiWorkloadClassKey[];
  workloadProfiles: AiWorkloadDataProfile[];
  recommendationFocus: {
    occupationKey: string | null;
    workloadClasses: AiWorkloadClassKey[];
  };
  explanationCodes: string[];
};

const CATEGORY_RESTRICTED_DEFAULT: Readonly<Record<string, AiWorkloadClassKey>> = {
  "healthcare-wellness": "health-phi",
  "banking-financial-services": "payments-finance",
  "education-training": "student-records",
  "public-sector": "public-sector-records",
};

function sortedClasses(values: readonly AiWorkloadClassKey[]): AiWorkloadClassKey[] {
  return [...new Set(values)].sort();
}

function defaultWorkloadClass(input: {
  category: string | null;
  stage: OperationalValueStreamStageKey | null;
  activityClass: ActivityContract["activityClass"];
}): AiWorkloadClassKey {
  if (input.stage === "attract") return "public-marketing";
  if (input.stage === "settle") return "payments-finance";
  if (
    input.category === "software-platform" &&
    (input.activityClass === "code-edit" || input.activityClass === "verify")
  ) {
    return "source-code";
  }
  if (input.stage === "operate-improve") return "internal-operations";
  const restricted = input.category ? CATEGORY_RESTRICTED_DEFAULT[input.category] : undefined;
  if (restricted) return restricted;
  if (input.stage === "capture" || input.stage === "qualify" || input.stage === "deliver" || input.stage === "retain") {
    return "customer-records";
  }
  return "internal-operations";
}

function cloneProfile(profile: AiWorkloadDataProfile): AiWorkloadDataProfile {
  return {
    ...profile,
    assetIds: [...profile.assetIds],
    ...(profile.fieldIds ? { fieldIds: [...profile.fieldIds] } : {}),
    categories: [...profile.categories],
    applicableRegulationIds: [...profile.applicableRegulationIds],
  };
}

// BI-4C8F9E2A — the parameter is deliberately NOT named `workloadClass`, and the
// property below is deliberately written `workloadClass: hintWorkloadClass`
// rather than shorthand. Turbopack's minifier inlines this function into its sole
// caller — `classes.map((workloadClass) => profileFromHint(workloadClass, …))` —
// renames that map parameter to a single letter, but then FAILS to rewrite an
// object-shorthand `{ workloadClass }` whose value was that renamed parameter,
// emitting a bare `{ workloadClass }` that references nothing. The result is a
// runtime `ReferenceError: workloadClass is not defined` that fires on EVERY
// routed-phase route (plan / design-review / plan-review), which
// resolve_model_selection then mislabels "No AI providers are configured". The
// bug exists ONLY in the minified production bundle — source, typecheck, and unit
// tests are all clean — so nothing but a built-bundle check catches it. Giving the
// parameter a distinct name and writing the property explicitly denies the
// minifier the shorthand it mishandles. Do not "simplify" this back to shorthand.
function profileFromHint(
  hintWorkloadClass: AiWorkloadClassKey,
  activity: ActivityContract,
  classificationKnown: boolean,
): AiWorkloadDataProfile {
  const governed = activity.governedData;
  const base = deriveAiWorkloadDataProfile({
    workloadClass: hintWorkloadClass,
    classificationKnown,
    applicableRegulationIds: governed?.applicableRegulationIds,
    processingActivityId: governed?.processingActivityId,
  });
  return {
    ...base,
    ...(governed?.assetIds.length ? { assetIds: [...governed.assetIds] } : {}),
    ...(governed?.fieldIds ? { fieldIds: [...governed.fieldIds] } : {}),
    ...(governed?.processingPurpose ? { purpose: governed.processingPurpose } : {}),
  };
}

function occupationFocus(
  occupation: ProviderSuitabilityOccupationFocus | null | undefined,
): ProviderSuitabilityWorkContext["recommendationFocus"] {
  if (!occupation) return { occupationKey: null, workloadClasses: [] };
  const suggestions = occupation.archetypeCategories
    .flatMap((category) => CATEGORY_RESTRICTED_DEFAULT[category] ?? []) as AiWorkloadClassKey[];
  return {
    occupationKey: occupation.occupationKey,
    workloadClasses: sortedClasses(suggestions),
  };
}

/**
 * Compose existing archetype, value-stream, activity, occupation, and governed
 * data lenses into the workload profiles consumed by the suitability compiler.
 */
export function deriveProviderSuitabilityWorkContext(
  input: DeriveProviderSuitabilityWorkContextInput,
): ProviderSuitabilityWorkContext {
  const explanations: string[] = [];
  let profiles: AiWorkloadDataProfile[];

  if ((input.governedProfiles?.length ?? 0) > 0) {
    profiles = input.governedProfiles!.map(cloneProfile);
    explanations.push("governed-profile-applied");
  } else {
    const explicitHints = sortedClasses(input.activity.workloadClassHints ?? []);
    const classes = explicitHints.length > 0
      ? explicitHints
      : [defaultWorkloadClass({
          category: input.archetypeCategory,
          stage: input.valueStreamStage,
          activityClass: input.activity.activityClass,
        })];
    const classificationKnown = explicitHints.length > 0 ||
      input.archetypeCategory !== null ||
      input.valueStreamStage !== null ||
      (input.activity.riskClass !== "high" && input.activity.riskClass !== "critical" && !input.activity.governedData);
    profiles = classes.map((workloadClass) => profileFromHint(
      workloadClass,
      input.activity,
      classificationKnown,
    ));
    explanations.push(explicitHints.length > 0 ? "activity-workload-hint-applied" : "work-context-default-applied");
    if (!classificationKnown) explanations.push("governed-classification-required");
  }

  profiles.sort((left, right) => left.workloadClass.localeCompare(right.workloadClass));
  return {
    archetypeId: input.archetypeId,
    archetypeCategory: input.archetypeCategory,
    valueStreamStage: input.valueStreamStage,
    activityId: input.activity.activityId,
    activityClass: input.activity.activityClass,
    workloadClasses: sortedClasses(profiles.map((profile) => profile.workloadClass)),
    workloadProfiles: profiles,
    recommendationFocus: occupationFocus(input.occupation),
    explanationCodes: [...new Set(explanations)].sort(),
  };
}

/** Bind the derived work lens to the existing compiler input without forking policy evaluation. */
export function bindProviderSuitabilityWorkContext(
  input: Omit<CompileProviderSuitabilityInput, "workloadProfiles" | "activityClass">,
  context: ProviderSuitabilityWorkContext,
): CompileProviderSuitabilityInput {
  if (
    context.archetypeId &&
    input.businessProfile.archetypeId &&
    context.archetypeId !== input.businessProfile.archetypeId
  ) {
    throw new Error("Provider suitability work context conflicts with the canonical business archetype.");
  }
  if (
    context.archetypeCategory &&
    input.businessProfile.archetypeCategory &&
    context.archetypeCategory !== input.businessProfile.archetypeCategory
  ) {
    throw new Error("Provider suitability work context conflicts with the canonical archetype category.");
  }
  return {
    ...input,
    workloadProfiles: context.workloadProfiles.map(cloneProfile),
    activityClass: context.activityClass,
  };
}

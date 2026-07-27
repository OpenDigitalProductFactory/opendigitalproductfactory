import { compileAiProviderSuitabilityPolicy } from "./compile";
import { deriveAiWorkloadDataProfile } from "./workload-profile";
import {
  buildProviderReviewPacket,
  type ProviderReviewPacket,
} from "./provider-review-packet";
import type {
  AiWorkloadClassKey,
  BusinessSuitabilityProfile,
  ProviderTrustFacts,
} from "./types";

export type ProviderRecommendationItem = {
  providerConnectionId: string;
  providerId: string;
  label: string;
  scope: "company-work" | "public-only" | "blocked";
  reason: string;
  executionChannel: ProviderTrustFacts["executionChannel"];
  accountClass: ProviderTrustFacts["accountClass"];
};

export type ProviderOnboardingRecommendation = {
  status: "ready" | "review-needed" | "not-ready";
  headline: string;
  useNow: ProviderRecommendationItem[];
  useAfterReview: ProviderRecommendationItem[];
  notForThisWork: ProviderRecommendationItem[];
  whatMayLeave: string;
  whatStaysLocal: string;
  whatDpfBlocks: string;
  nextAction: string;
  caveat: string;
  workloadClasses: AiWorkloadClassKey[];
  reviewPacket: ProviderReviewPacket;
};

export function resolveRuntimeConnectionStatus(providerStatus: string, connectionStatus: string): string {
  if (connectionStatus === "disabled") return "disabled";
  if (providerStatus === "active") return "active";
  return providerStatus;
}

function sortedUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

export function deriveOnboardingWorkloadClasses(input: {
  archetypeCategory: string | null;
  handlesCardPayments: boolean;
}): AiWorkloadClassKey[] {
  const category = (input.archetypeCategory ?? "").toLowerCase();
  const classes: AiWorkloadClassKey[] = ["public-marketing", "internal-operations", "customer-records"];
  if (input.handlesCardPayments) classes.push("payments-finance");
  if (/health|care|medical/.test(category)) classes.push("health-phi");
  if (/education|school|university|student/.test(category)) {
    classes.push("student-records", "youth-sensitive");
  }
  if (/public|government|civic/.test(category)) classes.push("public-sector-records");
  if (/security|public-safety|emergency/.test(category)) {
    classes.push("security-logs", "safety-sensitive");
  }
  if (/bank|financ|insurance/.test(category)) classes.push("regulated-decisioning", "payments-finance");
  if (/software|technology|digital-product/.test(category)) classes.push("source-code");
  return sortedUnique(classes);
}

function isLocal(facts: ProviderTrustFacts): boolean {
  return facts.externalEgress === "none" || facts.executionChannel === "local-runtime";
}

function accountEvidenceReady(facts: ProviderTrustFacts): boolean {
  return (facts.accountClass === "business-team" || facts.accountClass === "enterprise") &&
    (facts.evidenceStatus === "operator-attested" || facts.evidenceStatus === "contract-uploaded") &&
    facts.entitlements.noTraining === true;
}

function compileFor(input: {
  businessProfile: BusinessSuitabilityProfile;
  workloadClasses: AiWorkloadClassKey[];
  facts: ProviderTrustFacts;
}) {
  return compileAiProviderSuitabilityPolicy({
    businessProfile: input.businessProfile,
    // Explicit `workloadClass: onboardingWorkloadClass`, never shorthand — same
    // Turbopack inline-minifier bug as work-context.ts profileFromHint
    // (BI-573A8EB3). A shorthand `{ workloadClass }` whose value is this renamed
    // map parameter is emitted as a dangling free reference in the production
    // bundle. Guarded by scripts/check-no-suitability-object-shorthand.mjs.
    workloadProfiles: input.workloadClasses.map((onboardingWorkloadClass) =>
      deriveAiWorkloadDataProfile({ workloadClass: onboardingWorkloadClass }),
    ),
    dataPolicyDecisions: [],
    regulationResults: [],
    providerFacts: [input.facts],
    source: "onboarding",
  });
}

/** One human-readable projection over the canonical suitability compiler. */
export function buildProviderOnboardingRecommendation(input: {
  businessProfile: BusinessSuitabilityProfile;
  connections: Array<{ label: string; status: string; facts: ProviderTrustFacts }>;
  handlesCardPayments: boolean;
}): ProviderOnboardingRecommendation {
  const workloadClasses = deriveOnboardingWorkloadClasses({
    archetypeCategory: input.businessProfile.archetypeCategory,
    handlesCardPayments: input.handlesCardPayments,
  });
  const nonPublicWorkloads = workloadClasses.filter((workload) => workload !== "public-marketing");
  const useNow: ProviderRecommendationItem[] = [];
  const useAfterReview: ProviderRecommendationItem[] = [];
  const notForThisWork: ProviderRecommendationItem[] = [];

  for (const connection of input.connections) {
    const base = {
      providerConnectionId: connection.facts.providerConnectionId,
      providerId: connection.facts.providerId,
      label: connection.label,
      executionChannel: connection.facts.executionChannel,
      accountClass: connection.facts.accountClass,
    };
    if (connection.status !== "active") {
      useAfterReview.push({ ...base, scope: "company-work", reason: "Connect and test this provider before DPF can route any work to it." });
      continue;
    }
    const publicPolicy = compileFor({
      // Public/synthetic content is not the organization's region-bound data.
      businessProfile: { ...input.businessProfile, dataResidency: [] },
      workloadClasses: ["public-marketing"],
      facts: connection.facts,
    });
    const companyPolicy = compileFor({
      businessProfile: input.businessProfile,
      workloadClasses: nonPublicWorkloads,
      facts: connection.facts,
    });
    if (companyPolicy.effect !== "deny" && (isLocal(connection.facts) || accountEvidenceReady(connection.facts))) {
      useNow.push({ ...base, scope: "company-work", reason: isLocal(connection.facts)
        ? "No external provider egress is declared for this connection."
        : "The business account and no-training treatment are recorded for this connection." });
    } else if (publicPolicy.effect !== "deny") {
      useNow.push({ ...base, scope: "public-only", reason: "Use only public or synthetic content while business terms and regional controls are reviewed." });
      useAfterReview.push({ ...base, scope: "company-work", reason: companyPolicy.explanations[0]?.message ?? "Business-account, contract, or regional-processing evidence is incomplete." });
    } else {
      notForThisWork.push({ ...base, scope: "blocked", reason: publicPolicy.explanations[0]?.message ?? "This connection does not meet the current routing policy." });
    }
  }

  const companyReady = useNow.some((item) => item.scope === "company-work");
  const status = companyReady ? "ready" : input.connections.length > 0 ? "review-needed" : "not-ready";
  const recommendation = {
    status,
    headline: companyReady
      ? "A connection is available for company work"
      : input.connections.length > 0
        ? "Keep company data out until account terms are confirmed"
        : "Choose a connection before using AI with company data",
    useNow,
    useAfterReview,
    notForThisWork,
    whatMayLeave: "Only prompts and attachments allowed by the selected workload policy may leave this installation.",
    whatStaysLocal: "Credentials, secrets, unknown classifications, and blocked data remain in the controlled runtime.",
    whatDpfBlocks: "DPF blocks company, customer, employee, source-code, or regulated data from unproven cloud connections.",
    nextAction: companyReady
      ? "Review the connection evidence and then activate only the workloads shown as allowed."
      : "Use the local connection for intake, or establish a business or enterprise account and record its contract, no-training, retention, and processing-region evidence.",
    caveat: "Local processing reduces external egress, but does not by itself prove compliance, security, or adequate model capability.",
    workloadClasses,
  } satisfies Omit<ProviderOnboardingRecommendation, "reviewPacket">;

  return {
    ...recommendation,
    reviewPacket: buildProviderReviewPacket({
      businessProfile: input.businessProfile,
      recommendation: {
        status: recommendation.status,
        workloadClasses: recommendation.workloadClasses,
        items: [
          ...recommendation.useNow,
          ...recommendation.useAfterReview,
          ...recommendation.notForThisWork,
        ],
      },
    }),
  };
}

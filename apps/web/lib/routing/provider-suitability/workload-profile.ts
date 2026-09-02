import type {
  DataAssetId,
  DataCategory,
  DataSensitivity,
  ResidencyClassKey,
} from "@/lib/govern/data/taxonomy";
import type { AiWorkloadClassKey, AiWorkloadDataProfile } from "./types";

export type AiWorkloadDataBinding = {
  assetId: DataAssetId;
  sensitivity: DataSensitivity;
  categories: DataCategory[];
  residencyClass: ResidencyClassKey;
};

const WORKLOAD_BINDINGS: Readonly<Record<AiWorkloadClassKey, AiWorkloadDataBinding>> = {
  "public-marketing": {
    assetId: "data:marketing-content",
    sensitivity: "public",
    categories: ["content"],
    residencyClass: "unrestricted",
  },
  "internal-operations": {
    assetId: "data:internal-operations",
    sensitivity: "internal",
    categories: ["operational"],
    residencyClass: "unrestricted",
  },
  "customer-records": {
    assetId: "data:customer-record",
    sensitivity: "confidential",
    categories: ["identity", "contact", "operational"],
    residencyClass: "region-bound",
  },
  "employee-records": {
    assetId: "data:employee-record",
    sensitivity: "restricted",
    categories: ["identity", "contact", "personal-attribute"],
    residencyClass: "region-bound",
  },
  "payments-finance": {
    assetId: "data:financial-record",
    sensitivity: "restricted",
    categories: ["financial", "identity"],
    residencyClass: "region-bound",
  },
  "health-phi": {
    assetId: "data:health-record",
    sensitivity: "restricted",
    categories: ["identity", "personal-attribute", "content"],
    residencyClass: "region-bound",
  },
  "student-records": {
    assetId: "data:student-record",
    sensitivity: "restricted",
    categories: ["identity", "personal-attribute", "content"],
    residencyClass: "region-bound",
  },
  "legal-privileged": {
    assetId: "data:legal-privileged-record",
    sensitivity: "restricted",
    categories: ["identity", "content", "operational"],
    residencyClass: "region-bound",
  },
  "security-logs": {
    assetId: "data:security-log",
    sensitivity: "restricted",
    categories: ["security-audit", "telemetry"],
    residencyClass: "region-bound",
  },
  "criminal-justice": {
    assetId: "data:criminal-justice-record",
    sensitivity: "restricted",
    categories: ["identity", "security-audit", "operational"],
    residencyClass: "local-only",
  },
  "safety-sensitive": {
    assetId: "data:safety-sensitive-record",
    sensitivity: "restricted",
    categories: ["identity", "personal-attribute", "operational"],
    residencyClass: "local-only",
  },
  "youth-sensitive": {
    assetId: "data:youth-sensitive-record",
    sensitivity: "restricted",
    categories: ["identity", "contact", "personal-attribute", "content"],
    residencyClass: "region-bound",
  },
  "public-sector-records": {
    assetId: "data:public-sector-record",
    sensitivity: "restricted",
    categories: ["identity", "operational", "content"],
    residencyClass: "region-bound",
  },
  "regulated-decisioning": {
    assetId: "data:regulated-decision",
    sensitivity: "restricted",
    categories: ["identity", "personal-attribute", "derived-analytic"],
    residencyClass: "region-bound",
  },
  "source-code": {
    assetId: "data:source-code",
    // BI-35FAE2DB follow-up: source code is INTERNAL, not confidential.
    // `confidential` on this scale means disclosure causes irreparable harm —
    // bank details, HR records, PHI. It also auto-attaches a `mask` obligation
    // (profile default-confidential), and a masked payload is useless for the
    // one thing code is sent for: being read. That combination fenced every
    // code payload to the local engine regardless of the source-code pack's
    // declared `allow-with-obligations`. Genuine secrets are NOT reclassified —
    // `secrets-credentials` stays `restricted` + local-only below, so keys and
    // tokens never leave even when they appear inside a code payload.
    sensitivity: "internal",
    categories: ["content", "configuration"],
    residencyClass: "region-bound",
  },
  "secrets-credentials": {
    assetId: "data:credential-secret",
    sensitivity: "restricted",
    categories: ["credential-secret", "authorization"],
    residencyClass: "local-only",
  },
};

/** One canonical class-to-governed-profile mapping shared by routing and inference. */
export function aiWorkloadDataBindingFor(
  workloadClass: AiWorkloadClassKey,
): AiWorkloadDataBinding {
  const binding = WORKLOAD_BINDINGS[workloadClass];
  return {
    ...binding,
    categories: [...binding.categories],
  };
}

export function deriveAiWorkloadDataProfile(input: {
  workloadClass: AiWorkloadClassKey;
  classificationKnown?: boolean;
  applicableRegulationIds?: string[];
  processingActivityId?: string;
}): AiWorkloadDataProfile {
  const binding = aiWorkloadDataBindingFor(input.workloadClass);
  return {
    workloadClass: input.workloadClass,
    assetIds: [binding.assetId],
    sensitivity: binding.sensitivity,
    categories: [...binding.categories],
    purpose: "coworker-assistance",
    residencyClass: binding.residencyClass,
    classificationKnown: input.classificationKnown ?? true,
    applicableRegulationIds: [...new Set(input.applicableRegulationIds ?? [])].sort(),
    ...(input.processingActivityId ? { processingActivityId: input.processingActivityId } : {}),
  };
}

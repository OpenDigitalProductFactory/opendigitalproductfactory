import type {
  DataAssetId,
  DataCategory,
  DataSensitivity,
  ResidencyClassKey,
} from "@/lib/govern/data/taxonomy";
import type { AiWorkloadClassKey, AiWorkloadDataProfile } from "./types";

type WorkloadBinding = {
  assetId: DataAssetId;
  sensitivity: DataSensitivity;
  categories: DataCategory[];
  residencyClass: ResidencyClassKey;
};

const WORKLOAD_BINDINGS: Readonly<Record<AiWorkloadClassKey, WorkloadBinding>> = {
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
    sensitivity: "confidential",
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

export function deriveAiWorkloadDataProfile(input: {
  workloadClass: AiWorkloadClassKey;
  classificationKnown?: boolean;
  applicableRegulationIds?: string[];
  processingActivityId?: string;
}): AiWorkloadDataProfile {
  const binding = WORKLOAD_BINDINGS[input.workloadClass];
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

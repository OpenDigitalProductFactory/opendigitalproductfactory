import type { IntegrationImportStagingDescriptor } from "@/lib/integrations/import-staging";
import type { IntegrationImportReviewPosture } from "@/lib/integrations/import-review";

export const INTEGRATION_READINESS_STATES = [
  "not-connected",
  "credential-expired",
  "not-mapped",
  "read",
  "import-ready",
  "dual-run-ready",
  "dpf-primary-ready",
  "dpf-primary",
  "partner-led",
] as const;

export type IntegrationReadinessState = (typeof INTEGRATION_READINESS_STATES)[number];

export const INTEGRATION_OPERATING_MODES = [
  "integration-led",
  "dual-run",
  "dpf-primary",
  "partner-led",
] as const;

export type IntegrationOperatingMode = (typeof INTEGRATION_OPERATING_MODES)[number];

export type HiveContributionTag = "hive:public" | "hive:aggregate-only" | "hive:private";

export type IntegrationCredentialStatus =
  | "not-connected"
  | "connected"
  | "error"
  | "credential-expired";

export interface IntegrationReadinessCapability {
  key: string;
  label: string;
  description: string;
  state: IntegrationReadinessState;
  operatingMode: IntegrationOperatingMode;
  supportedNow: boolean;
  hiveTag: HiveContributionTag;
  nextAction: string;
  apiCoverageNote?: string;
  unreachableStates?: IntegrationReadinessState[];
}

export interface IntegrationReadinessHealth {
  credentialStatus: IntegrationCredentialStatus;
  lastSuccessfulProbeAt: string | null;
  lastProbeErrorCategory: string | null;
  timeUntilExpiry: string | null;
}

export interface IntegrationReadinessDescriptor {
  schemaVersion: "1.0";
  provider: string;
  integrationId: string;
  displayName: string;
  summary: string;
  environment: string | null;
  entityContext: Record<string, string | null>;
  health: IntegrationReadinessHealth;
  capabilities: IntegrationReadinessCapability[];
  importStaging?: IntegrationImportStagingDescriptor;
  importReview?: IntegrationImportReviewPosture;
  nextSafeActions: string[];
  updatedAt: string | null;
}

export function isIntegrationReadinessState(value: string): value is IntegrationReadinessState {
  return INTEGRATION_READINESS_STATES.includes(value as IntegrationReadinessState);
}

export function normalizeReadinessCapability(
  capability: IntegrationReadinessCapability,
): IntegrationReadinessCapability {
  if (
    !capability.supportedNow &&
    capability.state !== "partner-led" &&
    capability.state !== "not-connected"
  ) {
    return { ...capability, state: "not-mapped" };
  }

  return capability;
}

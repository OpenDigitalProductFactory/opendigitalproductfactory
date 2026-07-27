import type { ChatMessage } from "@/lib/inference/ai-inference";
import type { DataEffect, DestinationClass } from "@/lib/govern/data/taxonomy";
import type { RequestContract } from "@/lib/routing/request-contract";
import type { DataPolicyDecision } from "@/lib/govern/data/policy-decision";

export type InferenceDataClass =
  | "customer-records"
  | "employee-records"
  | "payments-finance"
  | "health-phi"
  | "student-records"
  | "legal-privileged"
  | "security-logs"
  | "criminal-justice"
  | "safety-sensitive"
  | "youth-sensitive"
  | "public-sector-records"
  | "regulated-decisioning"
  | "source-code"
  | "secrets-credentials"
  | "unknown-governed-data";

export type InferencePayloadSensitivity =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

export type InferencePayloadMatch = {
  dataClass: InferenceDataClass;
  path: string;
  reason: string;
  confidence: "deterministic" | "inferred" | "governed";
};

export type InferencePayloadReceipt = {
  screenId: string;
  inputHash: string;
  detectedClasses: InferenceDataClass[];
  matchCount: number;
  transformation: "none" | "masked" | "tokenized" | "blocked";
  rawPayloadStored: false;
};

export type InferenceDataScreenRouteContext = Pick<
  RequestContract,
  "sensitivity" | "allowedProviders" | "deniedProviders" | "residencyPolicy"
>;

export type InferencePolicyDecisionVersion = {
  decisionId: string;
  assetVersion: string;
  classificationVersion: string;
  authorityVersion: string;
};

export type InferencePolicyVersionSnapshot = {
  assetVersion: string;
  classificationVersion: string;
  authorityVersion: string;
  policyBundleVersion: string;
};

export type InferenceDataScreenReceipt = {
  schemaVersion: "inference-data-screen/v1";
  screenId: string;
  decisionIds: string[];
  /** Safe TOCTOU evidence for each governed PDP decision; never contains payload values. */
  decisionVersions: InferencePolicyDecisionVersion[];
  inputHash: string;
  classifiedDataClasses: InferenceDataClass[];
  policyEffect: DataEffect;
  routeEffect: "allow" | "local-only" | "block";
  destinationClass: DestinationClass;
  transformation: InferencePayloadReceipt["transformation"];
  explanationCodes: string[];
  obligationKinds: string[];
  /** Present for policy-pack-aware screens; absent on pre-pack v1 receipts. */
  policyPackVersions?: string[];
  rawPayloadStored: false;
};

export type InferenceDataScreenResult = {
  routeContext: InferenceDataScreenRouteContext;
  receipt: InferenceDataScreenReceipt;
  /** Ephemeral classifier evidence used only by the enforcing transform seam. */
  classification: InferencePayloadClassification;
  /** Ephemeral PDP decisions; persisted evidence remains the bounded receipt. */
  decisions: DataPolicyDecision[];
};

export type GovernedPayloadHint = {
  assetId?: string;
  fieldIds?: string[];
  classificationKnown: boolean;
  sensitivity?: InferencePayloadSensitivity;
  dataClasses?: InferenceDataClass[];
  purpose?: string;
};

export type InferencePayloadClassificationInput = {
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: Array<Record<string, unknown>>;
  taskType?: string;
  governedData?: GovernedPayloadHint[];
};

export type InferencePayloadClassification = {
  overallSensitivity: InferencePayloadSensitivity;
  dataClasses: InferenceDataClass[];
  matches: InferencePayloadMatch[];
  receipt: InferencePayloadReceipt;
};

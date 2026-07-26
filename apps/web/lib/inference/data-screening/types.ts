import type { ChatMessage } from "@/lib/inference/ai-inference";

export type InferenceDataClass =
  | "customer-records"
  | "employee-records"
  | "payments-finance"
  | "health-phi"
  | "student-records"
  | "legal-privileged"
  | "security-logs"
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

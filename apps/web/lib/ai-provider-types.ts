// apps/web/lib/ai-provider-types.ts

// ─── Schedule helpers ─────────────────────────────────────────────────────────

export const SCHEDULE_INTERVALS_MS = {
  daily:   1 * 24 * 60 * 60 * 1000,
  weekly:  7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;

export type ScheduleValue = "daily" | "weekly" | "monthly" | "disabled";

export function computeNextRunAt(schedule: string, from: Date): Date | null {
  if (schedule === "disabled") return null;
  const ms = SCHEDULE_INTERVALS_MS[schedule as keyof typeof SCHEDULE_INTERVALS_MS];
  if (ms === undefined) return null;
  return new Date(from.getTime() + ms);
}

// ─── Cost calculation ─────────────────────────────────────────────────────────

/** Token-priced provider cost (cloud APIs). */
export function computeTokenCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMToken: number,
  outputPricePerMToken: number,
): number {
  return (inputTokens / 1_000_000) * inputPricePerMToken
       + (outputTokens / 1_000_000) * outputPricePerMToken;
}

/** Compute-priced provider cost (local inference, e.g. Ollama). */
export function computeComputeCost(
  inferenceMs: number,
  computeWatts: number,
  electricityRateKwh: number,
): number {
  return (inferenceMs / 3_600_000) * (computeWatts / 1_000) * electricityRateKwh;
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ProviderRow = {
  id: string;
  providerId: string;
  name: string;
  families: string[];
  enabledFamilies: string[];
  status: string;
  costModel: string;
  authEndpoint: string | null;
  authHeader: string | null;
  endpoint: string | null;
  inputPricePerMToken: number | null;
  outputPricePerMToken: number | null;
  computeWatts: number | null;
  electricityRateKwh: number | null;
};

export type CredentialRow = {
  providerId: string;
  secretRef: string | null;
  status: string;
};

export type ProviderWithCredential = {
  provider: ProviderRow;
  credential: CredentialRow | null;
};

export type SpendByProvider = {
  providerId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
};

export type SpendByAgent = {
  agentId: string;
  agentName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
};

export type ScheduledJobRow = {
  id: string;
  jobId: string;
  name: string;
  schedule: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
};

// ─── Registry JSON shape ──────────────────────────────────────────────────────

export type RegistryProviderEntry = {
  providerId: string;
  name: string;
  families: string[];
  authEndpoint: string | null;
  authHeader: string | null;
  costModel: string;
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
  computeWatts?: number;
  electricityRateKwh?: number;
};

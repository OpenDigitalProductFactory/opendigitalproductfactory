import { prisma } from "@dpf/db";

import type { ProviderCapacityClassification } from "./types";

export type ProviderCapacitySource = "api" | "cli" | "opencode" | "oauth" | "manual";

export async function recordProviderCapacityStatus(input: {
  providerId: string;
  classification: ProviderCapacityClassification;
  source: ProviderCapacitySource;
  observedAt?: Date;
  rawSnippet?: string;
}): Promise<void> {
  const observedAt = input.observedAt ?? new Date();
  const data = {
    state: input.classification.state,
    action: input.classification.action,
    retryAt: input.classification.retryAt ?? null,
    retryAfterSeconds: input.classification.retryAfterSeconds ?? null,
    providerCode: input.classification.providerCode ?? null,
    safeSummary: input.classification.safeSummary,
    confidence: input.classification.confidence,
    isHumanActionRequired: input.classification.isHumanActionRequired,
    lastObservedAt: observedAt,
    source: input.source,
    rawSnippet: input.rawSnippet?.slice(0, 500) ?? null,
  };

  await prisma.providerCapacityStatus.upsert({
    where: { providerId: input.providerId },
    create: {
      providerId: input.providerId,
      ...data,
    },
    update: data,
  });
}

export async function clearProviderCapacityStatus(input: {
  providerId: string;
  source: ProviderCapacitySource;
  observedAt?: Date;
}): Promise<void> {
  const observedAt = input.observedAt ?? new Date();
  const data = {
    state: "available",
    action: "none",
    retryAt: null,
    retryAfterSeconds: null,
    providerCode: null,
    safeSummary: "Provider is available.",
    confidence: "exact",
    isHumanActionRequired: false,
    lastObservedAt: observedAt,
    lastSuccessAt: observedAt,
    source: input.source,
    rawSnippet: null,
  };

  await prisma.providerCapacityStatus.upsert({
    where: { providerId: input.providerId },
    create: {
      providerId: input.providerId,
      ...data,
    },
    update: data,
  });
}

// BI-7F2FBDA3 — learned, per-auth-mode model eligibility.
//
// Providers rotate models weekly and a provider's catalog differs by how you
// are signed in (a ChatGPT-subscription Codex sees a different set than an
// API-key Codex). Anything declared in source about "which model works under
// which account" is stale on merge — CHATGPT_CODEX_UNSUPPORTED_MODELS was the
// hardcoded example that stranded every governed reviewer on 2026-09-07.
//
// So eligibility is LEARNED and stored on the profile, keyed by auth method:
//   ModelProfile.capabilityOverrides.authEligibility[<authMethod>] =
//     { supported, source, learnedAt, expiresAt?, reason? }
// Sources, in trust order:
//   discovery       — the provider listed the model under this auth mode (durable
//                     until the next discovery overwrites it)
//   runtime-refusal — the provider refused the model at inference time (expires,
//                     so a transient outage cannot permanently bench a model)
//   seed            — the checked-in fallback, consulted only when nothing was
//                     learned; it never overrides a learned record
// The admin override channel on capabilityOverrides (toolUse etc.) is untouched.

import type { PrismaClient } from "@dpf/db";

import { isRecord } from "@/lib/shared/coerce";

import { codexSubscriptionModelExclusionReason } from "./codex-subscription-model-eligibility";

export const AUTH_ELIGIBILITY_KEY = "authEligibility";
/** A runtime refusal benches a model for a day, then it is tried again. */
export const RUNTIME_REFUSAL_TTL_MS = 24 * 60 * 60 * 1000;

export type AuthEligibilitySource = "discovery" | "runtime-refusal" | "seed";

export interface AuthEligibilityRecord {
  supported: boolean;
  source: AuthEligibilitySource;
  learnedAt: string;
  expiresAt?: string | null;
  reason?: string | null;
}

export type AuthEligibilityMap = Record<string, AuthEligibilityRecord>;

function isEligibilityRecord(value: unknown): value is AuthEligibilityRecord {
  return isRecord(value)
    && typeof value.supported === "boolean"
    && typeof value.source === "string"
    && typeof value.learnedAt === "string";
}

/** Read the learned record for one auth method; an expired record reads as absent. */
export function readAuthEligibility(
  capabilityOverrides: unknown,
  authMethod: string,
  now: Date = new Date(),
): AuthEligibilityRecord | null {
  if (!isRecord(capabilityOverrides)) return null;
  const map = capabilityOverrides[AUTH_ELIGIBILITY_KEY];
  if (!isRecord(map)) return null;
  const record = map[authMethod];
  if (!isEligibilityRecord(record)) return null;
  if (record.expiresAt) {
    const expires = Date.parse(record.expiresAt);
    if (Number.isFinite(expires) && expires <= now.getTime()) return null;
  }
  return record;
}

/**
 * The exclusion reason for a (provider, model) under the provider's current auth
 * method, learned first, seed second. Null means eligible as far as auth goes.
 */
export function authEligibilityExclusionReason(input: {
  providerId: string;
  authMethod: string;
  modelId: string;
  capabilityOverrides: unknown;
  now?: Date;
}): string | null {
  const learned = readAuthEligibility(input.capabilityOverrides, input.authMethod, input.now);
  if (learned) {
    if (learned.supported) return null;
    const why = learned.reason ? `: ${learned.reason}` : "";
    return `Model '${input.modelId}' is not supported for provider '${input.providerId}' under auth '${input.authMethod}' (learned from ${learned.source} at ${learned.learnedAt}${why})`;
  }
  return codexSubscriptionModelExclusionReason({
    providerId: input.providerId,
    authMethod: input.authMethod,
    modelId: input.modelId,
  });
}

/** Merge one learned record into the overrides JSON without touching other keys. */
export function withAuthEligibility(
  capabilityOverrides: unknown,
  authMethod: string,
  record: AuthEligibilityRecord,
): Record<string, unknown> {
  const base = isRecord(capabilityOverrides) ? { ...capabilityOverrides } : {};
  const map = isRecord(base[AUTH_ELIGIBILITY_KEY]) ? { ...(base[AUTH_ELIGIBILITY_KEY] as Record<string, unknown>) } : {};
  map[authMethod] = record;
  base[AUTH_ELIGIBILITY_KEY] = map;
  return base;
}

/**
 * Provider refusal signatures that mean "this model, this account" rather than
 * "this request". Deliberately narrow: a rate limit, an auth failure or a
 * malformed request must not bench a model.
 */
const MODEL_REFUSAL_PATTERNS: readonly RegExp[] = [
  /model[^\n]{0,80}\bnot supported\b/i,
  /\bnot supported when\b[^\n]{0,60}\baccount\b/i,
  /\bmodel_not_found\b/i,
  /\bunknown model\b/i,
  /\bunsupported model\b/i,
  /\binvalid model\b/i,
  /model[^\n]{0,80}\bdoes not exist\b/i,
  /model[^\n]{0,80}\bhas been (?:retired|deprecated|removed)\b/i,
  /no such model/i,
];

export function isModelRefusalError(message: string | null | undefined): boolean {
  if (!message) return false;
  return MODEL_REFUSAL_PATTERNS.some((pattern) => pattern.test(message));
}

export interface AuthEligibilityDb {
  modelProfile: {
    findUnique(args: unknown): Promise<{ id: string; capabilityOverrides: unknown } | null>;
    update(args: unknown): Promise<unknown>;
  };
  modelCapabilityChangeLog: {
    create(args: unknown): Promise<unknown>;
  };
}

/**
 * Record what was learned about a model under one auth method, with an audit row.
 * Idempotent on content: re-learning the same verdict from the same source only
 * refreshes the timestamp and writes no audit row.
 */
export async function recordAuthEligibility(
  db: AuthEligibilityDb,
  input: {
    providerId: string;
    modelId: string;
    authMethod: string;
    supported: boolean;
    source: Exclude<AuthEligibilitySource, "seed">;
    reason?: string | null;
    now?: Date;
    changedBy?: string | null;
  },
): Promise<{ changed: boolean; record: AuthEligibilityRecord }> {
  const now = input.now ?? new Date();
  const profile = await db.modelProfile.findUnique({
    where: { providerId_modelId: { providerId: input.providerId, modelId: input.modelId } },
    select: { id: true, capabilityOverrides: true },
  });
  const record: AuthEligibilityRecord = {
    supported: input.supported,
    source: input.source,
    learnedAt: now.toISOString(),
    expiresAt: input.source === "runtime-refusal" && !input.supported
      ? new Date(now.getTime() + RUNTIME_REFUSAL_TTL_MS).toISOString()
      : null,
    reason: input.reason ?? null,
  };
  if (!profile) return { changed: false, record };

  const prior = readAuthEligibility(profile.capabilityOverrides, input.authMethod, now);
  const changed = !prior || prior.supported !== record.supported || prior.source !== record.source;
  await db.modelProfile.update({
    where: { id: profile.id },
    data: { capabilityOverrides: withAuthEligibility(profile.capabilityOverrides, input.authMethod, record) },
  });
  if (changed) {
    await db.modelCapabilityChangeLog.create({
      data: {
        providerId: input.providerId,
        modelId: input.modelId,
        field: `${AUTH_ELIGIBILITY_KEY}.${input.authMethod}`,
        oldValue: prior ?? null,
        newValue: record,
        source: input.source,
        changedBy: input.changedBy ?? null,
      },
    });
  }
  return { changed, record };
}

/**
 * Discovery under one auth mode is proof of support for every model it listed:
 * re-admit them (clearing any runtime refusal) and leave unlisted models to the
 * presence reconciliation, which retires them after repeated misses.
 */
export async function recordDiscoveredAuthEligibility(
  db: AuthEligibilityDb,
  input: { providerId: string; authMethod: string; modelIds: readonly string[]; now?: Date },
): Promise<{ readmitted: string[] }> {
  const readmitted: string[] = [];
  for (const modelId of input.modelIds) {
    const result = await recordAuthEligibility(db, {
      providerId: input.providerId,
      modelId,
      authMethod: input.authMethod,
      supported: true,
      source: "discovery",
      reason: "listed by provider discovery under this auth method",
      now: input.now,
    });
    if (result.changed) readmitted.push(modelId);
  }
  return { readmitted };
}

export type AuthEligibilityPrisma = Pick<PrismaClient, "modelProfile" | "modelCapabilityChangeLog">;

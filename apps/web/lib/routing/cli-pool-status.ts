// apps/web/lib/routing/cli-pool-status.ts
//
// CLI pool rate-limit state tracker — EP-COST-001 Phase 4.
//
// When a CLI adapter (claude-cli or codex-cli) receives a 429 / rate-limit
// error it calls `recordCliRateLimit`. The orchestrator calls
// `getCliPoolStatus` before dispatching CLI-backed tasks; if the pool is
// exhausted (resetAt is in the future) the caller can wait or fall back to
// the API adapter instead of firing into a known-exhausted pool.
//
// Spec: docs/superpowers/specs/2026-05-19-ai-cost-governance.md §4d

import { prisma } from "@dpf/db";

export type CliAdapterType = "claude-cli" | "codex-cli";

export interface CliPoolState {
  adapterType: CliAdapterType;
  providerId: string;
  rateLimitedAt: Date;
  /** Null when the CLI didn't emit a parseable reset time. */
  resetAt: Date | null;
  retryAfterSeconds: number | null;
  errorSnippet: string | null;
  /** True when resetAt is in the future (pool is currently exhausted). */
  isExhausted: boolean;
  /** Seconds until the pool is expected to be available again. Null if unknown. */
  secondsUntilReset: number | null;
}

/**
 * Parse a Retry-After value (seconds or HTTP-date) from CLI stderr output.
 * Returns seconds as a number, or null if nothing parseable is found.
 */
export function parseRetryAfterSeconds(stderr: string): number | null {
  // "Retry-After: 30" or "retry-after: 30"
  const secondsMatch = /retry-after:\s*(\d+)/i.exec(stderr);
  if (secondsMatch) {
    const s = parseInt(secondsMatch[1]!, 10);
    return isNaN(s) ? null : s;
  }

  // "X-RateLimit-Reset: 1716300000" (epoch seconds)
  const epochMatch = /x-ratelimit-reset:\s*(\d{10,})/i.exec(stderr);
  if (epochMatch) {
    const epoch = parseInt(epochMatch[1]!, 10);
    if (!isNaN(epoch)) {
      return Math.max(0, epoch - Math.floor(Date.now() / 1000));
    }
  }

  // "rate limit.*(\d+) seconds?" — common in OpenAI / Anthropic CLI output
  const msgMatch = /(\d+)\s*second/i.exec(stderr);
  if (msgMatch) {
    const s = parseInt(msgMatch[1]!, 10);
    return isNaN(s) ? null : s;
  }

  return null;
}

/**
 * Record a 429 / rate-limit event for the given CLI adapter.
 * Upserts the CliPoolStatus row (one row per adapterType).
 * Fire-and-forget from the adapter — errors are swallowed so they never
 * block the InferenceError from propagating to the caller.
 */
export async function recordCliRateLimit(
  adapterType: CliAdapterType,
  providerId: string,
  errorText: string,
): Promise<void> {
  try {
    const retryAfterSeconds = parseRetryAfterSeconds(errorText);
    const now = new Date();
    const resetAt =
      retryAfterSeconds != null
        ? new Date(now.getTime() + retryAfterSeconds * 1_000)
        : null;

    await prisma.cliPoolStatus.upsert({
      where: { adapterType },
      create: {
        adapterType,
        providerId,
        rateLimitedAt: now,
        resetAt,
        retryAfterSeconds,
        errorSnippet: errorText.slice(0, 300),
        updatedAt: now,
      },
      update: {
        providerId,
        rateLimitedAt: now,
        resetAt,
        retryAfterSeconds,
        errorSnippet: errorText.slice(0, 300),
        updatedAt: now,
      },
    });
  } catch (err) {
    // Non-fatal: pool tracking should never interrupt the inference error path.
    console.warn("[cli-pool-status] Failed to record rate limit:", { adapterType }, err);
  }
}

/**
 * Fetch the current pool state for a given CLI adapter.
 * Returns null when there is no recorded rate-limit event for this adapter.
 */
export async function getCliPoolStatus(
  adapterType: CliAdapterType,
): Promise<CliPoolState | null> {
  try {
    const row = await prisma.cliPoolStatus.findUnique({
      where: { adapterType },
    });
    if (!row) return null;

    const now = Date.now();
    const resetMs = row.resetAt ? row.resetAt.getTime() : null;
    const isExhausted = resetMs != null && resetMs > now;
    const secondsUntilReset =
      isExhausted && resetMs != null ? Math.ceil((resetMs - now) / 1_000) : null;

    return {
      adapterType: row.adapterType as CliAdapterType,
      providerId: row.providerId,
      rateLimitedAt: row.rateLimitedAt,
      resetAt: row.resetAt,
      retryAfterSeconds: row.retryAfterSeconds,
      errorSnippet: row.errorSnippet,
      isExhausted,
      secondsUntilReset,
    };
  } catch (err) {
    console.warn("[cli-pool-status] Failed to read pool status:", { adapterType }, err);
    return null;
  }
}

/**
 * Fetch pool status for all CLI adapters.
 * Used by the Admin UI to surface current pool state.
 */
export async function getAllCliPoolStatuses(): Promise<CliPoolState[]> {
  try {
    const rows = await prisma.cliPoolStatus.findMany({
      orderBy: { adapterType: "asc" },
    });
    const now = Date.now();
    return rows.map((row) => {
      const resetMs = row.resetAt ? row.resetAt.getTime() : null;
      const isExhausted = resetMs != null && resetMs > now;
      return {
        adapterType: row.adapterType as CliAdapterType,
        providerId: row.providerId,
        rateLimitedAt: row.rateLimitedAt,
        resetAt: row.resetAt,
        retryAfterSeconds: row.retryAfterSeconds,
        errorSnippet: row.errorSnippet,
        isExhausted,
        secondsUntilReset: isExhausted && resetMs != null ? Math.ceil((resetMs - now) / 1_000) : null,
      };
    });
  } catch (err) {
    console.warn("[cli-pool-status] Failed to read all pool statuses:", err);
    return [];
  }
}

/**
 * Clear the rate-limit record for a given adapter (e.g. after a successful call
 * proves the pool is available again).
 */
export async function clearCliRateLimit(adapterType: CliAdapterType): Promise<void> {
  try {
    await prisma.cliPoolStatus.deleteMany({ where: { adapterType } });
  } catch (err) {
    console.warn("[cli-pool-status] Failed to clear rate limit:", { adapterType }, err);
  }
}

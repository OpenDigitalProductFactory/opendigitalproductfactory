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
import { parseUnifiedRateLimitHeaders, type WeeklyQuotaSnapshot } from "./weekly-quota";

export type CliAdapterType = "claude-cli" | "codex-cli";

/**
 * Fallback backoff window (seconds) applied when a CLI reports a rate limit but
 * gives no parseable Retry-After. Without this the pool's `resetAt` stayed null,
 * `isExhausted` was never true, and the dispatch gate in ai-inference.ts never
 * tripped — so every Build Studio agent kept firing doomed CLI children into an
 * already rate-limited pool (the codex `docker exec` retry-storm that starved
 * the portal event loop / Docker daemon). A bounded default converts that storm
 * into an orderly "back off, fall back, re-probe after the window" cycle. A
 * successful call clears the row immediately via clearCliRateLimit, so the
 * window is only ever an upper bound. Env-overridable for operators.
 */
const DEFAULT_CLI_COOLDOWN_SECONDS =
  Number(process.env.DPF_CLI_RATELIMIT_DEFAULT_COOLDOWN_SECONDS) || 60;

/**
 * Upper bound (seconds) on any parsed/derived cooldown, so a misparsed provider
 * message (or a genuinely multi-hour subscription reset) can never wedge a CLI
 * provider off the fallback chain for longer than this. We re-probe at the cap
 * and re-record if still limited. 1 hour.
 */
const MAX_CLI_COOLDOWN_SECONDS = 3_600;

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
  /**
   * Real remaining-weekly-allocation signal (the honest replacement for the
   * exhaustion proxy). Fraction 0..1 of the weekly subscription window consumed;
   * null until a snapshot has been collected. See weekly-quota.ts.
   */
  weeklyUtilization: number | null;
  /** Provider-authoritative weekly reset time. Null when unknown. */
  weeklyResetAt: Date | null;
  /** Which provider signal produced weeklyUtilization. Null when unknown. */
  weeklySource: string | null;
  /** When the weekly snapshot was taken (staleness gate). Null when unknown. */
  weeklyObservedAt: Date | null;
}

/** Map a raw CliPoolStatus row's weekly-quota columns onto the state shape. */
function weeklyFields(row: {
  weeklyUtilization: number | null;
  weeklyResetAt: Date | null;
  weeklySource: string | null;
  weeklyObservedAt: Date | null;
}): Pick<CliPoolState, "weeklyUtilization" | "weeklyResetAt" | "weeklySource" | "weeklyObservedAt"> {
  return {
    weeklyUtilization: row.weeklyUtilization,
    weeklyResetAt: row.weeklyResetAt,
    weeklySource: row.weeklySource,
    weeklyObservedAt: row.weeklyObservedAt,
  };
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

  // "try again in 2h 30m" / "2 hours 30 minutes" / "5 minutes" — ChatGPT/Codex
  // subscription limits report reset windows in hours/minutes, not seconds, so
  // the seconds-only patterns above miss them. Sum any hour + minute components.
  const hourMatch = /(\d+)\s*h(?:ours?|r)?\b/i.exec(stderr);
  const minMatch = /(\d+)\s*m(?:in(?:ute)?s?)?\b/i.exec(stderr);
  if (hourMatch || minMatch) {
    const hours = hourMatch ? parseInt(hourMatch[1]!, 10) : 0;
    const mins = minMatch ? parseInt(minMatch[1]!, 10) : 0;
    const total = hours * 3_600 + mins * 60;
    if (total > 0) return total;
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
    // Always back off on a recorded rate limit: use the provider's Retry-After
    // when it gave one, otherwise a bounded default window. Capping guards
    // against a misparse (or a genuinely long subscription reset) pinning the
    // provider off the fallback chain indefinitely. `retryAfterSeconds` still
    // records only what was actually parsed (may be null) for observability;
    // `resetAt` is what the dispatch gate reads.
    const cooldownSeconds = Math.min(
      retryAfterSeconds ?? DEFAULT_CLI_COOLDOWN_SECONDS,
      MAX_CLI_COOLDOWN_SECONDS,
    );
    const resetAt = new Date(now.getTime() + cooldownSeconds * 1_000);

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
      ...weeklyFields(row),
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
        ...weeklyFields(row),
      };
    });
  } catch (err) {
    console.warn("[cli-pool-status] Failed to read all pool statuses:", err);
    return [];
  }
}

/**
 * Record a weekly-quota snapshot for a CLI adapter — the REAL remaining-weekly-
 * allocation signal that replaces the exhaustion proxy in the drain policy.
 *
 * Writes onto the same CliPoolStatus row (one per adapter), leaving the
 * exhaustion fields (resetAt / retryAfterSeconds) untouched. A snapshot is not a
 * rate-limit event: `resetAt` stays whatever it was, so `isExhausted` is
 * unaffected. On first-ever write the row needs a `rateLimitedAt` (schema-
 * required); we use the snapshot's observedAt as a neutral create timestamp
 * while leaving `resetAt` null, so a quota-only row reads as NOT exhausted.
 *
 * Fire-and-forget: swallows errors so quota tracking never breaks a caller.
 */
export async function recordCliWeeklyQuota(
  adapterType: CliAdapterType,
  providerId: string,
  snapshot: WeeklyQuotaSnapshot,
): Promise<void> {
  try {
    await prisma.cliPoolStatus.upsert({
      where: { adapterType },
      create: {
        adapterType,
        providerId,
        // Neutral create timestamp; resetAt stays null → not exhausted.
        rateLimitedAt: snapshot.observedAt,
        weeklyUtilization: snapshot.utilization,
        weeklyResetAt: snapshot.resetAt,
        weeklySource: snapshot.source,
        weeklyObservedAt: snapshot.observedAt,
        updatedAt: snapshot.observedAt,
      },
      update: {
        providerId,
        weeklyUtilization: snapshot.utilization,
        weeklyResetAt: snapshot.resetAt,
        weeklySource: snapshot.source,
        weeklyObservedAt: snapshot.observedAt,
        updatedAt: snapshot.observedAt,
      },
    });
  } catch (err) {
    console.warn("[cli-pool-status] Failed to record weekly quota:", { adapterType }, err);
  }
}

/**
 * Clear the rate-limit record for a given adapter (e.g. after a successful call
 * proves the pool is available again).
 *
 * Preserves the weekly-quota snapshot when one is present: a successful call
 * clears *exhaustion*, but must NOT wipe the real remaining-allocation reading
 * the drain policy depends on. When the row carries no weekly snapshot, we delete
 * it (original behaviour) so an idle adapter leaves no residual row.
 */
export async function clearCliRateLimit(adapterType: CliAdapterType): Promise<void> {
  try {
    const row = await prisma.cliPoolStatus.findUnique({ where: { adapterType } });
    if (!row) return;
    if (row.weeklyUtilization == null) {
      await prisma.cliPoolStatus.deleteMany({ where: { adapterType } });
      return;
    }
    // Preserve the weekly snapshot; clear only the exhaustion fields.
    await prisma.cliPoolStatus.update({
      where: { adapterType },
      data: { resetAt: null, retryAfterSeconds: null, errorSnippet: null, updatedAt: new Date() },
    });
  } catch (err) {
    console.warn("[cli-pool-status] Failed to clear rate limit:", { adapterType }, err);
  }
}

/**
 * Human-readable relative time until a future instant: "any moment", "~5min",
 * "~3h", "~2d 4h". Returns null for a null date.
 */
function humanizeUntil(target: Date | null, now: Date): string | null {
  if (!target) return null;
  const secs = Math.round((target.getTime() - now.getTime()) / 1000);
  if (secs <= 0) return "any moment";
  if (secs < 3_600) return `~${Math.max(1, Math.round(secs / 60))}min`;
  if (secs < 86_400) return `~${Math.round(secs / 3_600)}h`;
  const days = Math.floor(secs / 86_400);
  const hours = Math.round((secs % 86_400) / 3_600);
  return hours > 0 ? `~${days}d ${hours}h` : `~${days}d`;
}

/**
 * Operator-facing weekly-allocation hint for a CLI pool — "63% weekly left ·
 * resets ~2d 4h" — from the real quota snapshot. The same number every
 * subscription client renders, surfaced on the provider row so the operator can
 * SEE remaining allocation (tell-don't-act), not just infer it from a 429.
 *
 * Returns null when there is no snapshot, or when the reading is older than
 * `maxAgeMs` (default 24h) — a display can tolerate a staler value than the drain
 * policy, but a wildly stale number should not masquerade as current.
 */
export function formatWeeklyAllocationHint(
  state: Pick<CliPoolState, "weeklyUtilization" | "weeklyResetAt" | "weeklyObservedAt">,
  now: Date = new Date(),
  maxAgeMs = 24 * 60 * 60 * 1000,
): string | null {
  if (state.weeklyUtilization == null || state.weeklyObservedAt == null) return null;
  const age = now.getTime() - state.weeklyObservedAt.getTime();
  if (age < 0 || age > maxAgeMs) return null;
  const remainingPct = Math.round(Math.min(1, Math.max(0, 1 - state.weeklyUtilization)) * 100);
  const resetHint = humanizeUntil(state.weeklyResetAt, now);
  return resetHint ? `${remainingPct}% weekly left · resets ${resetHint}` : `${remainingPct}% weekly left`;
}

/**
 * Topology-free LIVE capture: extract the weekly-quota signal from a successful
 * Anthropic HTTP response's `anthropic-ratelimit-unified-7d-*` headers and persist
 * it against the claude-cli subscription pool. A real subscription/OAuth response
 * carries these headers; API-key traffic (not on the weekly meter) does not, so
 * this is a NO-OP unless the headers are present. Fire-and-forget from the adapter
 * success path — never throws into the response flow.
 */
export async function captureAnthropicWeeklyQuota(
  providerId: string,
  headers: Headers | Record<string, string>,
): Promise<void> {
  try {
    const snapshot = parseUnifiedRateLimitHeaders(headers);
    if (!snapshot) return; // no weekly header → nothing to record (API-key path)
    await recordCliWeeklyQuota("claude-cli", providerId, snapshot);
  } catch (err) {
    console.warn("[cli-pool-status] Failed to capture Anthropic weekly quota:", { providerId }, err);
  }
}

/**
 * SEAM — live weekly-quota collection for the CLI adapters.
 *
 * The pure parsers in weekly-quota.ts turn a provider reading into a snapshot;
 * this is where a real reading would be *fetched* and handed to
 * recordCliWeeklyQuota. It is intentionally a stub because live collection
 * depends on runtime/credential topology that varies per install and could not
 * be verified in the build that introduced it (autonomous, no operator):
 *
 *   • claude-cli:  read the CLI's OAuth token (e.g. ~/.claude/.credentials.json,
 *     inside the adapter's container) → GET https://api.anthropic.com/api/oauth/usage
 *     with headers `anthropic-beta: oauth-2025-04-20` and
 *     `User-Agent: claude-code/<version>` (the User-Agent is REQUIRED — without it
 *     the endpoint drops you into an aggressively rate-limited bucket) →
 *     parseOAuthUsageJson(body).
 *   • codex-cli:  spawn `codex app-server` (JSON-RPC): send `initialize`, wait
 *     ~500ms for readiness, then `account/rateLimits/read` → parseCodexRateLimitsJson.
 *
 * Both endpoints are undocumented and their auth headers have changed before, so
 * the collector must treat a failed/parse-less read as "no signal" (return
 * without writing) — never as "plenty of quota." The direct-SDK adapter already
 * captures the unified-7d headers on success (topology-free), so this seam is the
 * remaining path, wired by a follow-up once the container/credential layout is
 * confirmed. Left unimplemented so nothing hard-codes an unverified path.
 */
export async function collectCliWeeklyQuota(_adapterType: CliAdapterType): Promise<void> {
  // UPDATE (BI-779FA953): the claude-cli oauth/usage read is now implemented as
  // an opt-in, fail-closed collector in weekly-quota-collector.ts
  // (collectClaudeCliWeeklyQuota) — off by default, driven by operator-declared
  // config. The codex-cli read (a `codex app-server` subprocess spawn) remains
  // unimplemented here pending topology confirmation, so nothing hard-codes an
  // unverified subprocess path. The topology-free direct-SDK capture still feeds
  // the signal, and the policy falls back to the proxy without a fresh snapshot.
  return;
}

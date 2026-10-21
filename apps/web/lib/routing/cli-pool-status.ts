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

import { excerptHeadAndTail } from "@/lib/shared/excerpt-head-and-tail";
import { prisma } from "@dpf/db";
import { parseUnifiedRateLimitHeaders, type WeeklyQuotaSnapshot } from "./weekly-quota";
import { conservativeQuotaScope } from "./provider-capacity/scopes";
import { loadProviderCapacitySnapshots } from "./provider-capacity/store";
import type { CapacitySnapshot } from "./capacity-routing-exclude";

export type CliAdapterType = "claude-cli" | "codex-cli";
export type CliPoolIdentity = { providerId: string; providerConnectionId: string };

export function indexCliPoolResetTimes(rows: readonly { adapterType: string | null; adapterKind?: string | null; resetAt: Date | null }[]): Map<CliAdapterType, number | null> {
  const map = new Map<CliAdapterType, number | null>();
  for (const row of rows) {
    const adapter: CliAdapterType | null = row.adapterType === "codex-cli" || row.adapterType === "claude-cli" ? row.adapterType
      : row.adapterKind === "codex" ? "codex-cli" : row.adapterKind === "claude_code" ? "claude-cli" : null;
    if (!adapter) continue;
    const reset = row.resetAt?.getTime() ?? null;
    if (!map.has(adapter) || (reset ?? 0) > (map.get(adapter) ?? 0)) map.set(adapter, reset);
  }
  return map;
}

function poolWhere(adapterType: CliAdapterType, identity?: CliPoolIdentity) {
  return identity ? { scopeKey: `cli:${adapterType}:${conservativeQuotaScope(identity.providerId)}` } : { adapterType };
}

function poolIdentityFields(adapterType: CliAdapterType, identity?: CliPoolIdentity) {
  return identity ? { adapterType: null, adapterKind: adapterType === "codex-cli" ? "codex" as const : "claude_code" as const, ...poolWhere(adapterType, identity) } : { adapterType };
}

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
 * Upper bound for fallback cooldowns when no provider reset is known.
 * Known provider resets remain authoritative, including weekly quota limits.
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
/**
 * Absolute reset stated by the ChatGPT/Codex subscription cap, e.g.
 * "try again at Sep 26th, 2026 8:57 AM". Ordinal suffixes are stripped before
 * parsing. Returns the reset instant or null when no dated phrase is present.
 * The CLI prints wall-clock time without a zone; it is read as UTC, which is
 * the sandbox's clock and errs on the early side for western operators.
 */
export function parseAbsoluteResetAt(stderr: string, now: Date = new Date()): Date | null {
  const match = /try again (?:at|on)\s+([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:[AP]M)?)?)/i.exec(stderr);
  if (!match) return parseClaudeDatedReset(stderr, now);
  const cleaned = match[1]!.replace(/(\d{1,2})(?:st|nd|rd|th)/i, "$1").replace(/\./g, "").replace(/,/g, "");
  const parsed = Date.parse(`${cleaned} UTC`);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Offset (ms) of an IANA zone from UTC at the given instant; null for an unknown zone. */
function zoneOffsetMs(timeZone: string, atMs: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone, numberingSystem: "latn", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    }).formatToParts(new Date(atMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - atMs;
  } catch {
    return null;
  }
}

/** Wall-clock time in a zone → the UTC instant (two passes settle a DST edge). */
function zonedWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number | null {
  const wall = Date.UTC(year, month, day, hour, minute);
  const first = zoneOffsetMs(timeZone, wall);
  if (first == null) return null;
  const second = zoneOffsetMs(timeZone, wall - first);
  return second == null ? null : wall - second;
}

/**
 * The Claude CLI's dated limit, e.g. "You've hit your weekly limit · resets
 * Oct 20, 4pm (UTC)" (BI-0319EE11). The banner names month, day, clock and zone
 * but no year. A clock-only banner
 * ("resets 4pm (UTC)") names no day and stays unknown (BI-EDF1BD54: never invent
 * a day); so does a zone this runtime cannot resolve.
 */
function parseClaudeDatedReset(text: string, now: Date): Date | null {
  const match = /resets\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)\s*(?:\(([^)\s]+)\))?/i.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase());
  const day = Number(match[2]);
  const hour12 = Number(match[3]);
  const minute = match[4] ? Number(match[4]) : 0;
  if (month < 0 || day < 1 || day > 31 || hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = (hour12 % 12) + (match[5]!.toLowerCase() === "pm" ? 12 : 0);
  const zone = match[6] ?? "UTC";
  // A limit window is at most a week, so the stated day is the year's
  // occurrence nearest now: Jan 3 read on Dec 30 is next year's, and a reset a
  // minute past stays past (seconds 0) rather than becoming a year away.
  const year = now.getUTCFullYear();
  let nearest: number | null = null;
  for (const candidate of [year - 1, year, year + 1]) {
    const at = zonedWallClockToUtc(candidate, month, day, hour, minute, zone);
    if (at == null) return null;
    if (nearest == null || Math.abs(at - now.getTime()) < Math.abs(nearest - now.getTime())) nearest = at;
  }
  return nearest == null ? null : new Date(nearest);
}

export function parseRetryAfterSeconds(stderr: string): number | null {
  // "try again at Sep 26th, 2026 8:57 AM" — a dated subscription cap. Checked
  // first so the bare hour/minute patterns below cannot misread "8:57 AM".
  const absolute = parseAbsoluteResetAt(stderr);
  if (absolute) return Math.max(0, Math.ceil((absolute.getTime() - Date.now()) / 1000));

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
 * Await from the adapter before fallback. Persistence errors are swallowed so
 * they never replace the InferenceError propagated to the caller.
 */
export async function recordCliRateLimit(
  adapterType: CliAdapterType,
  providerId: string,
  errorText: string,
  identity?: CliPoolIdentity,
): Promise<void> {
  try {
    const retryAfterSeconds = parseRetryAfterSeconds(errorText);
    const now = new Date();
    // Honor known provider reset windows. Only an unknown reset uses a bounded
    // default; an hourly probe must not consume capacity known to reset in days.
    const cooldownSeconds = retryAfterSeconds ?? Math.min(
      DEFAULT_CLI_COOLDOWN_SECONDS, MAX_CLI_COOLDOWN_SECONDS,
    );
    const resetAt = new Date(now.getTime() + cooldownSeconds * 1_000);
    // BI-38064739: a reset beyond the fallback cap is a subscription cap, not a
    // throttle. Record it as the provider's capacity state so routing and the
    // provider page honor the real date instead of retrying every tick.
    const subscriptionCap = retryAfterSeconds !== null && retryAfterSeconds > MAX_CLI_COOLDOWN_SECONDS;
    await recordCliCapacity(providerId,
      subscriptionCap ? new Date(now.getTime() + retryAfterSeconds * 1_000) : resetAt,
      subscriptionCap ? retryAfterSeconds : cooldownSeconds, errorText, subscriptionCap);

    await prisma.cliPoolStatus.upsert({
      where: poolWhere(adapterType, identity),
      create: {
        ...poolIdentityFields(adapterType, identity),
        providerId,
        rateLimitedAt: now,
        resetAt,
        retryAfterSeconds,
        errorSnippet: excerptHeadAndTail(errorText, 300),
        updatedAt: now,
      },
      update: {
        providerId,
        rateLimitedAt: now,
        resetAt,
        retryAfterSeconds,
        errorSnippet: excerptHeadAndTail(errorText, 300),
        updatedAt: now,
      },
    });
  } catch (err) {
    // Non-fatal: pool tracking should never interrupt the inference error path.
    console.warn("[cli-pool-status] Failed to record rate limit:", { adapterType }, err);
  }
}

/** Reconcile pre-fix capped rows with the canonical provider quota projection. */
function effectivePoolReset(row: { providerId: string; resetAt: Date | null }, capacity: Map<string, CapacitySnapshot>, now: number): Date | null {
  const known = capacity.get(row.providerId);
  const quotaReset = known?.state === "quota_resets_at" ? known.retryAtMs : null;
  return quotaReset != null && quotaReset > now && quotaReset > (row.resetAt?.getTime() ?? 0)
    ? new Date(quotaReset) : row.resetAt;
}

async function poolCapacitySnapshots(): Promise<Map<string, CapacitySnapshot>> {
  try { return await loadProviderCapacitySnapshots(); }
  catch (error) {
    console.warn("[cli-pool-status] Failed to read provider quota; retaining pool observation", error);
    return new Map();
  }
}

/**
 * Fetch the current pool state for a given CLI adapter.
 * Returns null when there is no recorded rate-limit event for this adapter.
 */
export async function getCliPoolStatus(
  adapterType: CliAdapterType,
  identity?: CliPoolIdentity,
): Promise<CliPoolState | null> {
  try {
    let row = await prisma.cliPoolStatus.findUnique({
      where: poolWhere(adapterType, identity),
    });
    // Legacy observations remain authoritative until their cooldown expires.
    // Separate credentials do not prove separate upstream quota ownership.
    if (identity) {
      const legacy = await prisma.cliPoolStatus.findUnique({ where: { adapterType } });
      if (legacy && (!row || (legacy.resetAt?.getTime() ?? 0) > (row.resetAt?.getTime() ?? 0))) row = legacy;
    }
    if (!row) return null;

    const now = Date.now();
    const resetAt = effectivePoolReset(row, await poolCapacitySnapshots(), now);
    const resetMs = resetAt?.getTime() ?? null;
    const isExhausted = resetMs != null && resetMs > now;
    const secondsUntilReset =
      isExhausted && resetMs != null ? Math.ceil((resetMs - now) / 1_000) : null;

    return {
      adapterType,
      providerId: row.providerId,
      rateLimitedAt: row.rateLimitedAt,
      resetAt,
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
    const capacity = rows.length ? await poolCapacitySnapshots() : new Map<string, CapacitySnapshot>();
    return rows.flatMap((row): CliPoolState[] => {
      const adapterType: CliAdapterType | null = row.adapterType === "codex-cli" || row.adapterType === "claude-cli" ? row.adapterType
        : row.adapterKind === "codex" ? "codex-cli" : row.adapterKind === "claude_code" ? "claude-cli" : null;
      if (!adapterType) return [];
      const resetAt = effectivePoolReset(row, capacity, now);
      const resetMs = resetAt?.getTime() ?? null;
      const isExhausted = resetMs != null && resetMs > now;
      return [{
        adapterType,
        providerId: row.providerId,
        rateLimitedAt: row.rateLimitedAt,
        resetAt,
        retryAfterSeconds: row.retryAfterSeconds,
        errorSnippet: row.errorSnippet,
        isExhausted,
        secondsUntilReset: isExhausted && resetMs != null ? Math.ceil((resetMs - now) / 1_000) : null,
        ...weeklyFields(row),
      }];
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
  identity?: CliPoolIdentity,
): Promise<void> {
  try {
    await prisma.cliPoolStatus.upsert({
      where: poolWhere(adapterType, identity),
      create: {
        ...poolIdentityFields(adapterType, identity),
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
export async function clearCliRateLimit(adapterType: CliAdapterType, identity?: CliPoolIdentity): Promise<void> {
  try {
    const where = poolWhere(adapterType, identity);
    const row = await prisma.cliPoolStatus.findUnique({ where });
    if (!row) return;
    if (row.weeklyUtilization == null) {
      await prisma.cliPoolStatus.deleteMany({ where });
      return;
    }
    // Preserve the weekly snapshot; clear only the exhaustion fields.
    await prisma.cliPoolStatus.update({
      where,
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

/**
 * The ChatGPT subscription is one account behind two providers (codex CLI,
 * chatgpt API): a cap on one is a cap on both.
 */
const SHARED_CHATGPT_ACCOUNT_PROVIDERS = new Set(["codex", "chatgpt"]);

async function recordCliCapacity(
  providerId: string,
  retryAt: Date,
  retryAfterSeconds: number,
  errorText: string,
  subscriptionCap: boolean,
): Promise<void> {
  try {
    const { recordProviderCapacityStatus } = await import("./provider-capacity/store");
    const targets = SHARED_CHATGPT_ACCOUNT_PROVIDERS.has(providerId)
      ? [...SHARED_CHATGPT_ACCOUNT_PROVIDERS]
      : [providerId];
    await Promise.all(targets.map((target) => recordProviderCapacityStatus({
      providerId: target,
      source: "cli",
      rawSnippet: errorText,
      classification: {
        state: subscriptionCap ? "quota_resets_at" : "rate_limited",
        action: subscriptionCap ? "retry_at" : "retry_with_backoff",
        retryAt,
        retryAfterSeconds,
        safeSummary: subscriptionCap
          ? `The subscription's usage limit is reached; the provider says to try again at ${retryAt.toISOString()}.`
          : `The CLI reported a usage or rate limit. DPF will back off until ${retryAt.toISOString()}; this is a bounded retry time, not a confirmed quota reset.`,
        confidence: subscriptionCap ? "exact" : "heuristic",
        isHumanActionRequired: false,
      },
    })));
  } catch (err) {
    console.warn("[cli-pool-status] Failed to record CLI capacity:", { providerId }, err);
  }
}

// Pure weekly-quota normalizer — no server imports. Safe in tests and client code.
//
// The capacity-drain automation used to run on a PROXY signal: "the pool has not
// been rate-limited, and we're inside a fixed-day-of-week reset window, so there
// is probably unspent weekly allocation worth draining." That proxy was a
// workaround for a wrong assumption — that the provider does not expose remaining
// weekly quota. It does. Every Claude/Codex subscription client renders a weekly
// limit because the provider hands the number back on a real API surface:
//
//   • Anthropic (claude-cli):  the `anthropic-ratelimit-unified-7d-*` response
//     headers on every /v1/messages response — `-utilization` (fraction 0..1) and
//     `-reset` (unix seconds) — plus model-tier variants (7d_opus, 7d_sonnet).
//     Also the /api/oauth/usage endpoint → { seven_day: { utilization, resets_at } }.
//   • Codex (codex-cli):  `codex app-server` JSON-RPC `account/rateLimits/read` →
//     { rateLimits: { secondary: { usedPercent, resetsAt } } } (secondary = weekly).
//
// This module normalizes all three provider shapes into one WeeklyQuotaSnapshot so
// the drain policy can burn against a REAL remaining-allocation number and a
// provider-authoritative reset time, instead of the proxy + a fixed-DOW guess.
//
// It is pure parsing only — the live collection (reading container credentials,
// spawning codex app-server) is a separate seam, because it depends on runtime
// topology. See collectCliWeeklyQuota in cli-pool-status.ts.

export type WeeklyQuotaSource =
  | "anthropic-unified-headers"
  | "anthropic-oauth-usage"
  | "codex-app-server";

export interface WeeklyQuotaSnapshot {
  /** Fraction 0..1 of the weekly allocation already consumed. */
  utilization: number;
  /**
   * When the weekly window resets, as reported by the provider. Authoritative
   * when present — the research showed the true reset is a rolling ~72h anchored
   * window, NOT a fixed calendar day, so any locally-computed weekly boundary is
   * only a fallback. Null when the provider gave no reset value.
   */
  resetAt: Date | null;
  /** Which provider signal produced this reading. */
  source: WeeklyQuotaSource;
  /** When this reading was taken (for staleness gating). */
  observedAt: Date;
}

/** Clamp a raw utilization value into [0,1]; return null if not a finite number. */
function coerceUtilization(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/**
 * Coerce a provider-supplied reset value to a Date. Providers are inconsistent:
 *  - unix seconds (10-digit number or numeric string)
 *  - unix milliseconds (13-digit)
 *  - ISO-8601 string
 * Returns null for anything unparseable or non-positive.
 */
export function coerceResetDate(value: unknown): Date | null {
  if (value == null) return null;

  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    const num = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(num) || num <= 0) return null;
    // Heuristic: >= 1e12 is already milliseconds; otherwise treat as seconds.
    const ms = num >= 1e12 ? num : num * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Read a header case-insensitively from a Headers, Map, or plain record. */
function getHeader(
  headers: Headers | Map<string, string> | Record<string, string>,
  name: string,
): string | null {
  const lower = name.toLowerCase();
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? (headers as Headers).get(lower) ?? null;
  }
  const rec = headers as Record<string, string>;
  for (const key of Object.keys(rec)) {
    if (key.toLowerCase() === lower) return rec[key] ?? null;
  }
  return null;
}

/** Collect every header key/value as lowercase-keyed entries. */
function headerEntries(
  headers: Headers | Map<string, string> | Record<string, string>,
): Array<[string, string]> {
  if (typeof (headers as Headers).forEach === "function" && typeof (headers as Headers).get === "function") {
    const out: Array<[string, string]> = [];
    (headers as Headers).forEach((v, k) => out.push([k.toLowerCase(), v]));
    return out;
  }
  if (headers instanceof Map) {
    return [...headers.entries()].map(([k, v]) => [k.toLowerCase(), String(v)]);
  }
  return Object.entries(headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]);
}

/**
 * Parse Anthropic unified rate-limit headers into a weekly snapshot.
 *
 * The weekly window is `anthropic-ratelimit-unified-7d-*`, but tier-scoped
 * variants (`7d_opus`, `7d_sonnet`) each carry their own budget and can be the
 * binding constraint. We take the MOST-RESTRICTIVE weekly window (max utilization)
 * and its matching reset, so we never over-report remaining allocation.
 *
 * Returns null when no `unified-7d*-utilization` header is present (e.g. an
 * API-key request that isn't on the subscription weekly meter).
 */
export function parseUnifiedRateLimitHeaders(
  headers: Headers | Map<string, string> | Record<string, string>,
  observedAt: Date = new Date(),
): WeeklyQuotaSnapshot | null {
  const entries = headerEntries(headers);
  // Match any weekly claim: unified-7d-utilization, unified-7d_opus-utilization, …
  const utilRe = /^anthropic-ratelimit-unified-(7d[\w-]*)-utilization$/;

  let bestUtil: number | null = null;
  let bestClaim: string | null = null;
  for (const [key, val] of entries) {
    const m = utilRe.exec(key);
    if (!m) continue;
    const u = coerceUtilization(val);
    if (u == null) continue;
    if (bestUtil == null || u > bestUtil) {
      bestUtil = u;
      bestClaim = m[1]!;
    }
  }

  if (bestUtil == null || bestClaim == null) return null;

  const resetRaw = getHeader(headers, `anthropic-ratelimit-unified-${bestClaim}-reset`);
  return {
    utilization: bestUtil,
    resetAt: coerceResetDate(resetRaw),
    source: "anthropic-unified-headers",
    observedAt,
  };
}

/**
 * Parse the /api/oauth/usage JSON body (Claude Code's HUD source) into a weekly
 * snapshot. Shape: { seven_day: { utilization, resets_at }, seven_day_sonnet: {…} }.
 * Takes the most-restrictive of the weekly buckets.
 */
export function parseOAuthUsageJson(
  body: unknown,
  observedAt: Date = new Date(),
): WeeklyQuotaSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  const buckets = ["seven_day", "seven_day_sonnet", "seven_day_opus"];
  let bestUtil: number | null = null;
  let bestReset: unknown = null;
  for (const name of buckets) {
    const bucket = obj[name];
    if (!bucket || typeof bucket !== "object") continue;
    const b = bucket as Record<string, unknown>;
    const u = coerceUtilization(b.utilization ?? b.used_percentage);
    if (u == null) continue;
    // Some payloads report used_percentage as 0..100; coerceUtilization clamps
    // to [0,1], so a 0..100 value would saturate at 1. Detect and rescale.
    const rawPct = typeof b.used_percentage === "number" ? b.used_percentage : null;
    const util = rawPct != null && rawPct > 1 ? Math.min(1, rawPct / 100) : u;
    if (bestUtil == null || util > bestUtil) {
      bestUtil = util;
      bestReset = b.resets_at ?? b.reset ?? null;
    }
  }

  if (bestUtil == null) return null;
  return {
    utilization: bestUtil,
    resetAt: coerceResetDate(bestReset),
    source: "anthropic-oauth-usage",
    observedAt,
  };
}

/**
 * Parse the `codex app-server` `account/rateLimits/read` JSON-RPC result into a
 * weekly snapshot. Shape: { rateLimits: { primary: {…5h}, secondary: { usedPercent,
 * resetsAt } } }. `secondary` is the weekly window; `usedPercent` is 0..100.
 * Accepts either the full JSON-RPC envelope ({ result: { rateLimits } }) or the
 * bare rateLimits object.
 */
export function parseCodexRateLimitsJson(
  body: unknown,
  observedAt: Date = new Date(),
): WeeklyQuotaSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const result = (root.result && typeof root.result === "object" ? root.result : root) as Record<string, unknown>;
  const rateLimits = result.rateLimits ?? result.rate_limits;
  if (!rateLimits || typeof rateLimits !== "object") return null;

  const secondary = (rateLimits as Record<string, unknown>).secondary;
  if (!secondary || typeof secondary !== "object") return null;
  const s = secondary as Record<string, unknown>;

  const pct = s.usedPercent ?? s.used_percent ?? s.utilization;
  let util: number | null = null;
  if (typeof pct === "number" || typeof pct === "string") {
    const n = Number(pct);
    if (Number.isFinite(n)) util = n > 1 ? Math.min(1, n / 100) : Math.min(1, Math.max(0, n));
  }
  if (util == null) return null;

  return {
    utilization: util,
    resetAt: coerceResetDate(s.resetsAt ?? s.resets_at ?? s.reset ?? null),
    source: "codex-app-server",
    observedAt,
  };
}

/** Remaining weekly allocation as a fraction 0..1 (1 = fully unused). */
export function deriveRemainingRatio(snapshot: WeeklyQuotaSnapshot): number {
  return Math.min(1, Math.max(0, 1 - snapshot.utilization));
}

/**
 * Is this snapshot fresh enough to trust? Quota readings go stale fast (the
 * account keeps spending), and the collection endpoints are undocumented and
 * have broken before — so a stale/failed read must NOT be trusted as "plenty of
 * quota." Default max age: 30 minutes.
 */
export function isWeeklyQuotaFresh(
  snapshot: WeeklyQuotaSnapshot,
  now: Date = new Date(),
  maxAgeMs = 30 * 60 * 1000,
): boolean {
  const age = now.getTime() - snapshot.observedAt.getTime();
  return age >= 0 && age <= maxAgeMs;
}

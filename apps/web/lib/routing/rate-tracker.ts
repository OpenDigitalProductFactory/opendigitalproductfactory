/**
 * EP-INF-004 — In-memory sliding-window rate tracker.
 *
 * Tracks per-model RPM (requests/min), TPM (tokens/min), and RPD (requests/day).
 * Learns limits from provider response headers (OpenAI / Anthropic).
 */

// ── Public types ──────────────────────────────────────────────────────────

export interface CapacityStatus {
  available: boolean;
  utilizationPercent: number;
  reason?: string;
}

export interface ModelRateLimits {
  rpm: number | null; // requests per minute
  tpm: number | null; // tokens per minute
  rpd: number | null; // requests per day
}

// ── Internal types ────────────────────────────────────────────────────────

interface ModelRateState {
  limits: ModelRateLimits;
  requestTimestamps: number[];
  tokenCounts: Array<{ timestamp: number; tokens: number }>;
  dailyRequests: number;
  dailyResetDate: string; // "2026-03-20" — reset when UTC date changes
}

// ── State ─────────────────────────────────────────────────────────────────

const stateMap = new Map<string, ModelRateState>();

function key(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreate(providerId: string, modelId: string): ModelRateState {
  const k = key(providerId, modelId);
  let state = stateMap.get(k);
  if (!state) {
    state = {
      limits: { rpm: null, tpm: null, rpd: null },
      requestTimestamps: [],
      tokenCounts: [],
      dailyRequests: 0,
      dailyResetDate: utcDateString(),
    };
    stateMap.set(k, state);
  }
  return state;
}

// ── Pruning ───────────────────────────────────────────────────────────────

const MINUTE_MS = 60_000;

function pruneMinuteWindow(state: ModelRateState): void {
  const cutoff = Date.now() - MINUTE_MS;
  state.requestTimestamps = state.requestTimestamps.filter((t) => t > cutoff);
  state.tokenCounts = state.tokenCounts.filter((tc) => tc.timestamp > cutoff);
}

function checkDayRollover(state: ModelRateState): void {
  const today = utcDateString();
  if (state.dailyResetDate !== today) {
    state.dailyRequests = 0;
    state.dailyResetDate = today;
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Record a completed request for a model. Call after every API call.
 */
export function recordRequest(
  providerId: string,
  modelId: string,
  tokenCount?: number,
): void {
  const state = getOrCreate(providerId, modelId);
  pruneMinuteWindow(state);
  const now = Date.now();
  state.requestTimestamps.push(now);
  if (tokenCount !== undefined) {
    state.tokenCounts.push({ timestamp: now, tokens: tokenCount });
  }
  checkDayRollover(state);
  state.dailyRequests++;
}

/**
 * Check whether a model has capacity for another request.
 */
export function checkModelCapacity(
  providerId: string,
  modelId: string,
): CapacityStatus {
  const k = key(providerId, modelId);
  const state = stateMap.get(k);

  // No state or no limits → fully available
  if (!state) {
    return { available: true, utilizationPercent: 0 };
  }

  pruneMinuteWindow(state);
  checkDayRollover(state);

  const { limits } = state;
  const hasAnyLimit =
    limits.rpm !== null || limits.tpm !== null || limits.rpd !== null;
  if (!hasAnyLimit) {
    return { available: true, utilizationPercent: 0 };
  }

  // Compute utilization for each dimension
  let maxUtil = 0;
  let constrainingDimension = "";
  let constrainingLimit = 0;

  if (limits.rpm !== null) {
    const util = (state.requestTimestamps.length / limits.rpm) * 100;
    if (util > maxUtil) {
      maxUtil = util;
      constrainingDimension = "RPM";
      constrainingLimit = limits.rpm;
    }
  }

  if (limits.tpm !== null) {
    const totalTokens = state.tokenCounts.reduce(
      (sum, tc) => sum + tc.tokens,
      0,
    );
    const util = (totalTokens / limits.tpm) * 100;
    if (util > maxUtil) {
      maxUtil = util;
      constrainingDimension = "TPM";
      constrainingLimit = limits.tpm;
    }
  }

  if (limits.rpd !== null) {
    const util = (state.dailyRequests / limits.rpd) * 100;
    if (util > maxUtil) {
      maxUtil = util;
      constrainingDimension = "RPD";
      constrainingLimit = limits.rpd;
    }
  }

  const utilizationPercent = Math.round(maxUtil * 100) / 100; // two-decimal precision
  const available = utilizationPercent < 100;

  const result: CapacityStatus = { available, utilizationPercent };
  if (!available) {
    result.reason = `${constrainingDimension} limit reached (${constrainingLimit})`;
  }
  return result;
}

/**
 * Explicitly set or update limits for a model.
 */
export function setModelLimits(
  providerId: string,
  modelId: string,
  limits: ModelRateLimits,
): void {
  const state = getOrCreate(providerId, modelId);
  state.limits = { ...limits };
}

/**
 * Learn rate limits from provider response headers.
 * Supports OpenAI and Anthropic header conventions.
 */
export function learnFromRateLimitResponse(
  providerId: string,
  modelId: string,
  headers: Record<string, string> | undefined,
): void {
  if (!headers || Object.keys(headers).length === 0) return;

  const state = getOrCreate(providerId, modelId);

  // OpenAI: x-ratelimit-limit-requests → RPM
  const openaiRpm = headers["x-ratelimit-limit-requests"];
  if (openaiRpm) {
    const parsed = parseInt(openaiRpm, 10);
    if (!isNaN(parsed)) state.limits.rpm = parsed;
  }

  // Anthropic: anthropic-ratelimit-requests-limit → RPM
  const anthropicRpm = headers["anthropic-ratelimit-requests-limit"];
  if (anthropicRpm) {
    const parsed = parseInt(anthropicRpm, 10);
    if (!isNaN(parsed)) state.limits.rpm = parsed;
  }

  // OpenAI: x-ratelimit-limit-tokens → TPM
  const tokenLimit = headers["x-ratelimit-limit-tokens"];
  if (tokenLimit) {
    const parsed = parseInt(tokenLimit, 10);
    if (!isNaN(parsed)) state.limits.tpm = parsed;
  }
}

/**
 * Parse retry/reset headers into a millisecond delay.
 */
export function extractRetryAfterMs(
  headers: Record<string, string> | undefined,
): number | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined;

  // Standard: retry-after (numeric seconds)
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const seconds = parseFloat(retryAfter);
    if (!isNaN(seconds)) return seconds * 1000;
  }

  // OpenAI: x-ratelimit-reset-requests (duration like "1m30s", "45s")
  const resetRequests = headers["x-ratelimit-reset-requests"];
  if (resetRequests) {
    return parseDuration(resetRequests);
  }

  // Anthropic: anthropic-ratelimit-requests-reset (ISO timestamp)
  const anthropicReset = headers["anthropic-ratelimit-requests-reset"];
  if (anthropicReset) {
    const resetTime = new Date(anthropicReset).getTime();
    if (!isNaN(resetTime)) {
      return Math.max(0, resetTime - Date.now());
    }
  }

  return undefined;
}

/**
 * Parse a Go-style duration string like "1m30s" or "45s" into milliseconds.
 */
function parseDuration(duration: string): number | undefined {
  const match = duration.match(
    /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/,
  );
  if (!match) return undefined;

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseFloat(match[3]) : 0;

  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Reset all tracking state. Exported for testing only.
 */
export function _resetAllTracking(): void {
  stateMap.clear();
}

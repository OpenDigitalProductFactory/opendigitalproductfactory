// apps/web/lib/api/rate-limit.ts
//
// In-memory sliding-window rate limiter.
// Acceptable for v1 self-hosted (single process). Resets on server restart.

const READ_LIMIT = 120; // requests per minute
const WRITE_LIMIT = 30; // requests per minute
const WINDOW_MS = 60_000; // 1 minute

type RequestLog = {
  timestamps: number[];
};

// Separate buckets for read and write operations
const readBuckets = new Map<string, RequestLog>();
const writeBuckets = new Map<string, RequestLog>();

/**
 * Prune timestamps older than the sliding window from a request log.
 */
function pruneOld(log: RequestLog, now: number): void {
  const cutoff = now - WINDOW_MS;
  // Find first timestamp within the window (timestamps are in order)
  let i = 0;
  while (i < log.timestamps.length && log.timestamps[i]! < cutoff) {
    i++;
  }
  if (i > 0) {
    log.timestamps.splice(0, i);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  retryAfter?: number;
};

/**
 * Check whether a request from `userId` is within rate limits.
 *
 * @param userId  The authenticated user's ID
 * @param isWrite Whether this is a write (POST/PUT/PATCH/DELETE) operation
 * @returns `{ allowed: true }` or `{ allowed: false, retryAfter: seconds }`
 */
export function checkRateLimit(userId: string, isWrite: boolean): RateLimitResult {
  const buckets = isWrite ? writeBuckets : readBuckets;
  const limit = isWrite ? WRITE_LIMIT : READ_LIMIT;
  const now = Date.now();

  let log = buckets.get(userId);
  if (!log) {
    log = { timestamps: [] };
    buckets.set(userId, log);
  }

  pruneOld(log, now);

  if (log.timestamps.length >= limit) {
    // Oldest timestamp still in the window — time until it expires
    const oldest = log.timestamps[0]!;
    const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }

  log.timestamps.push(now);
  return { allowed: true };
}

/**
 * Clear all rate limit state. Useful for testing.
 */
export function _resetRateLimits(): void {
  readBuckets.clear();
  writeBuckets.clear();
}

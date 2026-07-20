const WINDOW_MS = 60_000;
interface Bucket {
  count: number;
  resetAt: number;
}

const globalPairingRateLimits = globalThis as typeof globalThis & {
  __dpfNearbyPairingRateLimits?: Map<string, Bucket>;
};
const buckets =
  globalPairingRateLimits.__dpfNearbyPairingRateLimits ??
  (globalPairingRateLimits.__dpfNearbyPairingRateLimits = new Map());

export function checkNearbyPairingRateLimit(
  key: string,
  options: { maxRequests: number; now?: Date },
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = options.now ?? new Date();
  const timestamp = now.getTime();
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= timestamp) buckets.delete(bucketKey);
  }
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= timestamp
    ? { count: 0, resetAt: timestamp + WINDOW_MS }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count <= options.maxRequests) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1_000)),
  };
}

export function _resetNearbyPairingRateLimits(): void {
  buckets.clear();
}

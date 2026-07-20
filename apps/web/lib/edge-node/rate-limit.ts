// Edge Node per-route rate limiter.
//
// Sliding-window in-memory bucket per EdgeNode + route. Modeled after
// apps/web/lib/api/rate-limit.ts which uses the same approach for the
// portal's read/write API gate. Acceptable for DPF's single-tenant,
// single-process deployment; resets on server restart, doesn't span
// instances. A multi-instance deployment would need to move to a
// shared store (Redis) before this code is reused there.
//
// Phase 0 ceilings from the Edge Node spec § REST ingestion controls:
//
//   /api/v1/edge/heartbeat:        12 req/min per node
//   /api/v1/edge/discovery-runs:    4 req/min per node, 60/hour sustained
//   /api/v1/edge/enroll:            covered by single-use bootstrap-token
//                                   server-side constraint; no separate
//                                   rate-limit bucket needed.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § REST ingestion controls (Phase 0) — Per-node rate limits

export type EdgeRateLimitedRoute =
  | "edge.heartbeat"
  | "edge.discovery_runs.submit"
  | "edge.federation_candidates.submit"
  | "edge.adapters"
  | "edge.events.submit";

export type EdgeRateLimitResult = {
  allowed: boolean;
  /** Seconds the client should wait before retrying (set when !allowed). */
  retryAfter?: number;
  /** How many requests remain in the current window (set when allowed). */
  remaining?: number;
};

type WindowCeiling = {
  limit: number;
  windowMs: number;
};

// Per-route ceilings. Each route can declare multiple windows
// (short-burst + long-sustained) and the gate enforces the strictest
// applicable one.
const ROUTE_CEILINGS: Record<EdgeRateLimitedRoute, WindowCeiling[]> = {
  // 12 req/min — heartbeat cadence is typically every 30-60s per node;
  // 12/min absorbs reasonable rotation/retry without throttling.
  "edge.heartbeat": [{ limit: 12, windowMs: 60_000 }],
  // 4 req/min sustained AND 60/hour cap. Discovery is meant to be
  // a sweep, not a stream — most nodes do one submission per
  // sweepIntervalSec (default 300s = 5min = ~0.2/min). The 4/min
  // ceiling absorbs retry storms; the 60/hour ceiling catches
  // misbehaving nodes that retry-loop within the per-minute window.
  "edge.discovery_runs.submit": [
    { limit: 4, windowMs: 60_000 },
    { limit: 60, windowMs: 60 * 60_000 },
  ],
  // DNS-SD candidate snapshots are small and normally arrive every 15s.
  // The hourly ceiling absorbs ordinary retry jitter without allowing a
  // compromised node to turn the ephemeral cache into a request stream.
  "edge.federation_candidates.submit": [
    { limit: 20, windowMs: 60_000 },
    { limit: 300, windowMs: 60 * 60_000 },
  ],
  // Adapter polling — typically once per sweepIntervalSec (300s = ~0.2/min).
  // 12/min absorbs startup bursts + retry; same ceiling as heartbeat since
  // the payload size + cost is comparable.
  "edge.adapters": [{ limit: 12, windowMs: 60_000 }],
  // Events are bursty during incidents (interface flap, log storm) but
  // the envelope already batches up to 500 events per submission, so
  // a generous 30 req/min absorbs a real-world flap window without
  // throttling, and the 600/hour sustained cap protects against a
  // detector stuck in a tight loop. Spec: BI-9FE9D48D Slice 0.
  "edge.events.submit": [
    { limit: 30, windowMs: 60_000 },
    { limit: 600, windowMs: 60 * 60_000 },
  ],
};

type Bucket = {
  timestamps: number[];
};

// In-memory store, keyed by `${route}:${edgeNodeId}`. Resets on
// process restart per the Phase 0 contract documented in the spec's
// implementation-status table.
const buckets = new Map<string, Bucket>();

function bucketKey(route: EdgeRateLimitedRoute, edgeNodeId: string): string {
  return `${route}:${edgeNodeId}`;
}

function pruneOlder(bucket: Bucket, cutoff: number): void {
  // timestamps are appended in chronological order, so we can splice
  // from the front in one pass.
  let i = 0;
  while (i < bucket.timestamps.length && bucket.timestamps[i]! < cutoff) {
    i++;
  }
  if (i > 0) bucket.timestamps.splice(0, i);
}

/**
 * Check + record a request from the given Edge Node against the given
 * route's ceiling(s). Returns `allowed: true` and increments the
 * bucket, OR `allowed: false` with a `retryAfter` (in seconds) if any
 * ceiling is exceeded.
 *
 * The check is atomic per call: either the request consumes one slot
 * and proceeds, or it's rejected with no side effect on the bucket.
 *
 * Implementation note: the call BOTH checks AND consumes when allowed.
 * This is the same shape as `apps/web/lib/api/rate-limit.ts:checkRateLimit`
 * and matches the typical "check-and-record" semantics for sliding-
 * window limiters. A failed check does NOT consume.
 */
export function checkEdgeRateLimit(
  route: EdgeRateLimitedRoute,
  edgeNodeId: string,
): EdgeRateLimitResult {
  const now = Date.now();
  const ceilings = ROUTE_CEILINGS[route];
  const key = bucketKey(route, edgeNodeId);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }

  // Prune anything older than the longest window so the bucket stays
  // bounded — short-window checks just look at a tail slice.
  const longestWindow = ceilings.reduce((m, c) => Math.max(m, c.windowMs), 0);
  pruneOlder(bucket, now - longestWindow);

  // Check each ceiling, find the first violation (if any).
  for (const ceiling of ceilings) {
    const windowStart = now - ceiling.windowMs;
    // Count timestamps within this ceiling's window.
    let countInWindow = 0;
    for (let i = bucket.timestamps.length - 1; i >= 0; i--) {
      if (bucket.timestamps[i]! < windowStart) break;
      countInWindow++;
    }
    if (countInWindow >= ceiling.limit) {
      // Find the oldest timestamp within THIS window — when it falls
      // out, a slot frees. Forward scan since timestamps are in order;
      // the first timestamp in the window is the oldest.
      let oldest = now;
      for (const t of bucket.timestamps) {
        if (t >= windowStart) {
          oldest = t;
          break;
        }
      }
      const retryAfter = Math.max(
        1,
        Math.ceil((oldest + ceiling.windowMs - now) / 1000),
      );
      return { allowed: false, retryAfter };
    }
  }

  // All ceilings satisfied — consume one slot.
  bucket.timestamps.push(now);

  // Report remaining for the SHORTEST (most-restrictive) ceiling so
  // clients can self-throttle. Pick the ceiling with the smallest
  // window.
  const shortestCeiling = ceilings.reduce(
    (best, c) => (c.windowMs < best.windowMs ? c : best),
    ceilings[0]!,
  );
  const windowStart = now - shortestCeiling.windowMs;
  const usedInShortWindow = bucket.timestamps.filter(
    (t) => t >= windowStart,
  ).length;
  return {
    allowed: true,
    remaining: Math.max(0, shortestCeiling.limit - usedInShortWindow),
  };
}

/**
 * Test-only: clear all in-memory state. Each test that exercises the
 * limiter should call this in `beforeEach`.
 */
export function _resetEdgeRateLimits(): void {
  buckets.clear();
}

/**
 * Test / observability helper: read the ceilings for a route without
 * mutating state. Exported so route response headers (`X-RateLimit-*`)
 * can advertise the policy.
 */
export function getEdgeRateLimitCeilings(
  route: EdgeRateLimitedRoute,
): ReadonlyArray<WindowCeiling> {
  return ROUTE_CEILINGS[route];
}

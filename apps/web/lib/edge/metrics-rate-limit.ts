// Per-node rate limiting state for edge metrics ingestion.
//
// This stays outside the route module so Next route type generation only sees
// HTTP method exports from app/api/**/route.ts.

const lastAcceptedAt = new Map<string, number>();

export const EDGE_METRICS_RATE_LIMIT_INTERVAL_MS = 5_000;

export function getEdgeMetricsRateLimit(
  nodeId: string,
  now = Date.now(),
): { limited: false } | { limited: true; retryAfterSec: number } {
  const lastAccepted = lastAcceptedAt.get(nodeId) ?? 0;
  const elapsed = now - lastAccepted;

  if (elapsed >= EDGE_METRICS_RATE_LIMIT_INTERVAL_MS) {
    return { limited: false };
  }

  return {
    limited: true,
    retryAfterSec: Math.ceil((EDGE_METRICS_RATE_LIMIT_INTERVAL_MS - elapsed) / 1000),
  };
}

export function markEdgeMetricsAccepted(nodeId: string, acceptedAt = Date.now()): void {
  lastAcceptedAt.set(nodeId, acceptedAt);
}

export function resetEdgeMetricsRateLimitForTesting(): void {
  lastAcceptedAt.clear();
}

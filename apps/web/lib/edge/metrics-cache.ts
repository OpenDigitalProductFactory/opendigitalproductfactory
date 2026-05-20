// In-memory metrics cache with 90 s TTL for edge node telemetry.
//
// Singleton — a single process-wide instance is sufficient for the
// portal (one Node.js process). If the portal ever scales to multiple
// replicas, replace this with a Redis-backed variant.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md

import type { EdgeMetricsPayload } from "@dpf/validators";

interface CachedMetrics extends EdgeMetricsPayload {
  receivedAt: string;
}

class MetricsCache {
  private readonly cache: Map<string, CachedMetrics> = new Map();
  private readonly ttlMs = 90_000; // 90 s per spec

  constructor() {
    // Eviction runs every 10 s — keeps memory bounded without
    // needing per-entry timers.
    setInterval(() => this.evictStale(), 10_000).unref?.();
  }

  /** Store (or overwrite) metrics for a node. */
  set(nodeId: string, metrics: CachedMetrics): void {
    this.cache.set(nodeId, metrics);
  }

  /** Retrieve non-expired metrics for a specific node, or undefined. */
  get(nodeId: string): CachedMetrics | undefined {
    const metrics = this.cache.get(nodeId);
    if (!metrics) return undefined;

    const age = Date.now() - new Date(metrics.receivedAt).getTime();
    if (age > this.ttlMs) {
      this.cache.delete(nodeId);
      return undefined;
    }

    return metrics;
  }

  /** All non-expired cached entries. Triggers eviction first. */
  getAll(): CachedMetrics[] {
    this.evictStale();
    return Array.from(this.cache.values());
  }

  /** Number of live entries (before expiry check). */
  size(): number {
    return this.cache.size;
  }

  /** Remove all entries (useful in tests). */
  clear(): void {
    this.cache.clear();
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [nodeId, metrics] of this.cache.entries()) {
      const age = now - new Date(metrics.receivedAt).getTime();
      if (age > this.ttlMs) {
        this.cache.delete(nodeId);
      }
    }
  }
}

export const metricsCache = new MetricsCache();

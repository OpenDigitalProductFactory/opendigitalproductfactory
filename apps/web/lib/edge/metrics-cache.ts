// In-memory metrics cache with 90 s TTL for edge node telemetry.
//
// Stores the most-recent MetricsEnvelope per nodeId (Phase 1 keying).
// Phase 2 will refine to (nodeId, deviceKey, ifName) per spec §6.2 once
// the topology view's subscription model is in place.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   §6.2 — 90 s TTL, in-memory, no PostgreSQL writes

import type { MetricsEnvelope } from "@dpf/validators";

interface CachedEnvelope extends MetricsEnvelope {
  /** ISO-8601 timestamp when the envelope was received by the portal. */
  receivedAt: string;
  /** nodeId resolved from the bearer token (authoritative). */
  resolvedNodeId: string;
}

class MetricsCache {
  private readonly cache: Map<string, CachedEnvelope> = new Map();
  private readonly ttlMs = 90_000; // 90 s per spec §6.2

  constructor() {
    // Eviction runs every 10 s — keeps memory bounded without per-entry timers.
    setInterval(() => this.evictStale(), 10_000).unref?.();
  }

  /** Store (or overwrite) the latest envelope for a node. */
  set(resolvedNodeId: string, envelope: MetricsEnvelope): void {
    this.cache.set(resolvedNodeId, {
      ...envelope,
      receivedAt: new Date().toISOString(),
      resolvedNodeId,
    });
  }

  /** Retrieve the most-recent non-expired envelope for a node. */
  get(nodeId: string): CachedEnvelope | undefined {
    const entry = this.cache.get(nodeId);
    if (!entry) return undefined;

    const age = Date.now() - new Date(entry.receivedAt).getTime();
    if (age > this.ttlMs) {
      this.cache.delete(nodeId);
      return undefined;
    }

    return entry;
  }

  /** All non-expired cached envelopes. Triggers eviction first. */
  getAll(): CachedEnvelope[] {
    this.evictStale();
    return Array.from(this.cache.values());
  }

  /** Number of live entries. */
  size(): number {
    return this.cache.size;
  }

  /** Remove all entries (for tests). */
  clear(): void {
    this.cache.clear();
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [nodeId, entry] of this.cache.entries()) {
      const age = now - new Date(entry.receivedAt).getTime();
      if (age > this.ttlMs) {
        this.cache.delete(nodeId);
      }
    }
  }
}

export const metricsCache = new MetricsCache();

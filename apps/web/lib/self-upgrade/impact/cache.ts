// apps/web/lib/self-upgrade/impact/cache.ts
//
// Process-local cache keyed by (currentLineageSha, targetSha). A given
// (lineage, target) pair is immutable — neither SHA changes without a
// successful self-upgrade run flipping the lineage marker — so a process
// lifetime is plenty. The cache is mostly there to avoid re-running `git log`
// + the LLM phrasing call when the operator clicks "What's in this update?"
// twice in a row (and to make a follow-up MCP call cheap).
//
// A null entry means "we've checked and there's no summary applicable for
// this pair" (e.g. lineage === target) — also worth caching so we don't
// keep retrying.

import type { SummaryResult } from "./types";

const TTL_MS = 60 * 60 * 1000; // 1h — refreshed on demand if operator reopens.

type Entry = { value: SummaryResult; expiresAt: number };

const _cache = new Map<string, Entry>();

export function cacheKey(currentLineageSha: string | null, targetSha: string | null): string {
  return `${currentLineageSha ?? "_none_"}::${targetSha ?? "_none_"}`;
}

export function getCached(currentLineageSha: string | null, targetSha: string | null): SummaryResult | null {
  const key = cacheKey(currentLineageSha, targetSha);
  const entry = _cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCached(
  currentLineageSha: string | null,
  targetSha: string | null,
  value: SummaryResult,
): void {
  _cache.set(cacheKey(currentLineageSha, targetSha), {
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

/** Test-only — reset the cache between cases. */
export function _resetCacheForTest(): void {
  _cache.clear();
}

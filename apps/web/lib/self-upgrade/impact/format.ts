// apps/web/lib/self-upgrade/impact/format.ts
//
// Presentation helpers for the upgrade impact summary, shared by the
// "What's in this update?" panel (UpgradeImpactPanel) and the Latest Run card
// (SelfUpgradeClient). Kept framework-agnostic (plain string in, plain string
// out) so both a client component and a server action can call it.

import type { ImpactCategoryCounts } from "./types";

/**
 * Human-readable one-line scope ribbon for a set of impact counts, e.g.
 * "1 breaking · 5 new · 2 perf · 3 fixes". Falls back to a bare change count
 * ("12 changes") when no category has a non-zero tally. This is the plain-words
 * answer to "how big is this upgrade?" that a raw SHA pair never gave.
 */
export function formatImpactCounts(counts: ImpactCategoryCounts): string {
  // Summaries persisted under the earlier taxonomy carry only the original five
  // keys, so every read is `?? 0` — a missing key is "none of those", never NaN.
  const n = (value: number | undefined): number => value ?? 0;
  const parts: string[] = [];
  const push = (count: number, label: string) => {
    if (count > 0) parts.push(`${count} ${label}`);
  };
  push(n(counts.breaking), "breaking");
  push(n(counts.security), "security");
  push(n(counts.feature), "new");
  push(n(counts.performance), "perf");
  push(n(counts.fix), `fix${n(counts.fix) === 1 ? "" : "es"}`);
  push(n(counts.dependency), "dependency");
  push(n(counts.documentation), "docs");
  push(n(counts.maintenance), "internal");
  push(n(counts.other), "other");
  if (parts.length === 0) {
    return `${counts.total} change${counts.total === 1 ? "" : "s"}`;
  }
  return parts.join(" · ");
}

/**
 * "12 changes" prefix for the ribbon — the total commit/change count carried by
 * the upgrade, which directly answers "how many things moved?".
 */
export function formatChangeTotal(counts: ImpactCategoryCounts): string {
  return `${counts.total} change${counts.total === 1 ? "" : "s"}`;
}

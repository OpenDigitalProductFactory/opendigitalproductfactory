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
  const parts: string[] = [];
  if (counts.breaking > 0) parts.push(`${counts.breaking} breaking`);
  if (counts.feature > 0) parts.push(`${counts.feature} new`);
  if (counts.performance > 0) parts.push(`${counts.performance} perf`);
  if (counts.fix > 0) parts.push(`${counts.fix} fix${counts.fix === 1 ? "" : "es"}`);
  if (counts.other > 0) parts.push(`${counts.other} other`);
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

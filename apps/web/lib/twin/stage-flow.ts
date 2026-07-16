// apps/web/lib/twin/stage-flow.ts
//
// Workstream C — build the twin's value-stream flow lane. Given the archetype's
// stage binding (deriveTwinValueStreamBinding) and the demand observed at each
// stage, produce the ordered TwinStageFlow[] the TwinView renders. Shared by the
// live projection (from bookings) and the demo bridge (from generated demand), so
// both show the same backbone with counts overlaid.
//
// PURE. Kept free of the living-business-snapshot module so there is no import
// cycle; the tiny wait formatter is inlined.

import type { TwinValueStreamBinding } from "@dpf/storefront-templates";

import type { TwinStageFlow } from "@/components/twin/snapshot";

export interface StageDemand {
  count: number;
  longestWaitMs?: number;
}

function fmtWait(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/**
 * Project a per-stage demand map onto the archetype's ordered value-stream
 * backbone. Every stage the archetype has appears (count 0 where no demand), so
 * the strip always shows the full stream with the live/demo demand overlaid.
 */
export function buildStageFlow(
  binding: TwinValueStreamBinding,
  demandByStage: Record<string, StageDemand>,
): TwinStageFlow[] {
  return binding.stages.map((s) => {
    const d = demandByStage[s.stageKey];
    return {
      stageKey: s.stageKey,
      label: s.stageLabel,
      order: s.order,
      loadBearing: s.loadBearing,
      count: d?.count ?? 0,
      ...(d?.longestWaitMs && d.longestWaitMs > 0 ? { longestWait: fmtWait(d.longestWaitMs) } : {}),
    };
  });
}

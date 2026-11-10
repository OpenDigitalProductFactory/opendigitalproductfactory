// apps/web/lib/routing/route-confidence.ts
//
// BI-A08285BC: build the routing-confidence signal that travels on RouteDecision.
//
// `qualityFloorRelaxed` was set in the hard filter, threaded all the way up to
// the decision, and then concatenated into a rationale sentence that nothing
// read. Behaviour must not depend on parsing prose, for the same reason
// preferenceResolution is structural — so the signal is assembled here and
// carried as data.
//
// It lives in its own module rather than inline in pipeline-v2 because that file
// sits at its size ceiling: a hotspot is a place changes are hard to make safely,
// and this is a change that wants to be easy to extend.
//
// Spec: docs/superpowers/specs/2026-09-18-quality-by-process-not-by-floor-design.md §4

import type { RoutingConfidenceSignal } from "@/lib/deliberation/routing-confidence";

export function buildRoutingConfidence(
  qualityFloorRelaxed: boolean,
  candidateCount: number,
  preferenceFallbackUsed?: boolean,
): RoutingConfidenceSignal {
  return {
    qualityFloorRelaxed,
    candidateCount,
    ...(preferenceFallbackUsed ? { fallbackUsed: true } : {}),
  };
}

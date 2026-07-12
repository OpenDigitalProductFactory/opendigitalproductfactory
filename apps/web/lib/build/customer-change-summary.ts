// BI-5EA94BD1 (EP-WORK-CONVERGENCE): the customer-facing "what changed" text for
// the plain overseer layer must come from the plain-language changeNarrative
// (Band 2), NEVER from diffSummary — which is a raw diff prefix
// (fullDiff.slice(0, 500)) mislabeled as a summary. `diffSummary` is deliberately
// absent from this function's input, so the truncated diff can't leak into the
// customer view by construction. When there is no narrative this returns null and
// the plain layer should say "no plain summary yet" rather than show a misleading
// slice of the patch.
//
// Pure + unit-testable. Flipping Build Studio's default first-viewport to the
// plain layer and demoting ProcessGraph/raw-diff behind the Engineer-view toggle
// is the deferred React slice (needs live-portal verification).

import type { BuildChangeNarrative } from "@/lib/explore/feature-build-types";

export function customerChangeSummaryText(build: {
  changeNarrative?: BuildChangeNarrative | null;
}): string | null {
  const narrative = build.changeNarrative;
  const headline = narrative?.headline?.trim();
  if (!headline) return null;

  const whyItMatters = narrative?.whyItMatters?.trim();
  return whyItMatters ? `${headline} ${whyItMatters}` : headline;
}

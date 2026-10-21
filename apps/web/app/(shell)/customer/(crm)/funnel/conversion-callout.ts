// The weakest-point callout must name stages the chart renders.
// A hardcoded "Interactions" label pointed owners at a stage that only
// exists when the install has storefront activity (BI-0BAFEF84).

export type FunnelStageLabel = { label: string };

export type ConversionCallout = { stage: string; rate: string };

/**
 * Name each conversion by the adjacent stages the chart shows.
 * `rates[i]` is the conversion from `stages[i]` to `stages[i + 1]`.
 * A null rate means that pair has no denominator and is not a callout.
 */
export function conversionCallouts(
  stages: readonly FunnelStageLabel[],
  rates: readonly (string | null)[],
): ConversionCallout[] {
  const callouts: ConversionCallout[] = [];
  for (let i = 0; i < stages.length - 1; i++) {
    const rate = rates[i];
    if (rate == null) continue;
    const from = stages[i];
    const to = stages[i + 1];
    if (!from || !to) continue;
    callouts.push({ stage: `${from.label} to ${to.label}`, rate });
  }
  return callouts;
}

export function weakestConversion(callouts: readonly ConversionCallout[]): ConversionCallout | null {
  if (callouts.length === 0) return null;
  return callouts.reduce((min, callout) => (Number(callout.rate) < Number(min.rate) ? callout : min));
}

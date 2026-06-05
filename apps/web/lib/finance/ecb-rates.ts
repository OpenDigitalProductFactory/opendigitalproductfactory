// ECB Euro foreign-exchange reference rates.
//
// The European Central Bank publishes daily reference rates (EUR base) as XML:
//   https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
// We fetch that feed and derive the GBP/EUR/USD cross-rate matrix DPF needs, so
// stored rates reflect a real source instead of a hand-edited constant.

export type FxRate = { base: string; target: string; rate: number };

const ECB_DAILY_FEED_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

// Non-EUR currencies DPF derives cross-rates for. EUR is the feed's base.
const SUPPORTED_NON_EUR = ["USD", "GBP"] as const;

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Parse the ECB daily XML and derive the full GBP/EUR/USD cross-rate matrix.
 * The feed gives `units of CURRENCY per 1 EUR`, so for any pair
 * base->target the rate is perEur[target] / perEur[base].
 * Throws if a required currency is absent or non-positive.
 */
export function deriveCrossRatesFromEcbXml(xml: string): FxRate[] {
  const perEur: Record<string, number> = { EUR: 1 };
  const cubeRe = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9]*\.?[0-9]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = cubeRe.exec(xml)) !== null) {
    perEur[match[1]] = Number(match[2]);
  }

  for (const currency of SUPPORTED_NON_EUR) {
    if (!(perEur[currency] > 0)) {
      throw new Error(`ECB feed missing a usable rate for ${currency}`);
    }
  }

  const currencies = ["EUR", ...SUPPORTED_NON_EUR];
  const rates: FxRate[] = [];
  for (const base of currencies) {
    for (const target of currencies) {
      if (base === target) continue;
      rates.push({ base, target, rate: round(perEur[target] / perEur[base]) });
    }
  }
  return rates;
}

/** Fetch the live ECB daily feed and return the derived cross-rate matrix. */
export async function fetchEcbReferenceRates(timeoutMs = 8000): Promise<FxRate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ECB_DAILY_FEED_URL, {
      signal: controller.signal,
      headers: { accept: "application/xml" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`ECB feed returned HTTP ${res.status}`);
    }
    const xml = await res.text();
    return deriveCrossRatesFromEcbXml(xml);
  } finally {
    clearTimeout(timer);
  }
}

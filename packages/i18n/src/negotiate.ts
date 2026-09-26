// Accept-Language negotiation: RFC 4647 "lookup" over an HTTP Accept-Language
// header (RFC 9110 §12.5.4), against the locales the caller offers.
//
// For each requested range, highest q first, the fallback chain is:
//   exact tag -> es-419 for a Latin American regional Spanish -> bare language
//   -> the first offered locale of the same language.
// Returns null when nothing matches, so the caller decides the default.

interface WeightedRange {
  tag: string;
  q: number;
  order: number;
}

function parseAcceptLanguage(header: string): WeightedRange[] {
  const ranges: WeightedRange[] = [];
  header.split(",").forEach((part, order) => {
    const [rawTag, ...params] = part.trim().split(";");
    const tag = rawTag?.trim();
    if (!tag || tag === "*") return;
    let q = 1;
    for (const param of params) {
      const [key, value] = param.split("=").map((s) => s.trim());
      if (key === "q") {
        const parsed = Number(value);
        q = Number.isFinite(parsed) ? parsed : 0;
      }
    }
    if (q <= 0) return;
    try {
      ranges.push({ tag: Intl.getCanonicalLocales(tag)[0]!, q, order });
    } catch {
      // Malformed range: ignore it, as RFC 9110 recommends.
    }
  });
  return ranges.sort((a, b) => b.q - a.q || a.order - b.order);
}

function fallbackChain(tag: string): string[] {
  const locale = new Intl.Locale(tag);
  const chain = [tag];
  if (locale.language === "es" && locale.region && locale.region !== "ES" && locale.region !== "419") {
    chain.push("es-419");
  }
  if (locale.language !== tag) chain.push(locale.language);
  return chain;
}

export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  offered: readonly string[],
): string | null {
  if (!acceptLanguage || offered.length === 0) return null;
  const byLower = new Map(offered.map((tag) => [tag.toLowerCase(), tag]));
  for (const range of parseAcceptLanguage(acceptLanguage)) {
    for (const candidate of fallbackChain(range.tag)) {
      const hit = byLower.get(candidate.toLowerCase());
      if (hit) return hit;
    }
    const language = new Intl.Locale(range.tag).language;
    const sameLanguage = offered.find((tag) => new Intl.Locale(tag).language === language);
    if (sameLanguage) return sameLanguage;
  }
  return null;
}

// apps/web/lib/org-locale/org-locale.ts
//
// The single source of truth for "what currency, locale, and country does THIS
// org operate in" (EP-ORG-LOCALE-CURRENCY / BI-0530BB74). DPF was British-by-
// default — `currency` defaulted to GBP across the schema, `StorefrontConfig`
// defaulted to Europe/London, and money was formatted per-surface with ad-hoc
// `toLocaleString("en-GB")`. For a non-UK operator every money + date surface
// rendered the wrong locale.
//
// This module makes the org's locale/currency DERIVED from the operator's own
// country (never a hardcoded foreign default) and gives every surface one
// formatter + one resolver to adopt. `OrgSettings` is the persisted spine
// (baseCurrency / locale / countryCode); this is the pure logic over it.
//
// PURE + DB-free except `resolveOrgLocale`, which takes an injected client so it
// stays test-friendly (mirrors the living-business-snapshot idiom).

export interface LocaleCurrency {
  currency: string;
  locale: string;
}

/** The neutral fallback when the org's country is unknown. USD/en-US matches the
 *  OrgSettings application default; it is a last resort, not a claim about the
 *  operator — onboarding derivation (below) should set the real values. */
export const DEFAULT_LOCALE_CURRENCY: LocaleCurrency = { currency: "USD", locale: "en-US" };

/**
 * ISO-3166 alpha-2 country → its default operating currency + BCP-47 locale.
 * Covers the common operator countries; anything unlisted derives the neutral
 * default. Deliberately small and hand-curated (not a full ISO table) — the goal
 * is "stop defaulting a US business to GBP", not exhaustive i18n.
 */
const COUNTRY_LOCALE_CURRENCY: Record<string, LocaleCurrency> = {
  US: { currency: "USD", locale: "en-US" },
  GB: { currency: "GBP", locale: "en-GB" },
  IE: { currency: "EUR", locale: "en-IE" },
  DE: { currency: "EUR", locale: "de-DE" },
  FR: { currency: "EUR", locale: "fr-FR" },
  ES: { currency: "EUR", locale: "es-ES" },
  IT: { currency: "EUR", locale: "it-IT" },
  NL: { currency: "EUR", locale: "nl-NL" },
  PT: { currency: "EUR", locale: "pt-PT" },
  AT: { currency: "EUR", locale: "de-AT" },
  BE: { currency: "EUR", locale: "nl-BE" },
  FI: { currency: "EUR", locale: "fi-FI" },
  CA: { currency: "CAD", locale: "en-CA" },
  AU: { currency: "AUD", locale: "en-AU" },
  NZ: { currency: "NZD", locale: "en-NZ" },
  CH: { currency: "CHF", locale: "de-CH" },
  SE: { currency: "SEK", locale: "sv-SE" },
  NO: { currency: "NOK", locale: "nb-NO" },
  DK: { currency: "DKK", locale: "da-DK" },
  PL: { currency: "PLN", locale: "pl-PL" },
  JP: { currency: "JPY", locale: "ja-JP" },
  CN: { currency: "CNY", locale: "zh-CN" },
  IN: { currency: "INR", locale: "en-IN" },
  SG: { currency: "SGD", locale: "en-SG" },
  HK: { currency: "HKD", locale: "en-HK" },
  AE: { currency: "AED", locale: "en-AE" },
  ZA: { currency: "ZAR", locale: "en-ZA" },
  MX: { currency: "MXN", locale: "es-MX" },
  BR: { currency: "BRL", locale: "pt-BR" },
  AR: { currency: "ARS", locale: "es-AR" },
};

/** Currency → a sensible display locale, for when only the currency is known
 *  (e.g. a persisted amount whose row carries a currency but the org has no
 *  locale set). Falls back to en-US. */
const CURRENCY_DEFAULT_LOCALE: Record<string, string> = {
  USD: "en-US", GBP: "en-GB", EUR: "en-IE", CAD: "en-CA", AUD: "en-AU",
  NZD: "en-NZ", CHF: "de-CH", SEK: "sv-SE", NOK: "nb-NO", DKK: "da-DK",
  PLN: "pl-PL", JPY: "ja-JP", CNY: "zh-CN", INR: "en-IN", SGD: "en-SG",
  HKD: "en-HK", AED: "en-AE", ZAR: "en-ZA", MXN: "es-MX", BRL: "pt-BR", ARS: "es-AR",
};

/** Derive the operating currency + locale from an ISO-3166 alpha-2 country code. */
export function deriveLocaleCurrencyFromCountry(iso2: string | null | undefined): LocaleCurrency {
  if (!iso2) return { ...DEFAULT_LOCALE_CURRENCY };
  return { ...(COUNTRY_LOCALE_CURRENCY[iso2.trim().toUpperCase()] ?? DEFAULT_LOCALE_CURRENCY) };
}

/** A display locale for a currency when the org locale is unknown. */
export function localeForCurrency(currency: string | null | undefined): string {
  return (currency && CURRENCY_DEFAULT_LOCALE[currency.toUpperCase()]) ?? "en-US";
}

/**
 * Format an amount as money in a specific currency + locale — the one formatter
 * every surface should adopt (replacing per-file `toLocaleString("en-GB")` and
 * hand-rolled symbol maps). `locale` defaults to the currency's own locale so a
 * USD amount never renders with en-GB grouping. When the currency is unknown we
 * emit a bare, locale-neutral grouped number rather than guessing a symbol.
 */
export function formatMoney(
  amount: number,
  currency: string | null | undefined,
  locale?: string | null,
  opts?: { maximumFractionDigits?: number },
): string {
  const maximumFractionDigits = opts?.maximumFractionDigits ?? 0;
  const value = maximumFractionDigits === 0 ? Math.round(amount) : amount;
  if (currency) {
    try {
      return new Intl.NumberFormat(locale ?? localeForCurrency(currency), {
        style: "currency",
        currency,
        maximumFractionDigits,
      }).format(value);
    } catch {
      // Unknown ISO currency code — fall through to a bare number.
    }
  }
  return value.toLocaleString(locale ?? "en-US", { maximumFractionDigits });
}

// ─────────────────────────── the org resolver ───────────────────────────────

export interface OrgLocaleSettings {
  currency: string;
  locale: string;
  countryCode: string | null;
}

/** Narrow structural client — satisfied by the real PrismaClient and test fakes. */
export interface OrgLocaleClient {
  orgSettings: {
    findFirst: (args: unknown) => Promise<{
      baseCurrency?: string | null;
      locale?: string | null;
      countryCode?: string | null;
    } | null>;
  };
}

/**
 * Resolve the deployment org's operating currency + locale from `OrgSettings`
 * (the single-org spine). Currency comes from the operator-set `baseCurrency`;
 * locale from `locale`; both fall back to derivation from `countryCode`, then to
 * the neutral default. Never throws for a missing settings row — a brand-new
 * deployment resolves to the default until onboarding sets the country.
 */
export async function resolveOrgLocale(
  db: OrgLocaleClient,
  opts?: { onReadFailure?: (error: unknown) => void },
): Promise<OrgLocaleSettings> {
  let settings: Awaited<ReturnType<OrgLocaleClient["orgSettings"]["findFirst"]>>;
  try {
    settings = await (
      db.orgSettings?.findFirst({
        select: { baseCurrency: true, locale: true, countryCode: true },
      }) ?? Promise.resolve(null)
    );
  } catch (error) {
    opts?.onReadFailure?.(error);
    settings = null;
  }

  if (!settings) return { ...DEFAULT_LOCALE_CURRENCY, countryCode: null };

  const countryCode = settings.countryCode?.trim().toUpperCase() || null;
  const derived = deriveLocaleCurrencyFromCountry(countryCode);
  return {
    currency: settings.baseCurrency || derived.currency,
    locale: settings.locale || derived.locale,
    countryCode,
  };
}

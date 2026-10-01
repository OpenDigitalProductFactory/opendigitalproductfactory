// apps/web/lib/org-locale/locale-context.ts
//
// LocaleContext: the one answer to "what language, formatting, direction,
// timezone, currency and units does THIS viewer get" (EP-6B33A840, L0.1
// BI-6EA9E25A; design docs/superpowers/specs/2026-09-25-localization-foundation-design.md).
// Pure: the server binding (lib/i18n/locale-context.server.ts) gathers the
// inputs once per request and calls this.
//
// Language chain, first match wins:
//   1. an admin's preview cookie (supported or pseudo locales)
//   2. Principal.preferredLanguage (supported locales; admins may keep a pseudo-locale)
//   3. the org's default language (L0.7 supplies it)
//   4. Accept-Language negotiated against SUPPORTED locales only
//   5. en-US
// Direction is derived from the language's script, never stored.

import { DEFAULT_LOCALE, direction, findLocale, localesWithStatus, negotiateLocale, type TextDirection } from "@dpf/i18n";

import { orgCurrencyFromSettings } from "./org-locale";

export type MeasurementSystem = "metric" | "us" | "uk";

export interface LocaleContext {
  language: string;
  formatLocale: string;
  dir: TextDirection;
  timeZone: string;
  displayCurrency: string;
  measurementSystem: MeasurementSystem;
}

export interface LocaleContextInputs {
  viewerIsAdmin: boolean;
  previewCookie: string | null | undefined;
  principalLanguage: string | null | undefined;
  principalTimeZone: string | null | undefined;
  orgDefaultLanguage: string | null | undefined;
  acceptLanguage: string | null | undefined;
  orgSettings: { baseCurrency?: string | null; locale?: string | null; countryCode?: string | null } | null | undefined;
  orgTimeZone: string | null | undefined;
}

function selectable(tag: string | null | undefined, viewerIsAdmin: boolean): string | null {
  const entry = findLocale(tag);
  if (!entry) return null;
  if (entry.status === "supported") return entry.tag;
  if (entry.status === "pseudo" && viewerIsAdmin) return entry.tag;
  return null;
}

function validTimeZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** Countries that do not default to metric (CLDR measurementSystem: US, LR, MM; UK is mixed). */
function measurementSystemFor(countryCode: string | null | undefined): MeasurementSystem {
  const country = countryCode?.trim().toUpperCase();
  if (country === "US" || country === "LR" || country === "MM") return "us";
  if (country === "GB") return "uk";
  return "metric";
}

export function resolveLocaleContext(inputs: LocaleContextInputs): LocaleContext {
  const chosen =
    (inputs.viewerIsAdmin ? selectable(inputs.previewCookie, true) : null) ??
    selectable(inputs.principalLanguage, inputs.viewerIsAdmin) ??
    selectable(inputs.orgDefaultLanguage, false);
  const supported = localesWithStatus("supported").map((entry) => entry.tag);
  const language = chosen ?? negotiateLocale(inputs.acceptLanguage, supported) ?? DEFAULT_LOCALE;

  // Formatting follows an explicit, real language choice; otherwise (and under a
  // pseudo-locale, which only changes copy) it stays on the org's locale, so
  // today's English output is unchanged (OBJ-ENGLISH-UNCHANGED).
  const isPseudo = findLocale(language)?.status === "pseudo";
  const formatLocale =
    chosen && !isPseudo ? chosen : inputs.orgSettings?.locale || DEFAULT_LOCALE;

  return {
    language,
    formatLocale,
    dir: direction(language),
    timeZone: validTimeZone(inputs.principalTimeZone) ?? validTimeZone(inputs.orgTimeZone) ?? "UTC",
    displayCurrency: orgCurrencyFromSettings(inputs.orgSettings),
    measurementSystem: measurementSystemFor(inputs.orgSettings?.countryCode),
  };
}

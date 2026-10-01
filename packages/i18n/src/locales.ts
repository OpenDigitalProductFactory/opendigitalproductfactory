// The supported-locale registry: which language tags DPF knows and how ready
// each one is. A locale's text direction and plural categories are DERIVED from
// Unicode CLDR through Intl, never stored here, so the registry cannot drift from
// the standard (design OBJ-LOCALE-RESOLVE).
//
//   supported  selectable by everyone and negotiable from Accept-Language
//   pseudo     generated QA locales (en-XA expanded/accented, ar-XB mirrored);
//              selectable by admins only, never negotiated
//   planned    known but not yet translated; not selectable (L3.1 activation gate)

export type LocaleStatus = "supported" | "pseudo" | "planned";

export interface LocaleEntry {
  /** Canonical BCP-47 tag. */
  tag: string;
  /** English name, shown to operators; end-user surfaces use Intl.DisplayNames. */
  englishName: string;
  status: LocaleStatus;
}

export const DEFAULT_LOCALE = "en-US";

export const LOCALES: readonly LocaleEntry[] = Object.freeze([
  { tag: "en-US", englishName: "English (United States)", status: "supported" },
  { tag: "en-XA", englishName: "Pseudo-locale (expanded text)", status: "pseudo" },
  { tag: "ar-XB", englishName: "Pseudo-locale (right-to-left)", status: "pseudo" },
  { tag: "es-419", englishName: "Spanish (Latin America)", status: "planned" },
  { tag: "es-MX", englishName: "Spanish (Mexico)", status: "planned" },
  { tag: "es-US", englishName: "Spanish (United States)", status: "planned" },
  { tag: "ar", englishName: "Arabic", status: "planned" },
]);

export function findLocale(tag: string | null | undefined): LocaleEntry | null {
  if (!tag) return null;
  const wanted = tag.trim().toLowerCase();
  return LOCALES.find((entry) => entry.tag.toLowerCase() === wanted) ?? null;
}

export function localesWithStatus(status: LocaleStatus): LocaleEntry[] {
  return LOCALES.filter((entry) => entry.status === status);
}

/** CLDR plural categories for a locale, e.g. ["one","other"] or all six for Arabic. */
export function pluralCategories(tag: string): string[] {
  return [...new Intl.PluralRules(tag).resolvedOptions().pluralCategories];
}

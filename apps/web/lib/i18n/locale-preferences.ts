// Validation for a person's own language and timezone preference (EP-6B33A840
// L0.1). Pure, so the server action and its tests share one rule. Only locales
// the registry marks `supported` are selectable; admins may also pick the
// pseudo-locales (en-XA, ar-XB) to check a screen's translation and RTL
// readiness. `planned` locales are not selectable until they pass the L3.1
// activation gate.

import { findLocale, localesWithStatus, type LocaleEntry } from "@dpf/i18n";

export interface LocalePreferencesInput {
  language: string | null | undefined;
  timeZone: string | null | undefined;
}

export type LocalePreferencesResult =
  | { ok: true; value: { preferredLanguage: string | null; timeZone: string | null } }
  | { ok: false; error: string };

export function languageOptions(viewerIsAdmin: boolean): LocaleEntry[] {
  return [
    ...localesWithStatus("supported"),
    ...(viewerIsAdmin ? localesWithStatus("pseudo") : []),
  ];
}

export function validateLocalePreferences(
  input: LocalePreferencesInput,
  viewerIsAdmin: boolean,
): LocalePreferencesResult {
  const language = input.language?.trim() || null;
  const timeZone = input.timeZone?.trim() || null;

  let preferredLanguage: string | null = null;
  if (language) {
    const entry = findLocale(language);
    const allowed = entry && (entry.status === "supported" || (entry.status === "pseudo" && viewerIsAdmin));
    if (!entry || !allowed) return { ok: false, error: "That language is not available yet." };
    preferredLanguage = entry.tag;
  }

  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      return { ok: false, error: "That time zone is not recognized." };
    }
  }

  return { ok: true, value: { preferredLanguage, timeZone } };
}

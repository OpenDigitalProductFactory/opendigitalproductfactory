"use client";

import { useMemo, useState, useTransition } from "react";

import { saveLocalePreferences } from "@/lib/actions/locale-preferences";
import { languageOptions } from "@/lib/i18n/locale-preferences";

// EP-6B33A840 L0.1 — a person's own language and time zone. Empty = follow the
// organization (and, for language, the browser). Only English is supported
// today; admins also see the two pseudo-locales used to check a screen's
// translation and right-to-left readiness.

const SELECT_CLASS =
  "shrink-0 px-3 py-2 text-xs bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)] max-w-full";

export function LocalePreferencesPanel({
  preferredLanguage,
  timeZone,
  viewerIsAdmin,
}: {
  preferredLanguage: string | null;
  timeZone: string | null;
  viewerIsAdmin: boolean;
}) {
  const saved = { language: preferredLanguage ?? "", timeZone: timeZone ?? "" };
  const [draft, setDraft] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dirty = draft.language !== lastSaved.language || draft.timeZone !== lastSaved.timeZone;

  const languages = languageOptions(viewerIsAdmin);
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveLocalePreferences({ language: draft.language || null, timeZone: draft.timeZone || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLastSaved(draft);
    });
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">Language and region</h2>
      <p className="text-sm text-[var(--dpf-muted)] mb-4">
        Your own language and time zone for this workspace. Leave them on the organization setting unless you
        need something different. More languages will appear here as they are translated.
      </p>

      <div className="space-y-3">
        <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label htmlFor="locale-pref-language" className="min-w-0">
              <span className="text-sm font-semibold text-[var(--dpf-text)]">Language</span>
              <span className="block text-xs text-[var(--dpf-muted)] mt-0.5">
                {viewerIsAdmin
                  ? "The two test languages show every screen in placeholder text so you can spot untranslated or cramped wording and check right-to-left layout."
                  : "The language the workspace is shown in."}
              </span>
            </label>
            <select
              id="locale-pref-language"
              value={draft.language}
              onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))}
              disabled={isPending}
              className={SELECT_CLASS}
            >
              <option value="">Organization setting</option>
              {languages.map((l) => (
                <option key={l.tag} value={l.tag}>
                  {l.englishName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label htmlFor="locale-pref-timezone" className="min-w-0">
              <span className="text-sm font-semibold text-[var(--dpf-text)]">Time zone</span>
              <span className="block text-xs text-[var(--dpf-muted)] mt-0.5">
                Used for times shown to you. Schedules and opening hours keep their own time zone.
              </span>
            </label>
            <select
              id="locale-pref-timezone"
              value={draft.timeZone}
              onChange={(e) => setDraft((d) => ({ ...d, timeZone: e.target.value }))}
              disabled={isPending}
              className={SELECT_CLASS}
            >
              <option value="">Organization time zone</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={save}
          disabled={isPending || !dirty}
          className="px-4 py-2 text-xs font-semibold bg-[var(--dpf-accent)] text-[var(--dpf-on-accent)] rounded disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save language and region"}
        </button>
        {error ? (
          <span role="alert" className="text-xs text-[var(--dpf-error)]">
            {error}
          </span>
        ) : (
          !dirty && !isPending && <span className="text-xs text-[var(--dpf-muted)]">Saved</span>
        )}
      </div>
    </div>
  );
}

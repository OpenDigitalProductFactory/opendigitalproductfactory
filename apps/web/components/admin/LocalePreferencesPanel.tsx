"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { ExpandableCard } from "@/components/ui/report-kit/ExpandableCard";
import { Surface } from "@/components/ui/Surface";
import { saveLocalePreferences } from "@/lib/actions/locale-preferences";
import { languageOptions } from "@/lib/i18n/locale-preferences";

// EP-6B33A840 L0.1 — a person's own language and time zone. Empty = follow the
// organization (and, for language, the browser). Only English is supported
// today; admins also see the two pseudo-locales used to check a screen's
// translation and right-to-left readiness. Copy moves into the message
// catalog with L0.2. Collapsed on arrival: the time-zone list is ~400 options,
// so it renders only once the person opens the card.

const SELECT_CLASS =
  "shrink-0 max-w-full px-3 py-2 text-xs bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]";

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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dirty = draft.language !== lastSaved.language || draft.timeZone !== lastSaved.timeZone;

  const languages = languageOptions(viewerIsAdmin);
  const zones = useMemo(() => (open ? Intl.supportedValuesOf("timeZone") : []), [open]);
  const languageLabel = languages.find((l) => l.tag === lastSaved.language)?.englishName ?? "Organization default";
  const zoneLabel = lastSaved.timeZone ? lastSaved.timeZone.replace(/_/g, " ") : "Organization default";

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
    <ExpandableCard
      id="locale-preferences"
      open={open}
      onOpenChange={setOpen}
      headingLevel={2}
      className="mt-8"
      summary={
        <>
          <span className="block text-lg font-semibold">Language and region</span>
          <span className="block text-sm text-[var(--dpf-muted)]">
            {languageLabel} · {zoneLabel}
          </span>
        </>
      }
    >
      <p className="text-sm text-[var(--dpf-muted)] mb-4">Your own settings. Leave them on the organization default.</p>

      <div className="space-y-3">
        <Surface>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label htmlFor="locale-pref-language" className="text-sm font-semibold text-[var(--dpf-text)]">
              Language
            </label>
            <select
              id="locale-pref-language"
              value={draft.language}
              onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))}
              disabled={isPending}
              className={SELECT_CLASS}
            >
              <option value="">Organization default</option>
              {languages.map((l) => (
                <option key={l.tag} value={l.tag}>
                  {l.englishName}
                </option>
              ))}
            </select>
          </div>
        </Surface>

        <Surface>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label htmlFor="locale-pref-timezone" className="text-sm font-semibold text-[var(--dpf-text)]">
              Time zone
            </label>
            <select
              id="locale-pref-timezone"
              value={draft.timeZone}
              onChange={(e) => setDraft((d) => ({ ...d, timeZone: e.target.value }))}
              disabled={isPending}
              className={SELECT_CLASS}
            >
              <option value="">Organization default</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </Surface>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <Button type="button" size="sm" onClick={save} disabled={isPending || !dirty}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {error ? (
          <span role="alert" className="text-xs text-[var(--dpf-error)]">
            {error}
          </span>
        ) : (
          !dirty && !isPending && <span className="text-xs text-[var(--dpf-muted)]">Saved</span>
        )}
      </div>
    </ExpandableCard>
  );
}

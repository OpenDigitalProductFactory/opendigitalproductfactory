"use client";

import { useId, useState, useTransition } from "react";
import { setLocalOnlyInferenceSetting } from "@/lib/actions/build-studio";
import { Notice } from "@/components/ui/report-kit/Notice";
import { useT } from "@/lib/i18n/use-t";

type Props = {
  initialEnabled: boolean;
  canWrite: boolean;
};

/** Existing platform residency policy; the parent owns placement and read errors. */
export function LocalOnlyInferenceToggle({ initialEnabled, canWrite }: Props) {
  const t = useT("setup");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const id = useId();

  function toggle(next: boolean) {
    if (!canWrite || isPending || next === enabled) return;
    setError(false);
    startTransition(async () => {
      try {
        const saved = await setLocalOnlyInferenceSetting(next);
        setEnabled(saved.enabled);
      } catch {
        setError(true);
      }
    });
  }

  return (
    <fieldset
      aria-describedby={`${id}-help`}
      aria-busy={isPending}
      className="mb-6 min-w-0 rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4 text-dpf-body text-dpf-text"
    >
      <legend className="px-1 font-semibold">{t("localInferencePolicy.heading")}</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex min-h-8 items-center gap-2">
          <input type="radio" name={id} checked={!enabled} disabled={!canWrite || isPending} onChange={() => toggle(false)} />
          {t("localInferencePolicy.cloud")}
        </label>
        <label className="flex min-h-8 items-center gap-2">
          <input type="radio" name={id} checked={enabled} disabled={!canWrite || isPending} onChange={() => toggle(true)} />
          {t("localInferencePolicy.local")}
        </label>
      </div>
      <p id={`${id}-help`} className="mt-2 text-dpf-muted">
        {t("localInferencePolicy.help")}
      </p>
      <p role="status" className="mt-2 text-dpf-caption text-dpf-muted">
        {t(isPending ? "localInferencePolicy.saving" : enabled ? "localInferencePolicy.savedLocal" : "localInferencePolicy.savedCloud")}
      </p>
      {error && <div role="alert" className="mt-2"><Notice variant="error">{t("localInferencePolicy.saveUnconfirmed")}</Notice></div>}
    </fieldset>
  );
}

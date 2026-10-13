"use client";

import { useId, useState, useTransition } from "react";
import { setLocalOnlyInferenceSetting } from "@/lib/actions/build-studio";
import { Notice } from "@/components/ui/report-kit/Notice";

type Props = {
  initialEnabled: boolean;
  canWrite: boolean;
};

/** Existing platform residency policy; the parent owns placement and read errors. */
export function LocalOnlyInferenceToggle({ initialEnabled, canWrite }: Props) {
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
      <legend className="px-1 font-semibold">Where AI may run</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex min-h-8 items-center gap-2">
          <input type="radio" name={id} checked={!enabled} disabled={!canWrite || isPending} onChange={() => toggle(false)} />
          Local and allowed cloud providers
        </label>
        <label className="flex min-h-8 items-center gap-2">
          <input type="radio" name={id} checked={enabled} disabled={!canWrite || isPending} onChange={() => toggle(true)} />
          Local only
        </label>
      </div>
      <p id={`${id}-help`} className="mt-2 text-dpf-muted">
        Applies to DPF coding and coworker tasks. Local only is not required for coding.
        It blocks cloud providers and stops work when no local model fits.
        Other routing rules still apply.
      </p>
      <p role="status" className="mt-2 text-dpf-caption text-dpf-muted">
        {isPending ? "Saving…" : enabled ? "Saved: Local only" : "Saved: Cloud allowed"}
      </p>
      {error && <div role="alert" className="mt-2"><Notice variant="error">Could not confirm the save. The last confirmed setting is shown. Try again.</Notice></div>}
    </fieldset>
  );
}

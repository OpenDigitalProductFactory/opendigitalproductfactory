"use client";

import { useState, useTransition } from "react";
import { saveCooConversationalName } from "@/lib/actions/coo-conversational-name";
import { COO_NAME_MAX_LENGTH, COO_NAME_SUGGESTION_GROUPS } from "@/lib/coworker-presentation/coo-name";

type Props = { progressId: string; initialName: string | null; disabled?: boolean };

export function CooNameSetupCard({ progressId, initialName, disabled = false }: Props) {
  const [name, setName] = useState(initialName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function saveAndContinue(value: string | null) {
    startTransition(async () => {
      setError(null);
      const result = await saveCooConversationalName({ name: value, setupProgressId: progressId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      document.dispatchEvent(new CustomEvent("setup-action", {
        detail: {
          action: "continue",
          contextUpdate: { cooConversationalName: result.value ?? "COO" },
        },
      }));
    });
  }

  const isDisabled = disabled || pending;
  return (
    <section
      aria-labelledby="coo-name-heading"
      className="fixed left-1/2 top-16 z-[59] max-h-[calc(100dvh-5rem)] w-[min(92vw,680px)] -translate-x-1/2 overflow-y-auto rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 shadow-xl"
    >
      <h2 id="coo-name-heading" className="m-0 text-sm font-semibold text-[var(--dpf-text)]">What would you like to call your AI COO?</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
        This optional, organization-visible name changes presentation only. It does not change the coworker&apos;s role, permissions, authority, audit identity, or your accountability as owner.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Suggested COO names">
        {COO_NAME_SUGGESTION_GROUPS.map((group) => (
          <fieldset key={group.label} className="min-w-0 border-0 p-0">
            <legend className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]">{group.label}</legend>
            <div className="flex flex-wrap gap-1.5">
              {group.names.map((suggestion) => (
                <button key={suggestion} type="button" disabled={isDisabled} onClick={() => setName(suggestion)}
                  className="rounded-full border border-[var(--dpf-border)] px-3 py-1 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50">
                  {suggestion}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <label htmlFor="coo-conversational-name" className="mt-3 block text-xs font-medium text-[var(--dpf-text)]">Conversational name</label>
      <input id="coo-conversational-name" value={name} maxLength={COO_NAME_MAX_LENGTH} disabled={isDisabled}
        onChange={(event) => setName(event.target.value)} placeholder="For example, Number Two or Alex"
        className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-sm text-[var(--dpf-text)]" />
      {error && <p role="alert" className="mt-2 text-xs text-[var(--dpf-error)]">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={isDisabled} onClick={() => saveAndContinue(name)}
          className="rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/20 px-4 py-2 text-xs font-medium text-[var(--dpf-accent)] disabled:opacity-50">
          {pending ? "Saving…" : "Save and continue"}
        </button>
        <button type="button" disabled={isDisabled} onClick={() => saveAndContinue(null)}
          className="rounded-md border border-[var(--dpf-border)] px-4 py-2 text-xs text-[var(--dpf-muted)] disabled:opacity-50">
          Keep COO
        </button>
      </div>
    </section>
  );
}

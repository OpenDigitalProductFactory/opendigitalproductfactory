"use client";

import { useState, useTransition } from "react";

import { confirmSupportStatus, setObservedVersion } from "./actions";

const SUPPORT_OPTIONS = [
  { value: "supported", label: "Supported" },
  { value: "approaching_end", label: "Approaching end" },
  { value: "expired", label: "Expired" },
  { value: "coverage_gap", label: "Coverage gap" },
] as const;

export function ConfirmSupportButtons({
  entityId,
  current,
}: {
  entityId: string;
  current: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {SUPPORT_OPTIONS.map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await confirmSupportStatus(entityId, opt.value);
                if (!result.ok) setError(result.error);
              });
            }}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              active
                ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/15 text-[var(--dpf-accent)]"
                : "border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]/60"
            } disabled:opacity-50`}
          >
            {opt.label}
            {active && " ✓"}
          </button>
        );
      })}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

export function SetVersionForm({
  entityId,
  current,
}: {
  entityId: string;
  current: string;
}) {
  const [value, setValue] = useState(current);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const result = await setObservedVersion(entityId, value);
          if (!result.ok) setError(result.error);
          else setSaved(true);
        });
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="e.g. v3.5.2 or 16-alpine"
        className="w-64 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-sm text-[var(--dpf-text)]"
      />
      <button
        type="submit"
        disabled={pending || value.trim() === current.trim()}
        className="rounded-full border border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10 px-3 py-1 text-xs text-[var(--dpf-accent)] disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save version"}
      </button>
      {saved && <span className="text-xs text-green-400">Saved ✓</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  );
}

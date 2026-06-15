"use client";

// EP-DATA-ARCH Phase 6: on-demand "Generate data model now" trigger for the
// Data Model aspect. Calls the refreshDataArchitecture server action and
// reflects the result inline.
import { useState, useTransition } from "react";

import { refreshDataArchitecture } from "@/lib/actions/data-architecture";

export function GenerateDataModelButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await refreshDataArchitecture();
      if (result.ok) {
        setMessage(
          `Mirror ${result.status}: ${result.created} added, ${result.updated} updated, ${result.removed} removed · ${result.stewardFindings} steward findings.`,
        );
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md border border-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-accent)] transition-colors hover:bg-[var(--dpf-surface-2)] disabled:opacity-60"
      >
        {pending ? "Generating data model…" : "Generate data model now"}
      </button>
      {message != null && <p className="text-[11px] text-[var(--dpf-success)]">{message}</p>}
      {error != null && <p className="text-[11px] text-[var(--dpf-error)]">{error}</p>}
    </div>
  );
}

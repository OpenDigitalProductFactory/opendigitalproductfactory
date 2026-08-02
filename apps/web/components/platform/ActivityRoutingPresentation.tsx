"use client";

/**
 * Presentation subcomponents for the Activity Routing Workbench
 * (BI-E3969A69). Kept out of ActivityRoutingWorkbench.tsx per the plan's
 * module-size guardrail; all humanization comes from the pure
 * lib/ai-operations-map/route-labels module so the unified topology canvas
 * can reuse it at cutover.
 */

import { useState } from "react";

export type TechnicalEntry = {
  label: string;
  value: string | null | undefined;
};

/**
 * Raw substrate ids (recipe keys, telemetry ids, route decision ids) behind a
 * collapsed disclosure with a copy affordance — visible to the engineer who
 * needs them, invisible to the operator who doesn't.
 */
export function TechnicalDetails({ entries }: { entries: TechnicalEntry[] }) {
  const shown = entries.filter((entry): entry is { label: string; value: string } => Boolean(entry.value));
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  if (shown.length === 0) return null;

  const copy = async (entry: { label: string; value: string }) => {
    try {
      await navigator.clipboard.writeText(entry.value);
      setCopiedLabel(entry.label);
      window.setTimeout(() => setCopiedLabel((current) => (current === entry.label ? null : current)), 1500);
    } catch {
      // Clipboard unavailable (permissions/http) — the id is still selectable text.
    }
  };

  return (
    <details data-technical-details className="mt-2">
      <summary className="min-h-11 cursor-pointer select-none py-2 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
        Technical details
      </summary>
      <dl className="mt-1 space-y-1 text-xs">
        {shown.map((entry) => (
          <div key={entry.label} className="flex items-center gap-2">
            <dt className="shrink-0 text-[var(--dpf-muted)]">{entry.label}</dt>
            <dd
              className="min-w-0 flex-1 truncate text-right font-mono text-[var(--dpf-text)]"
              title={entry.value}
            >
              {entry.value}
            </dd>
            <button
              type="button"
              onClick={() => void copy(entry)}
              aria-label={`Copy ${entry.label}`}
              className="min-h-11 shrink-0 rounded border border-[var(--dpf-border)] px-2 py-1.5 text-xs text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]"
            >
              {copiedLabel === entry.label ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
      </dl>
    </details>
  );
}

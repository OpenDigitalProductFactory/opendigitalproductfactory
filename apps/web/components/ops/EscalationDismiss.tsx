// Dismiss action for an escalation card (BI-8DE13577). Lets the operator clear an
// escalation they know is handled (e.g. the work shipped via a direct PR) without
// leaving /ops. Resolves the PlatformIssueReport to resolved_locally — the same
// terminal state the auto-resolve sweep uses — which frees the per-build dedupeKey
// so a genuine re-stall re-files. Advisory/manual; the auto-resolve sweep clears
// provable ghosts on its own.
"use client";

import { useState, useTransition } from "react";
import { dismissEscalation } from "@/lib/actions/quality";

export function EscalationDismiss({ reportId }: { reportId: string }) {
  const [pending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dismissed) {
    return <span className="text-[10px] text-[var(--dpf-muted)]">Dismissed</span>;
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await dismissEscalation(reportId);
            if (res.ok) setDismissed(true);
            else setError(res.error);
          })
        }
        className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
      >
        {pending ? "Dismissing…" : "Dismiss"}
      </button>
      {error ? <span className="text-[10px] text-[var(--dpf-muted)]">{error}</span> : null}
    </>
  );
}

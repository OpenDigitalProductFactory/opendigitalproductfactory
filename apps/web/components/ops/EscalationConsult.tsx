// WWMD consult widget for an escalation card (BI-0ACD9AB2).
// Shows the recommendation either way: PRE-COMPUTED by the autonomous responder
// sweep (§14 dial-up, passed as `initial`) or ON-DEMAND when the operator clicks
// (dial-low, run with the operator's own principal). Advisory only — the human
// decides; the widget never disposes of the build.
"use client";

import { useState, useTransition } from "react";
import { consultEscalation } from "@/lib/actions/quality";
import {
  escalationConsultStatusLabel,
  type StoredResponderDecision,
} from "@/lib/quality/escalation-responder";

export function EscalationConsult({
  reportId,
  initial,
}: {
  reportId: string;
  initial?: StoredResponderDecision | null;
}) {
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<StoredResponderDecision | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    startTransition(async () => {
      const res = await consultEscalation(reportId);
      if (res.ok) {
        setView({
          status: res.result.status,
          operatorActionLabel: res.result.operatorActionLabel,
          reasonSummary: res.result.reasonSummary,
        });
        setError(null);
      } else {
        setError(res.error);
      }
    });

  if (view) {
    return (
      <div className="mt-1.5 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold text-[var(--dpf-accent)]">
            WWMD: {escalationConsultStatusLabel(view.status)}
          </span>
          <span className="text-[10px] text-[var(--dpf-text)]">→ {view.operatorActionLabel}</span>
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="ml-auto text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
          >
            {pending ? "…" : "Re-consult"}
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-[var(--dpf-muted)]">{view.reasonSummary}</p>
        {error ? <p className="mt-1 text-[10px] text-[var(--dpf-muted)]">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80 disabled:opacity-50"
      >
        {pending ? "Consulting WWMD…" : "Consult WWMD"}
      </button>
      {error ? <span className="text-[10px] text-[var(--dpf-muted)]">{error}</span> : null}
    </div>
  );
}

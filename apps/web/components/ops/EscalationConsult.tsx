// Operator-triggered WWMD consult widget for an escalation card (BI-0ACD9AB2).
// HITL-first (§14 dial-low): the operator clicks, the governed decision runs with
// THEIR principal, and the kernel's recommendation is shown for the operator to
// act on — no autonomous side effects. The autonomous sweep (dial-up) layers on
// later once a system responder principal is designed.
"use client";

import { useState, useTransition } from "react";
import { consultEscalation } from "@/lib/actions/quality";
import {
  escalationConsultStatusLabel,
  type ConsultEscalationResult,
} from "@/lib/quality/escalation-responder";

export function EscalationConsult({ reportId }: { reportId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ConsultEscalationResult | null>(null);

  const run = () =>
    startTransition(async () => {
      setResult(await consultEscalation(reportId));
    });

  if (result?.ok) {
    const r = result.result;
    return (
      <div className="mt-1.5 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold text-[var(--dpf-accent)]">
            WWMD: {escalationConsultStatusLabel(r.status)}
          </span>
          <span className="text-[10px] text-[var(--dpf-text)]">→ {r.operatorActionLabel}</span>
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="ml-auto text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
          >
            {pending ? "…" : "Re-consult"}
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-[var(--dpf-muted)]">{r.reasonSummary}</p>
      </div>
    );
  }

  if (result && !result.ok) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <span className="text-[10px] text-[var(--dpf-muted)]">{result.error}</span>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80 disabled:opacity-50"
        >
          {pending ? "…" : "Retry"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="mt-1 text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80 disabled:opacity-50"
    >
      {pending ? "Consulting WWMD…" : "Consult WWMD"}
    </button>
  );
}

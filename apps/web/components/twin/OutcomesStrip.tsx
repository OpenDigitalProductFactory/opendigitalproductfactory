// apps/web/components/twin/OutcomesStrip.tsx
//
// Workstream D — the customer-outcome surface. Renders the realized outcomes the
// business is producing (revenue in, work delivered) as a prominent strip, so the
// twin shows not just activity but that real value is being delivered.
// Presentational; driven by TwinSnapshot.outcomes.

import type { Intent } from "@/components/ui/report-kit";

import type { TwinOutcome } from "./snapshot";

const INTENT_COLOR: Record<Intent, string> = {
  success: "var(--dpf-success)",
  info: "var(--dpf-info, var(--dpf-text))",
  warning: "var(--dpf-warning)",
  danger: "var(--dpf-danger)",
  neutral: "var(--dpf-text)",
  accent: "var(--dpf-accent)",
};

export interface OutcomesStripProps {
  outcomes: TwinOutcome[];
  heading?: string;
  className?: string;
}

export function OutcomesStrip({ outcomes, heading = "Delivered", className = "" }: OutcomesStripProps) {
  if (outcomes.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-stretch gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-3 ${className}`.trim()}
      aria-label={`${heading} outcomes`}
    >
      <div className="mr-1 flex items-center text-[10px] font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
        {heading}
      </div>
      {outcomes.map((o) => (
        <div key={o.key} className="flex min-w-[110px] flex-col rounded-md bg-[var(--dpf-surface-2)] px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">{o.label}</span>
          <span
            className="text-base font-semibold leading-tight"
            style={{ color: o.intent ? INTENT_COLOR[o.intent] : "var(--dpf-text)" }}
          >
            {o.value}
          </span>
          {o.hint ? <span className="text-[10px] text-[var(--dpf-muted)]">{o.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

// apps/web/components/ui/report-kit/StatCard.tsx
//
// KPI / metric tile for the reporting palette. Generalizes the bespoke summary
// cards (FinanceSummaryCard, PlatformSummaryCard, ad-hoc KPI divs) into one
// token-backed primitive. Server-usable (pure, no hooks).

import Link from "next/link";

import { intentStyle, type Intent } from "./statusColors";

export interface StatDelta {
  /** Text shown in the delta chip, e.g. "+12%" or "3 overdue". */
  label: string;
  direction: "up" | "down" | "flat";
  /** Override the auto intent (up→success, down→danger, flat→neutral). */
  intent?: Intent;
}

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** Colors the left accent border (and is the default delta basis). */
  intent?: Intent;
  delta?: StatDelta;
  /** Makes the whole card a drill-down link. */
  href?: string;
  className?: string;
}

const DELTA_ARROW: Record<StatDelta["direction"], string> = {
  up: "▲",
  down: "▼",
  flat: "→",
};

function deltaIntent(delta: StatDelta): Intent {
  if (delta.intent) return delta.intent;
  if (delta.direction === "up") return "success";
  if (delta.direction === "down") return "danger";
  return "neutral";
}

export function StatCard({
  label,
  value,
  hint,
  intent,
  delta,
  href,
  className = "",
}: StatCardProps) {
  const accent = intent ? intentStyle(intent).border : "var(--dpf-border)";

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
          {label}
        </p>
        {delta ? (
          (() => {
            const di = deltaIntent(delta);
            const style = intentStyle(di);
            return (
              <span
                data-delta-intent={di}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: style.softBg, color: style.fg }}
              >
                <span aria-hidden="true">{DELTA_ARROW[delta.direction]}</span>
                {delta.label}
              </span>
            );
          })()
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--dpf-muted)]">{hint}</p> : null}
    </>
  );

  const shared = "block rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4";
  const style = { borderLeftColor: accent, borderLeftWidth: "4px" } as const;

  if (href) {
    return (
      <Link
        href={href}
        className={`${shared} transition-colors hover:bg-[var(--dpf-surface-2)] ${className}`.trim()}
        style={style}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={`${shared} ${className}`.trim()} style={style}>
      {body}
    </div>
  );
}

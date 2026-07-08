// apps/web/components/ui/report-kit/KpiCard.tsx
//
// Value-forward KPI tile for the reporting palette. Generalizes the ~50 inline
// `text-2xl/3xl font-bold` metric blocks across the portal into one token-backed
// primitive. Server-usable (pure, no hooks).
//
// Relationship to StatCard: StatCard is a *labelled* tile (tiny uppercase label
// on top, value below, optional delta chip + drill-down) tuned for dashboards.
// KpiCard is *value-forward* (big number first, caption underneath) tuned for
// stat rows / hero numbers — the exact shape the hand-rolled `text-3xl font-bold`
// blocks take. Both share the intent model so their colors stay consistent.
//
// Color comes from the intent model in ./statusColors — never raw hex.

import Link from "next/link";

import { intentStyle, type Intent } from "./statusColors";

type Size = "sm" | "md" | "lg";
type Align = "start" | "center";

export interface KpiCardProps {
  /** The headline number/value. */
  value: React.ReactNode;
  /** Caption beneath the value, e.g. "Open invoices". */
  label: React.ReactNode;
  /** Optional third line for extra context. */
  hint?: React.ReactNode;
  /** Colors the value text (and the left accent border when `bordered`). */
  intent?: Intent;
  /** Value typography scale. `md` (default) = text-3xl. */
  size?: Size;
  /** Value/label alignment. Defaults to `start`. */
  align?: Align;
  /** Optional leading glyph shown beside the value. */
  icon?: React.ReactNode;
  /** Wrap in a bordered surface card (default true). */
  bordered?: boolean;
  /** Makes the whole tile a drill-down link. */
  href?: string;
  className?: string;
}

const VALUE_SIZE: Record<Size, string> = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
};

export function KpiCard({
  value,
  label,
  hint,
  intent,
  size = "md",
  align = "start",
  icon,
  bordered = true,
  href,
  className = "",
}: KpiCardProps) {
  const valueColor = intent ? intentStyle(intent).fg : "var(--dpf-text)";
  const accent = intent ? intentStyle(intent).border : "var(--dpf-border)";

  const body = (
    <>
      <div
        className={[
          "flex items-baseline gap-2",
          align === "center" ? "justify-center" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {icon ? (
          <span aria-hidden="true" className="text-lg" style={{ color: valueColor }}>
            {icon}
          </span>
        ) : null}
        <span
          className={`font-bold leading-tight tabular-nums ${VALUE_SIZE[size]}`}
          style={{ color: valueColor }}
        >
          {value}
        </span>
      </div>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
        {label}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">{hint}</p>
      ) : null}
    </>
  );

  const shared = [
    bordered
      ? "rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
      : "",
    align === "center" ? "text-center" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style = bordered
    ? ({ borderLeftColor: accent, borderLeftWidth: "4px" } as const)
    : undefined;

  if (href) {
    return (
      <Link
        href={href}
        className={`block ${shared} transition-colors hover:bg-[var(--dpf-surface-2)] ${className}`.trim()}
        style={style}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={`${bordered ? "block " : ""}${shared} ${className}`.trim()} style={style}>
      {body}
    </div>
  );
}

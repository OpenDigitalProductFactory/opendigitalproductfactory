// apps/web/components/twin/TwinZone.tsx
//
// Primitive 2/10 — zone: a named region of the operation (kitchen·dining·entrance /
// territory zones·yard / ready line·returns·maintenance). A titled container that
// holds resource units or work items. Pure + server-usable.

import type { ReactNode } from "react";

export interface TwinZoneProps {
  label: string;
  /** Optional right-aligned summary ("6 / 8 seated"). */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function TwinZone({ label, meta, children, className = "" }: TwinZoneProps) {
  return (
    <section
      className={`rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] ${className}`.trim()}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--dpf-border)] px-3 py-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
          {label}
        </h4>
        {meta ? <span className="text-[11px] text-[var(--dpf-muted)]">{meta}</span> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

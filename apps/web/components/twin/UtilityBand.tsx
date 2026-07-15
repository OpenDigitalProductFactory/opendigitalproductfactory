// apps/web/components/twin/UtilityBand.tsx
//
// Primitive 7/10 — utility band: the supporting activities as meters (bills, tax,
// compliance, improve) — identical across every archetype. The "pay the bills and
// taxes" surface the founder asked to keep in view. Pure + server-usable.

import { intentStyle } from "@/components/ui/report-kit";

import type { UtilityMeterData } from "./types";

export interface UtilityBandProps {
  meters: UtilityMeterData[];
  className?: string;
}

export function UtilityBand({ meters, className = "" }: UtilityBandProps) {
  return (
    <div
      className={`flex flex-wrap gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 ${className}`.trim()}
    >
      {meters.map((m) => {
        const style = intentStyle(m.intent ?? "neutral");
        return (
          <div
            key={m.key}
            className="flex min-w-[7rem] flex-1 flex-col gap-0.5 rounded-md px-2.5 py-1.5"
            style={{ backgroundColor: style.softBg }}
            title={m.hint}
          >
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
              {m.label}
            </span>
            <span className="text-sm font-semibold" style={{ color: style.fg }}>
              {m.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// apps/web/components/twin/CapacityChips.tsx
//
// Primitive 1/10 — capacity chips: the archetype's real constraints as live
// counters (tables·seats·6-tops / techs·queue·emergencies / assets·utilization·overdue).
// Pure + server-usable; the only motion is a motion-safe live dot.

import { intentStyle, type Intent } from "@/components/ui/report-kit";

import type { CapacityChipData } from "./types";

function chipStyle(intent: Intent | undefined) {
  const style = intentStyle(intent ?? "neutral");
  return { backgroundColor: style.softBg, color: style.fg, borderColor: style.border };
}

export function CapacityChip({ label, value, max, intent, live }: Omit<CapacityChipData, "key">) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
      style={chipStyle(intent)}
      data-intent={intent ?? "neutral"}
    >
      {live ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse"
        />
      ) : null}
      <span className="uppercase tracking-wide opacity-80">{label}</span>
      <span className="tabular-nums font-semibold">
        {value}
        {typeof max === "number" ? (
          <span className="opacity-60">
            {" / "}
            {max}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export interface CapacityChipsProps {
  chips: CapacityChipData[];
  className?: string;
}

/** The headline constraint row for a twin — the live limits that gate the operation. */
export function CapacityChips({ chips, className = "" }: CapacityChipsProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`.trim()}>
      {chips.map(({ key, ...chip }) => (
        <CapacityChip key={key} {...chip} />
      ))}
    </div>
  );
}

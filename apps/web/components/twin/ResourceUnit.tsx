// apps/web/components/twin/ResourceUnit.tsx
//
// Primitive 3/10 — resource unit: a countable unit (table+seats / van+tech /
// chair / room / account) with state + owner. Pure + server-usable.

import { StatusBadge } from "@/components/ui/report-kit";

import { ActorMark } from "./ActorMark";
import type { ResourceUnitData } from "./types";

export function ResourceUnit({
  label,
  state,
  intent,
  owner,
  sublabel,
}: Omit<ResourceUnitData, "key">) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--dpf-text)]">{label}</span>
        <StatusBadge intent={intent ?? "neutral"} label={state} variant="soft" size="sm" />
      </div>
      {sublabel ? (
        <span className="text-[11px] text-[var(--dpf-muted)]">{sublabel}</span>
      ) : null}
      {owner ? <ActorMark name={owner.name} kind={owner.kind} /> : null}
    </div>
  );
}

export interface ResourceUnitGridProps {
  units: ResourceUnitData[];
  className?: string;
}

/** A responsive grid of units — the interior of a zone. */
export function ResourceUnitGrid({ units, className = "" }: ResourceUnitGridProps) {
  return (
    <ul
      aria-label="Resources"
      className={`grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 ${className}`.trim()}
    >
      {units.map(({ key, ...unit }) => (
        <li key={key}>
          <ResourceUnit {...unit} />
        </li>
      ))}
    </ul>
  );
}

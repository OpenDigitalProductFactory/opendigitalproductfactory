"use client";

import type { BuildTruthSource } from "@/lib/build/progress-visibility-types";
import { getTruthSourceAge, truthSourceLabel } from "@/lib/build/progress-visibility-types";

type Props = {
  source: BuildTruthSource;
  observedAt?: string | null;
  ageLabel?: string | null;
  conflict?: boolean;
};

export function TruthSourceBadge({
  source,
  observedAt = null,
  ageLabel,
  conflict = false,
}: Props) {
  const age = ageLabel ?? getTruthSourceAge(observedAt).label;

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--dpf-text)]">
      <span>{truthSourceLabel(source)}</span>
      <span className="text-[var(--dpf-muted)]">{age}</span>
      {conflict && (
        <span className="rounded border border-[var(--dpf-warning)] px-1 text-[10px] text-[var(--dpf-warning)]">
          conflict
        </span>
      )}
    </span>
  );
}

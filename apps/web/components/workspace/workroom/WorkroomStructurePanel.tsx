import { GitBranch, Lock, Milestone, Unlock } from "lucide-react";

import { StatusBadge } from "@/components/ui/report-kit";
import type { WorkroomStructure } from "@/lib/work-management/room-structure";

type Props = {
  structure: WorkroomStructure | null;
};

const BAND_INTENT: Record<string, "neutral" | "success" | "warning"> = {
  "on-track": "neutral",
  ready: "success",
  blocked: "warning",
};

/**
 * The value stream + lifecycle the room's subject sits in — the structure the
 * collaboration happens within (EP-WORKROOM-COMMS / EP-VSL-SURFACE fold). Renders
 * nothing when the subject has no value-stream/lifecycle binding.
 */
export function WorkroomStructurePanel({ structure }: Props) {
  if (!structure || (!structure.valueStream && !structure.lifecycle)) return null;
  const { valueStream, lifecycle } = structure;

  return (
    <section
      aria-labelledby="work-room-structure-title"
      className="mt-4 rounded-lg border border-[var(--dpf-border)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Milestone className="size-4 text-[var(--dpf-muted)]" aria-hidden="true" />
        <h2
          id="work-room-structure-title"
          className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dpf-muted)]"
        >
          Structure
        </h2>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {valueStream ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
              Value stream
            </p>
            <div className="mt-1.5">
              <StatusBadge intent="neutral" label={valueStream.label} variant="soft" />
            </div>
          </div>
        ) : null}

        {lifecycle ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
              Lifecycle
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-[var(--dpf-text)]">
              <span className="font-semibold">{lifecycle.stageLabel}</span>
              <StatusBadge
                intent={BAND_INTENT[lifecycle.band] ?? "neutral"}
                label={lifecycle.stateLabel}
                variant="soft"
              />
            </div>
          </div>
        ) : null}
      </div>

      {lifecycle && lifecycle.nextGates.length > 0 ? (
        <div className="mt-3 border-t border-[var(--dpf-border)] pt-3">
          <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
            <GitBranch className="size-3.5" aria-hidden="true" />
            Advancement gates
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {lifecycle.nextGates.map((gate) => (
              <li key={gate.toStage} className="flex items-start gap-2 text-sm">
                {gate.allowed ? (
                  <Unlock className="mt-0.5 size-3.5 shrink-0 text-[var(--dpf-success)]" aria-hidden="true" />
                ) : (
                  <Lock className="mt-0.5 size-3.5 shrink-0 text-[var(--dpf-muted)]" aria-hidden="true" />
                )}
                <span className="text-[var(--dpf-text)]">
                  <span className={gate.allowed ? "font-medium" : "text-[var(--dpf-muted)]"}>
                    {gate.toStageLabel}
                  </span>
                  {!gate.allowed && gate.reason ? (
                    <span className="text-[var(--dpf-muted)]"> — {gate.reason}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

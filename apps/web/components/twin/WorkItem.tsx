// apps/web/components/twin/WorkItem.tsx
//
// Primitive 4/10 — work item: a unit of demand being processed (ticket / job /
// agreement / matter), each with owner + progress, and a distinct blocked-on-
// external state (waiting on a supplier, customer, or court — outside the
// business's control). Pure + server-usable.

import { intentStyle } from "@/components/ui/report-kit";

import { ActorMark } from "./ActorMark";
import type { WorkItemData } from "./types";

export function WorkItem({
  label,
  owner,
  progress,
  blockedOnExternal,
  blockedLabel,
  sublabel,
}: Omit<WorkItemData, "key">) {
  const accent = blockedOnExternal ? intentStyle("warning") : intentStyle("accent");
  const pct = typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border bg-[var(--dpf-surface-2)] p-2"
      style={{ borderLeftColor: accent.border, borderLeftWidth: "3px" }}
      data-blocked={blockedOnExternal ? "true" : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-[var(--dpf-text)]">{label}</span>
        {owner ? <ActorMark name={owner.name} kind={owner.kind} compact /> : null}
      </div>

      {sublabel ? (
        <span className="text-[11px] text-[var(--dpf-muted)]">{sublabel}</span>
      ) : null}

      {blockedOnExternal ? (
        <span
          className="inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: accent.softBg, color: accent.fg }}
        >
          {blockedLabel ?? "Blocked · external"}
        </span>
      ) : pct !== null ? (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-[var(--dpf-surface-3)]"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: accent.fg }}
          />
        </div>
      ) : null}
    </div>
  );
}

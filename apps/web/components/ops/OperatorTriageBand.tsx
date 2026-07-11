"use client";

// BI-9952EA9E: an operator triage lens above the raw backlog wall. Surfaces the
// small, prioritized set of items genuinely awaiting an operator decision so the
// operator sees "what needs me next" instead of scanning 470+ items of wildly
// different altitude. Selection + ordering live in the pure, tested
// lib/ops/operator-triage module; this is only the presentation.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { BacklogItemRow } from "./BacklogItemRow";
import {
  selectOperatorQueue,
  OPERATOR_TRIAGE_REASON_LABEL,
  OPERATOR_TRIAGE_REASON_HINT,
  type OperatorTriageReason,
} from "@/lib/ops/operator-triage";
import type { BacklogItemWithRelations } from "@/lib/backlog";

const MAX_VISIBLE = 7;

type Props = {
  items: BacklogItemWithRelations[];
  onEdit: (item: BacklogItemWithRelations) => void;
  focusedItemId?: string;
};

const REASON_CHIP_CLASS: Record<OperatorTriageReason, string> = {
  "awaiting-triage": "border-[var(--dpf-accent)]/40 bg-[var(--dpf-accent-soft)] text-[var(--dpf-accent)]",
  "ready-to-build": "border-[var(--dpf-success)]/40 bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]",
  "build-attention": "border-[var(--dpf-error)]/40 bg-[var(--dpf-error)]/10 text-[var(--dpf-error)]",
  blocked: "border-[var(--dpf-error)]/40 bg-[var(--dpf-error)]/10 text-[var(--dpf-error)]",
  stalled: "border-[var(--dpf-warning)]/40 bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]",
};

export function OperatorTriageBand({ items, onEdit, focusedItemId }: Props) {
  const queue = useMemo(() => selectOperatorQueue(items), [items]);
  const [open, setOpen] = useState(true);

  const total = queue.length;
  const visible = queue.slice(0, MAX_VISIBLE);
  const overflow = total - visible.length;

  return (
    <section className="mb-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="text-[var(--dpf-muted)]">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-text)]">
          Needs you next
        </h2>
        <span
          className={[
            "rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
            total > 0
              ? "bg-[var(--dpf-accent-soft)] text-[var(--dpf-accent)]"
              : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
          ].join(" ")}
        >
          {total}
        </span>
        <span className="ml-1 hidden text-[10px] text-[var(--dpf-muted)] sm:inline">
          items awaiting an operator decision — customer-blocking &amp; high-risk first
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--dpf-border)] px-3 py-3">
          {total === 0 ? (
            <p className="text-xs text-[var(--dpf-muted)]">
              You&rsquo;re clear — nothing in the backlog is waiting on an operator decision right now.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2.5">
                {visible.map((entry) => (
                  <div key={entry.item.id} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          REASON_CHIP_CLASS[entry.reason],
                        ].join(" ")}
                        title={OPERATOR_TRIAGE_REASON_HINT[entry.reason]}
                      >
                        {OPERATOR_TRIAGE_REASON_LABEL[entry.reason]}
                      </span>
                      {entry.blocksBusinessOutcome && (
                        <span
                          className="inline-flex items-center gap-1 rounded border border-[var(--dpf-error)]/40 bg-[var(--dpf-error)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--dpf-error)]"
                          title="Plausibly blocks a customer or business outcome"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Blocks outcome
                        </span>
                      )}
                    </div>
                    <BacklogItemRow
                      item={entry.item}
                      onEdit={onEdit}
                      focused={Boolean(
                        focusedItemId &&
                          (entry.item.itemId === focusedItemId || entry.item.id === focusedItemId),
                      )}
                    />
                  </div>
                ))}
              </div>
              {overflow > 0 && (
                <p className="mt-2.5 text-[10px] text-[var(--dpf-muted)]">
                  + {overflow} more awaiting you — worked below in the full backlog.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

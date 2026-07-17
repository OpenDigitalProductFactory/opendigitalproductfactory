"use client";

// BI-9952EA9E: an operator triage lens above the raw backlog wall. Surfaces the
// small, prioritized set of items genuinely awaiting an operator decision so the
// operator sees "what needs me next" instead of scanning 470+ items of wildly
// different altitude. Selection + ordering live in the pure, tested
// lib/ops/operator-triage module; this is only the presentation.
//
// BI-01CC2356: the queue is now SPLIT into a personal lens ("mine") and the
// company-wide pool. Presenting a 171-wide queue as "171 items awaiting YOUR
// decision" was misleading — most of it is routine platform throughput. The band
// defaults to the personal lens (what's genuinely on the operator's plate now)
// and lets them opt into the company-wide pool.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { BacklogItemRow } from "./BacklogItemRow";
import {
  partitionOperatorQueue,
  OPERATOR_TRIAGE_REASON_LABEL,
  OPERATOR_TRIAGE_REASON_HINT,
  type OperatorTriageEntry,
  type OperatorTriageReason,
} from "@/lib/ops/operator-triage";
import type { BacklogItemWithRelations } from "@/lib/backlog";

const MAX_VISIBLE = 7;
const MAX_COMPANY_VISIBLE = 7;

type Props = {
  items: BacklogItemWithRelations[];
  onEdit: (item: BacklogItemWithRelations) => void;
  focusedItemId?: string;
  /** Current operator's user id — resolves the "mine" scope (BI-01CC2356). */
  currentUserId?: string;
};

const REASON_CHIP_CLASS: Record<OperatorTriageReason, string> = {
  "awaiting-triage": "border-[var(--dpf-accent)]/40 bg-[var(--dpf-accent-soft)] text-[var(--dpf-accent)]",
  "ready-to-build": "border-[var(--dpf-success)]/40 bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]",
  "build-attention": "border-[var(--dpf-error)]/40 bg-[var(--dpf-error)]/10 text-[var(--dpf-error)]",
  blocked: "border-[var(--dpf-error)]/40 bg-[var(--dpf-error)]/10 text-[var(--dpf-error)]",
  stalled: "border-[var(--dpf-warning)]/40 bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]",
};

function TriageRow({
  entry,
  onEdit,
  focusedItemId,
}: {
  entry: OperatorTriageEntry;
  onEdit: (item: BacklogItemWithRelations) => void;
  focusedItemId?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
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
  );
}

export function OperatorTriageBand({ items, onEdit, focusedItemId, currentUserId }: Props) {
  const { mine, company } = useMemo(
    () => partitionOperatorQueue(items, currentUserId),
    [items, currentUserId],
  );
  const [open, setOpen] = useState(true);
  // The company-wide pool is opt-in — collapsed by default (BI-01CC2356).
  const [showCompany, setShowCompany] = useState(false);

  const mineVisible = mine.slice(0, MAX_VISIBLE);
  const mineOverflow = mine.length - mineVisible.length;
  const companyVisible = company.slice(0, MAX_COMPANY_VISIBLE);
  const companyOverflow = company.length - companyVisible.length;

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
            mine.length > 0
              ? "bg-[var(--dpf-accent-soft)] text-[var(--dpf-accent)]"
              : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
          ].join(" ")}
        >
          {mine.length}
        </span>
        <span className="ml-1 hidden text-[10px] text-[var(--dpf-muted)] sm:inline">
          on your plate now — customer-blocking &amp; high-risk first
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--dpf-border)] px-3 py-3">
          {mine.length === 0 ? (
            <p className="text-xs text-[var(--dpf-muted)]">
              You&rsquo;re clear — nothing needs you personally right now.
              {company.length > 0 && " Routine items are in the platform queue below."}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2.5">
                {mineVisible.map((entry) => (
                  <TriageRow
                    key={entry.item.id}
                    entry={entry}
                    onEdit={onEdit}
                    focusedItemId={focusedItemId}
                  />
                ))}
              </div>
              {mineOverflow > 0 && (
                <p className="mt-2.5 text-[10px] text-[var(--dpf-muted)]">
                  + {mineOverflow} more of yours — worked below in the full backlog.
                </p>
              )}
            </>
          )}

          {/* Company-wide pool — opt-in. Not the operator's personal decisions;
              the platform drives most of these. (BI-01CC2356) */}
          {company.length > 0 && (
            <div className="mt-3 border-t border-[var(--dpf-border)] pt-3">
              <button
                onClick={() => setShowCompany((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                aria-expanded={showCompany}
              >
                {showCompany ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className="tabular-nums">{company.length}</span>
                <span>in the platform queue — company-wide, mostly auto-driven</span>
              </button>
              {showCompany && (
                <>
                  <div className="mt-2.5 flex flex-col gap-2.5">
                    {companyVisible.map((entry) => (
                      <TriageRow
                        key={entry.item.id}
                        entry={entry}
                        onEdit={onEdit}
                        focusedItemId={focusedItemId}
                      />
                    ))}
                  </div>
                  {companyOverflow > 0 && (
                    <p className="mt-2.5 text-[10px] text-[var(--dpf-muted)]">
                      + {companyOverflow} more — worked below in the full backlog.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

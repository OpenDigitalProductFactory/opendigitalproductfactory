// apps/web/components/ops/EpicCard.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEpic } from "@/lib/actions/backlog";
import {
  EPIC_STATUS_COLOURS,
  type EpicWithRelations,
  type BacklogItemWithRelations,
} from "@/lib/backlog";
import { BacklogItemRow } from "./BacklogItemRow";

type Props = {
  epic: EpicWithRelations;
  onEdit: (epic: EpicWithRelations) => void;
  onItemEdit: (item: BacklogItemWithRelations) => void;
};

export function EpicCard({ epic, onEdit, onItemEdit }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const doneCount = epic.items.filter((i) => i.status === "done").length;
  const totalCount = epic.items.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const statusColour = EPIC_STATUS_COLOURS[epic.status] ?? "#555566";
  const portfolioLabels = epic.portfolios.map((p) => p.portfolio.name).join(" · ");

  function handleDelete() {
    startTransition(async () => {
      await deleteEpic(epic.id);
      router.refresh();
    });
  }


  return (
    <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] mb-3">
      {/* Card header */}
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 mt-0.5 text-[var(--dpf-muted)] hover:text-white text-xs w-4"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "▼" : "▶"}
        </button>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[9px] font-mono text-[var(--dpf-muted)]">{epic.epicId}</span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: `${statusColour}20`, color: statusColour }}
            >
              {epic.status}
            </span>
          </div>
          <p className="text-sm font-semibold text-white leading-tight truncate">{epic.title}</p>
          {portfolioLabels && (
            <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5">{portfolioLabels}</p>
          )}

          {/* Progress bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-[var(--dpf-surface-2)]">
              <div
                className="h-1 rounded-full bg-[var(--dpf-accent)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[9px] text-[var(--dpf-muted)] shrink-0 tabular-nums">
              {doneCount} / {totalCount}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1 mt-0.5">
          {confirmDelete ? (
            <>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="text-[10px] text-red-400 hover:text-red-300 px-1"
              >
                {isPending ? "…" : "confirm"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-white px-1"
              >
                cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onEdit(epic)}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-white px-1"
              >
                edit
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-red-400 px-1"
              >
                del
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded: item list */}
      {expanded && (
        <div className="border-t border-[var(--dpf-border)] px-4 py-3">
          {epic.items.length === 0 ? (
            <p className="text-xs text-[var(--dpf-muted)]">No items in this epic yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {epic.items.map((item) => (
                <BacklogItemRow
                  key={item.id}
                  item={item}
                  onEdit={onItemEdit}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBacklogItem } from "@/lib/actions/backlog";
import { BACKLOG_STATUS_COLOURS, type BacklogItemWithRelations } from "@/lib/backlog";

type Props = {
  item: BacklogItemWithRelations;
  onEdit: (item: BacklogItemWithRelations) => void;
};

export function BacklogItemRow({ item, onEdit }: Props) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteBacklogItem(item.id);
      router.refresh();
    });
  }

  const statusColour = BACKLOG_STATUS_COLOURS[item.status] ?? "#8888a0";

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
      {/* Priority badge */}
      <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-[10px] font-mono bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
        {item.priority ?? "—"}
      </span>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-tight truncate">{item.title}</p>
        <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5 truncate">
          {item.taxonomyNode?.nodeId ?? "—"}
          {item.digitalProduct ? ` · ${item.digitalProduct.name}` : ""}
        </p>
      </div>

      {/* Status badge */}
      <span
        className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded"
        style={{ backgroundColor: `${statusColour}22`, color: statusColour }}
      >
        {item.status}
      </span>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1">
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
              onClick={() => onEdit(item)}
              className="text-[10px] text-[var(--dpf-muted)] hover:text-white px-1"
              aria-label="Edit"
            >
              edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[10px] text-[var(--dpf-muted)] hover:text-red-400 px-1"
              aria-label="Delete"
            >
              del
            </button>
          </>
        )}
      </div>
    </div>
  );
}

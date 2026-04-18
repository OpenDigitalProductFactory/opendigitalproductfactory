"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteBacklogItem, escalateBacklogItemUpstream } from "@/lib/actions/backlog";
import { BACKLOG_STATUS_COLOURS, type BacklogItemWithRelations } from "@/lib/backlog";
import { AGENT_NAME_MAP } from "@/lib/agent-routing";

type Props = {
  item: BacklogItemWithRelations;
  onEdit: (item: BacklogItemWithRelations) => void;
};

export function BacklogItemRow({ item, onEdit }: Props) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [escalateMessage, setEscalateMessage] = useState<string | null>(null);

  function handleDelete() {
    startTransition(async () => {
      await deleteBacklogItem(item.id);
      router.refresh();
    });
  }

  function handleEscalate() {
    setEscalateMessage(null);
    startTransition(async () => {
      const result = await escalateBacklogItemUpstream(item.id);
      if (result.status === "created") {
        setEscalateMessage(`reported as #${result.issueNumber}`);
        router.refresh();
      } else if (result.status === "skipped") {
        setEscalateMessage(`skipped: ${result.reason}`);
      } else {
        setEscalateMessage(`failed: ${result.error}`);
      }
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
        <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight truncate">{item.title}</p>
        <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5 truncate">
          {item.taxonomyNode?.nodeId ?? "—"}
          {item.digitalProduct ? ` · ${item.digitalProduct.name}` : ""}
          {item.agentId ? ` · ${AGENT_NAME_MAP[item.agentId] ?? item.agentId}` : ""}
          {item.submittedBy ? ` · by ${item.submittedBy.email}` : ""}
          {" · "}{new Date(item.createdAt).toLocaleDateString()}
          {item.completedAt ? ` · done ${new Date(item.completedAt).toLocaleDateString()}` : ""}
        </p>
      </div>

      {/* Product link */}
      {item.digitalProduct && (
        <Link
          href={`/portfolio/product/${item.digitalProduct.id}/backlog`}
          className="shrink-0 text-[9px] text-[var(--dpf-accent)] hover:underline px-1"
          title={`View in ${item.digitalProduct.name}`}
        >
          product
        </Link>
      )}

      {/* Upstream-issue link — only when this item has been escalated */}
      {item.upstreamIssueNumber != null && item.upstreamIssueUrl && (
        <a
          href={item.upstreamIssueUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[9px] text-[var(--dpf-accent)] hover:underline px-1"
          title="Filed with the project team"
        >
          GH #{item.upstreamIssueNumber}
        </a>
      )}

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
              className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] px-1"
            >
              cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onEdit(item)}
              className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] px-1"
              aria-label="Edit"
            >
              edit
            </button>
            {item.upstreamIssueNumber == null && (
              <button
                onClick={handleEscalate}
                disabled={isPending}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-accent)] px-1"
                aria-label="Report to project team"
                title="Open a GitHub issue with the project team"
              >
                {isPending ? "…" : "report"}
              </button>
            )}
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
      {escalateMessage && (
        <p className="w-full text-[10px] text-[var(--dpf-muted)] mt-1">{escalateMessage}</p>
      )}
    </div>
  );
}

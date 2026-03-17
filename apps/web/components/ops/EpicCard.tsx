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
import { AGENT_NAME_MAP } from "@/lib/agent-routing";
import { BacklogItemRow } from "./BacklogItemRow";

// Must stay in sync with OpsClient SortField / SortState
export type EpicSortField = "title" | "status" | "progress" | "stories";
export type EpicSort = { field: EpicSortField; dir: "asc" | "desc" } | null;

const ITEM_STATUS_ORDER: Record<string, number> = { open: 0, "in-progress": 1, done: 2 };

function sortedItems(
  items: BacklogItemWithRelations[],
  sort: EpicSort,
): BacklogItemWithRelations[] {
  if (!sort) return items;
  return [...items].sort((a, b) => {
    let cmp = 0;
    if (sort.field === "title") {
      cmp = a.title.localeCompare(b.title);
    } else if (sort.field === "status") {
      cmp = (ITEM_STATUS_ORDER[a.status] ?? 0) - (ITEM_STATUS_ORDER[b.status] ?? 0);
    } else {
      // progress / stories don't apply to items — fall back to priority
      cmp = (a.priority ?? 0) - (b.priority ?? 0);
    }
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

type Props = {
  epic: EpicWithRelations;
  sort: EpicSort;
  onEdit: (epic: EpicWithRelations) => void;
  onItemEdit: (item: BacklogItemWithRelations) => void;
};

export function EpicCard({ epic, sort, onEdit, onItemEdit }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const doneCount = epic.items.filter((i) => i.status === "done").length;
  const totalCount = epic.items.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const statusColour = EPIC_STATUS_COLOURS[epic.status] ?? "#8888a0";
  const portfolioLabels = epic.portfolios.map((p) => p.portfolio.name).join(" · ");

  function handleDelete() {
    startTransition(async () => {
      await deleteEpic(epic.id);
      router.refresh();
    });
  }


  return (
    <div className="border-b border-[var(--dpf-border)] last:border-b-0">
      {/* Row — columns must match EpicListHeader widths */}
      <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--dpf-surface-1)] group">
        {/* col: expand — w-4 */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-4 shrink-0 text-[8px] text-[var(--dpf-muted)] hover:text-white text-center"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "▼" : "▶"}
        </button>

        {/* col: status — w-14 */}
        <div className="w-14 shrink-0 flex items-center">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: statusColour }}
            title={epic.status}
          />
        </div>

        {/* col: title — flex-1 */}
        <p className="flex-1 min-w-0 text-xs text-white truncate">
          {epic.title}
          <span className="ml-1.5 text-[9px] text-[var(--dpf-muted)] tabular-nums">({totalCount})</span>
          <span className="ml-2 text-[9px] text-[var(--dpf-muted)]">
            {new Date(epic.createdAt).toLocaleDateString()}
            {epic.agentId ? ` · ${AGENT_NAME_MAP[epic.agentId] ?? epic.agentId}` : ""}
            {epic.submittedBy ? ` · ${epic.submittedBy.email}` : ""}
            {epic.completedAt ? ` · done ${new Date(epic.completedAt).toLocaleDateString()}` : ""}
          </span>
        </p>

        {/* col: portfolio — w-36 hidden sm */}
        <span className="hidden sm:block w-36 shrink-0 text-[9px] text-[var(--dpf-muted)] truncate">
          {portfolioLabels}
        </span>

        {/* col: progress — w-28 */}
        <div className="w-28 shrink-0 flex items-center gap-1.5">
          <div className="flex-1 h-0.5 rounded-full bg-[var(--dpf-surface-2)]">
            <div
              className="h-0.5 rounded-full bg-[var(--dpf-accent)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[9px] text-[var(--dpf-muted)] tabular-nums w-8 text-right">
            {doneCount}/{totalCount}
          </span>
        </div>

        {/* col: actions — w-14, visible on hover */}
        <div className="w-14 shrink-0 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {confirmDelete ? (
            <>
              <button onClick={handleDelete} disabled={isPending}
                className="text-[10px] text-red-400 hover:text-red-300 px-1">
                {isPending ? "…" : "confirm"}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-white px-1">
                cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onEdit(epic)}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-white px-1">
                edit
              </button>
              <button onClick={() => setConfirmDelete(true)}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-red-400 px-1">
                del
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded: description + item list */}
      {expanded && (
        <div className="border-t border-[var(--dpf-border)] px-8 py-2 bg-[var(--dpf-surface-2)]">
          {epic.description && (
            <p className="text-[11px] text-[var(--dpf-muted)] mb-2 whitespace-pre-line">
              {epic.description.split(/((?:https?|file):\/\/[^\s]+|docs\/[^\s]+\.md)/g).map((part, i) => {
                // Internal docs path → serve through portal
                if (/^docs\/.*\.md$/.test(part)) {
                  return (
                    <a key={i} href={`/api/docs?path=${encodeURIComponent(part)}`} target="_blank" rel="noopener noreferrer" className="text-[var(--dpf-accent)] hover:underline break-all">
                      {part}
                    </a>
                  );
                }
                // file:// URLs with docs/ path → also serve through portal
                const fileMatch = part.match(/^file:\/\/\/.*?\/(docs\/.*\.md)$/);
                if (fileMatch?.[1]) {
                  return (
                    <a key={i} href={`/api/docs?path=${encodeURIComponent(fileMatch[1])}`} target="_blank" rel="noopener noreferrer" className="text-[var(--dpf-accent)] hover:underline break-all">
                      {fileMatch[1]}
                    </a>
                  );
                }
                // External URLs
                if (/^https?:\/\//.test(part)) {
                  return (
                    <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[var(--dpf-accent)] hover:underline break-all">
                      {part}
                    </a>
                  );
                }
                return <span key={i}>{part}</span>;
              })}
            </p>
          )}
          {epic.items.length === 0 ? (
            <p className="text-xs text-[var(--dpf-muted)]">No items in this epic yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {sortedItems(epic.items, sort).map((item) => (
                <BacklogItemRow key={item.id} item={item} onEdit={onItemEdit} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

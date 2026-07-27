// apps/web/components/ops/EpicCard.tsx
"use client";

import { memo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/ui/LocalTime";
import { deleteEpic } from "@/lib/actions/backlog";
import {
  type EpicWithRelations,
  type BacklogItemWithRelations,
} from "@/lib/backlog";
import { AGENT_NAME_MAP } from "@/lib/agent-routing";
import { BacklogItemRow } from "./BacklogItemRow";
import {
  summarizeBacklogStatuses,
  visibleUnderActiveOnly,
  type BacklogStatusSummary,
} from "./backlogVisibility";

// Must stay in sync with OpsClient SortField / SortState
export type EpicSortField = "title" | "status" | "progress" | "stories";
export type EpicSort = { field: EpicSortField; dir: "asc" | "desc" } | null;

const ITEM_STATUS_ORDER: Record<string, number> = { open: 0, "in-progress": 1, done: 2, deferred: 3 };

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
  activeOnly: boolean;
  onEdit: (epic: EpicWithRelations) => void;
  onItemEdit: (item: BacklogItemWithRelations) => void;
  focusedItemId?: string;
};

// How many items to render on first expand. Large epics (Master Data Management,
// etc.) carry dozens of items; mounting them all synchronously froze the renderer
// under the full 470-item DOM (BI-9952EA9E). We render a page at a time and let
// the operator reveal the rest — the freeze was the eager mount, not the data.
const EXPAND_PAGE_SIZE = 25;

// Memoized: OpsClient re-renders on every filter / panel / triage-band toggle.
// With hundreds of items across expanded epics, an unmemoized EpicCard re-renders
// the whole tree each time. Props are stable (epic identity + stable callbacks).
export const EpicCard = memo(EpicCardImpl);

function EpicCardImpl({ epic, sort, activeOnly, onEdit, onItemEdit, focusedItemId }: Props) {
  const router = useRouter();
  const hasFocusedItem = epic.items.some((item) => isFocusedBacklogItem(item, focusedItemId));
  const [expanded, setExpanded] = useState(hasFocusedItem);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  // When deep-linked to a focused item, render the whole (single) epic so the
  // focused row exists to scroll to; otherwise page for render cost.
  const [visibleCount, setVisibleCount] = useState(
    hasFocusedItem ? Number.MAX_SAFE_INTEGER : EXPAND_PAGE_SIZE,
  );

  const statusSummary = summarizeBacklogStatuses(epic.items);
  const visibleItems = visibleUnderActiveOnly(epic.items, activeOnly);
  const hiddenItemCount = epic.items.length - visibleItems.length;
  const progressPct = statusSummary.total > 0
    ? Math.round((statusSummary.done / statusSummary.total) * 100)
    : 0;

  const portfolioLabels = epic.portfolios.filter((p) => p.portfolio).map((p) => p.portfolio.name).join(" · ");

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
          className="w-4 shrink-0 text-[8px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] text-center"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "▼" : "▶"}
        </button>

        {/* col: status — w-14 */}
        <div className="w-14 shrink-0 flex items-center">
          <span
            className={["w-1.5 h-1.5 rounded-full", epicStatusDotClassName(epic.status)].join(" ")}
            title={epic.status}
          />
        </div>

        {/* col: title — flex-1; status mix drops beneath it on narrow screens */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[var(--dpf-text)] truncate">
            {epic.title}
            <span className="ml-1.5 text-[9px] text-[var(--dpf-muted)] tabular-nums">({statusSummary.total})</span>
            <span className="ml-2 text-[9px] text-[var(--dpf-muted)]">
              <LocalTime value={epic.createdAt} mode="date" />
              {epic.agentId ? ` · ${AGENT_NAME_MAP[epic.agentId] ?? epic.agentId}` : ""}
              {epic.submittedBy ? ` · ${epic.submittedBy.email}` : ""}
              {epic.completedAt ? <> · done <LocalTime value={epic.completedAt} mode="date" /></> : ""}
            </span>
          </p>
          <div className="mt-0.5 sm:hidden">
            <EpicStatusMix summary={statusSummary} />
          </div>
        </div>

        {/* col: portfolio — w-36 hidden below lg */}
        <span className="hidden lg:block w-36 shrink-0 text-[9px] text-[var(--dpf-muted)] truncate">
          {portfolioLabels}
        </span>

        {/* col: status mix — explicit counts first, done-only progress second */}
        <div className="hidden sm:flex w-64 shrink-0 flex-col gap-1">
          <EpicStatusMix summary={statusSummary} />
          {statusSummary.total > 0 ? (
            <div
              className="h-0.5 rounded-full bg-[var(--dpf-surface-2)]"
              role="progressbar"
              aria-label={`${statusSummary.done} of ${statusSummary.total} items done`}
              aria-valuemin={0}
              aria-valuemax={statusSummary.total}
              aria-valuenow={statusSummary.done}
            >
              <div
                className="h-0.5 rounded-full bg-[var(--dpf-success)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          ) : null}
        </div>

        {/* col: actions — w-14, visible on hover */}
        <div className="w-14 shrink-0 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {confirmDelete ? (
            <>
              <button onClick={handleDelete} disabled={isPending}
                className="text-[10px] text-[var(--dpf-error)] hover:opacity-80 px-1">
                {isPending ? "…" : "confirm"}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] px-1">
                cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onEdit(epic)}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] px-1">
                edit
              </button>
              <button onClick={() => setConfirmDelete(true)}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-error)] px-1">
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
          ) : visibleItems.length === 0 ? (
            <p className="text-xs text-[var(--dpf-muted)]">
              No active items. <TerminalStatusText summary={statusSummary} /> Turn off &quot;Active only&quot; to review them.
            </p>
          ) : (
            (() => {
              const ordered = sortedItems(visibleItems, sort);
              const shown = ordered.slice(0, visibleCount);
              const remaining = ordered.length - shown.length;
              return (
                <div className="flex flex-col gap-1.5">
                  {shown.map((item) => (
                    <BacklogItemRow
                      key={item.id}
                      item={item}
                      onEdit={onItemEdit}
                      focused={isFocusedBacklogItem(item, focusedItemId)}
                    />
                  ))}
                  {remaining > 0 && (
                    <button
                      onClick={() => setVisibleCount((n) => n + EXPAND_PAGE_SIZE)}
                      className="mt-1 self-start rounded border border-[var(--dpf-border)] px-2 py-1 text-[10px] font-medium text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]"
                    >
                      Show {Math.min(remaining, EXPAND_PAGE_SIZE)} more of {remaining}
                    </button>
                  )}
                </div>
              );
            })()
          )}
          {hiddenItemCount > 0 && (
            <p className="mt-1.5 text-[10px] text-[var(--dpf-muted)]">
              {hiddenItemCount} non-active item{hiddenItemCount !== 1 ? "s" : ""} hidden
              {" — "}<TerminalStatusText summary={statusSummary} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_MIX_PARTS: Array<{
  key: keyof Pick<BacklogStatusSummary, "triaging" | "open" | "inProgress" | "done" | "deferred">;
  label: string;
  className: string;
}> = [
  { key: "triaging", label: "triaging", className: "text-[var(--dpf-muted)]" },
  { key: "open", label: "open", className: "text-[var(--dpf-info)]" },
  { key: "inProgress", label: "in progress", className: "text-[var(--dpf-accent)]" },
  { key: "done", label: "done", className: "text-[var(--dpf-success)]" },
  { key: "deferred", label: "deferred", className: "text-[var(--dpf-muted)]" },
];

function EpicStatusMix({ summary }: { summary: BacklogStatusSummary }) {
  const populated = STATUS_MIX_PARTS.filter(({ key }) => summary[key] > 0);
  if (populated.length === 0) {
    return <span className="text-[9px] text-[var(--dpf-muted)]">No items</span>;
  }
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] leading-3 tabular-nums"
      aria-label={populated.map(({ key, label }) => `${summary[key]} ${label}`).join(", ")}
    >
      {populated.map(({ key, label, className }, index) => (
        <span key={key} className={`shrink-0 ${className}`}>
          {index > 0 ? <span className="mr-1.5 text-[var(--dpf-border)]">·</span> : null}
          {summary[key]} {label}
        </span>
      ))}
    </div>
  );
}

function TerminalStatusText({ summary }: { summary: BacklogStatusSummary }) {
  return (
    <>
      {summary.done > 0 ? `${summary.done} done` : ""}
      {summary.done > 0 && summary.deferred > 0 ? " · " : ""}
      {summary.deferred > 0 ? `${summary.deferred} deferred` : ""}
    </>
  );
}

function isFocusedBacklogItem(item: BacklogItemWithRelations, focusedItemId?: string): boolean {
  return Boolean(focusedItemId && (item.itemId === focusedItemId || item.id === focusedItemId));
}

function epicStatusDotClassName(status: string): string {
  const classes: Record<string, string> = {
    open: "bg-[var(--dpf-accent)]",
    "in-progress": "bg-[var(--dpf-warning)]",
    done: "bg-[var(--dpf-success)]",
  };

  return classes[status] ?? "bg-[var(--dpf-muted)]";
}

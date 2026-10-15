// Universal Grid & Workbooks — table view tabs (BI-FE8DF004).
// The grid plus each saved kanban board of the active table, as links, so a board a
// person or coworker created opens with one click (and has a shareable URL).
// Rendered only when the table has at least one board; a grid-only table keeps
// today's layout unchanged.
import Link from "next/link";
import { KanbanSquare, Table2 } from "lucide-react";
import { getT } from "@/lib/i18n/t.server";

export interface ViewTab {
  viewId: string;
  name: string;
}

export async function WorkbookViewTabs({
  workbookId,
  tableId,
  boards,
  activeViewId,
}: {
  workbookId: string;
  tableId: string;
  boards: ViewTab[];
  /** the open board's viewId, or null when the grid is open */
  activeViewId: string | null;
}) {
  if (boards.length === 0) return null;
  const t = await getT("workbooks");
  const base = `/workbooks/${workbookId}?table=${tableId}`;
  const tabClass = (active: boolean) =>
    active
      ? "inline-flex items-center gap-1.5 rounded-md bg-[var(--dpf-surface-2)] px-2.5 py-1 text-sm font-medium text-[var(--dpf-text)]"
      : "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]";

  return (
    <nav aria-label={t("viewTabs.label")} className="flex flex-wrap items-center gap-1">
      <Link href={`${base}&view=grid`} className={tabClass(activeViewId === null)} aria-current={activeViewId === null ? "page" : undefined}>
        <Table2 className="h-4 w-4" aria-hidden /> {t("viewTabs.grid")}
      </Link>
      {boards.map((b) => {
        const active = b.viewId === activeViewId;
        return (
          <Link
            key={b.viewId}
            href={`${base}&view=${b.viewId}`}
            className={tabClass(active)}
            aria-current={active ? "page" : undefined}
          >
            <KanbanSquare className="h-4 w-4" aria-hidden /> {b.name}
          </Link>
        );
      })}
    </nav>
  );
}

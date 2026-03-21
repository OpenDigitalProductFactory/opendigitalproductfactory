// apps/web/components/ops/OpsClient.tsx
"use client";

import { useState } from "react";
import { BacklogPanel } from "./BacklogPanel";
import { BacklogItemRow } from "./BacklogItemRow";
import { EpicCard, type EpicSort } from "./EpicCard";
import { EpicPanel } from "./EpicPanel";
import type {
  BacklogItemWithRelations,
  DigitalProductSelect,
  TaxonomyNodeSelect,
  EpicWithRelations,
  EpicForSelect,
  PortfolioForSelect,
} from "@/lib/backlog";

type ItemPanelState = {
  open: boolean;
  item?: BacklogItemWithRelations | undefined;
  defaultType?: "portfolio" | "product" | undefined;
  defaultEpicId?: string | undefined;
};

type EpicPanelState =
  | { mode: "create" }
  | { mode: "edit"; epic: EpicWithRelations }
  | null;

type Props = {
  items: BacklogItemWithRelations[];
  digitalProducts: DigitalProductSelect[];
  taxonomyNodes: TaxonomyNodeSelect[];
  epics: EpicWithRelations[];
  portfolios: PortfolioForSelect[];
};

const TYPE_LABELS: Record<string, string> = {
  portfolio: "Portfolio Backlog",
  product:   "Product Backlog",
};

type SortField = "title" | "status" | "progress" | "stories";
type SortState = EpicSort;

const STATUS_ORDER: Record<string, number> = { open: 0, "in-progress": 1, done: 2 };

function sortEpics(epics: EpicWithRelations[], sort: SortState): EpicWithRelations[] {
  if (!sort) return epics;
  return [...epics].sort((a, b) => {
    let cmp = 0;
    if (sort.field === "title") {
      cmp = a.title.localeCompare(b.title);
    } else if (sort.field === "status") {
      cmp = (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0);
    } else if (sort.field === "progress") {
      const pctA = a.items.length > 0 ? a.items.filter((i) => i.status === "done").length / a.items.length : 0;
      const pctB = b.items.length > 0 ? b.items.filter((i) => i.status === "done").length / b.items.length : 0;
      cmp = pctA - pctB;
    } else if (sort.field === "stories") {
      cmp = a.items.length - b.items.length;
    }
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

function nextSort(current: SortState, field: SortField): SortState {
  if (!current || current.field !== field) return { field, dir: "asc" };
  if (current.dir === "asc") return { field, dir: "desc" };
  return null;
}

function SortButton({ label, field, sort, onSort }: {
  label: string;
  field: SortField;
  sort: SortState;
  onSort: (s: SortState) => void;
}) {
  const active = sort?.field === field;
  const icon = !active ? "" : sort.dir === "asc" ? " ▲" : " ▼";
  return (
    <button
      onClick={() => onSort(nextSort(sort, field))}
      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
        active
          ? "border-[var(--dpf-accent)] text-[var(--dpf-accent)]"
          : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] hover:border-[var(--dpf-muted)]"
      }`}
    >
      {label}{icon}
    </button>
  );
}

export function OpsClient({ items, digitalProducts, taxonomyNodes, epics, portfolios }: Props) {
  const [panel, setPanel] = useState<ItemPanelState>({ open: false });
  const [epicPanel, setEpicPanel] = useState<EpicPanelState>(null);
  const [epicSort, setEpicSort] = useState<SortState>(null);
  const [hideDone, setHideDone] = useState(true);

  // Unassigned items only (not belonging to any epic)
  const unassigned = items.filter((i) => i.epicId === null);
  const types = ["portfolio", "product"] as const;
  const byType = new Map(types.map((t) => [t, unassigned.filter((i) => i.type === t)]));

  // EpicForSelect list for BacklogPanel epic dropdown (open + in-progress only)
  const epicsForSelect: EpicForSelect[] = epics
    .filter((e) => e.status !== "done")
    .map((e) => ({ id: e.id, epicId: e.epicId, title: e.title }));

  function openCreate(defaultType: "portfolio" | "product", defaultEpicId?: string) {
    setEpicPanel(null);
    setPanel({ open: true, item: undefined, defaultType, ...(defaultEpicId ? { defaultEpicId } : {}) });
  }
  function openEdit(item: BacklogItemWithRelations) {
    setEpicPanel(null);
    setPanel({ open: true, item });
  }
  function closePanel() { setPanel({ open: false }); }

  function openCreateEpic() {
    setPanel({ open: false });
    setEpicPanel({ mode: "create" });
  }
  function openEditEpic(epic: EpicWithRelations) {
    setPanel({ open: false });
    setEpicPanel({ mode: "edit", epic });
  }
  function closeEpicPanel() { setEpicPanel(null); }

  return (
    <>
      {/* ── Epics section ──────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest">
              Epics
              <span className="ml-2 normal-case font-normal">{epics.length}</span>
            </h2>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideDone}
                onChange={(e) => setHideDone(e.target.checked)}
                className="w-3 h-3 rounded border-[var(--dpf-border)] accent-[var(--dpf-accent)]"
              />
              <span className="text-[10px] text-[var(--dpf-muted)]">Hide done</span>
            </label>
          </div>
          <button
            onClick={openCreateEpic}
            className="text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80"
          >
            + Add epic
          </button>
        </div>

        {(() => {
          const filteredEpics = hideDone ? epics.filter((e) => e.status !== "done") : epics;
          const hiddenCount = epics.length - filteredEpics.length;

          if (epics.length === 0) {
            return <p className="text-xs text-[var(--dpf-muted)]">No epics yet. Add one to start organising your backlog.</p>;
          }

          return (
            <>
              <div className="rounded border border-[var(--dpf-border)] overflow-hidden">
                {/* Column headers — widths must match EpicCard row columns */}
                <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
                  <div className="w-4 shrink-0" />
                  {/* col: status — w-14 */}
                  <div className="w-14 shrink-0">
                    <SortButton label="Status" field="status" sort={epicSort} onSort={setEpicSort} />
                  </div>
                  {/* col: title — flex-1 */}
                  <div className="flex-1 min-w-0">
                    <SortButton label="Title" field="title" sort={epicSort} onSort={setEpicSort} />
                  </div>
                  {/* col: portfolio — w-36 hidden sm */}
                  <div className="hidden sm:block w-36 shrink-0">
                    <span className="text-[9px] text-[var(--dpf-muted)]">Portfolio</span>
                  </div>
                  {/* col: progress — w-28 */}
                  <div className="w-28 shrink-0 flex items-center gap-1">
                    <SortButton label="Progress" field="progress" sort={epicSort} onSort={setEpicSort} />
                    <SortButton label="Stories"  field="stories"  sort={epicSort} onSort={setEpicSort} />
                  </div>
                  <div className="w-14 shrink-0" />
                </div>

                {filteredEpics.length === 0 ? (
                  <div className="px-4 py-3">
                    <p className="text-xs text-[var(--dpf-muted)]">All {epics.length} epics are done. Uncheck &quot;Hide done&quot; to see them.</p>
                  </div>
                ) : (
                  sortEpics(filteredEpics, epicSort).map((epic) => (
                    <EpicCard key={epic.id} epic={epic} sort={epicSort} onEdit={openEditEpic} onItemEdit={openEdit} />
                  ))
                )}
              </div>
              {hiddenCount > 0 && (
                <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
                  {hiddenCount} completed epic{hiddenCount !== 1 ? "s" : ""} hidden
                </p>
              )}
            </>
          );
        })()}
      </div>

      {/* ── Unassigned items ───────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-4">
          Unassigned
          <span className="ml-2 normal-case font-normal">{unassigned.length}</span>
        </h2>

        {types.map((t) => {
          const typeItems = byType.get(t) ?? [];
          const filteredItems = hideDone ? typeItems.filter((i) => i.status !== "done" && i.status !== "deferred") : typeItems;
          const hiddenItemCount = typeItems.length - filteredItems.length;
          const label = TYPE_LABELS[t] ?? t;

          return (
            <section key={t} className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest">
                  {label}
                  <span className="ml-2 normal-case font-normal">{typeItems.length}</span>
                </h3>
                <button
                  onClick={() => openCreate(t)}
                  className="text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80"
                >
                  + Add item
                </button>
              </div>
              {filteredItems.length === 0 ? (
                <p className="text-xs text-[var(--dpf-muted)]">
                  {typeItems.length === 0
                    ? `No unassigned ${label.toLowerCase()} items.`
                    : `All ${typeItems.length} items are done. Uncheck "Hide done" to see them.`}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {filteredItems.map((item) => (
                    <BacklogItemRow key={item.id} item={item} onEdit={openEdit} />
                  ))}
                </div>
              )}
              {hiddenItemCount > 0 && (
                <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
                  {hiddenItemCount} completed item{hiddenItemCount !== 1 ? "s" : ""} hidden
                </p>
              )}
            </section>
          );
        })}
      </div>

      {/* ── Panels ─────────────────────────────────────────── */}
      <BacklogPanel
        isOpen={panel.open}
        onClose={closePanel}
        {...(panel.item !== undefined ? { item: panel.item } : {})}
        {...(panel.defaultType !== undefined ? { defaultType: panel.defaultType } : {})}
        {...(panel.defaultEpicId !== undefined ? { defaultEpicId: panel.defaultEpicId } : {})}
        digitalProducts={digitalProducts}
        taxonomyNodes={taxonomyNodes}
        epics={epicsForSelect}
      />

      <EpicPanel
        isOpen={epicPanel !== null}
        onClose={closeEpicPanel}
        {...(epicPanel?.mode === "edit" ? { epic: epicPanel.epic } : {})}
        portfolios={portfolios}
      />
    </>
  );
}

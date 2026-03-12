// apps/web/components/ops/OpsClient.tsx
"use client";

import { useState } from "react";
import { BacklogPanel } from "./BacklogPanel";
import { BacklogItemRow } from "./BacklogItemRow";
import { EpicCard } from "./EpicCard";
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

export function OpsClient({ items, digitalProducts, taxonomyNodes, epics, portfolios }: Props) {
  const [panel, setPanel] = useState<ItemPanelState>({ open: false });
  const [epicPanel, setEpicPanel] = useState<EpicPanelState>(null);

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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest">
            Epics
            <span className="ml-2 normal-case font-normal">{epics.length}</span>
          </h2>
          <button
            onClick={openCreateEpic}
            className="text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80"
          >
            + Add epic
          </button>
        </div>

        {epics.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">No epics yet. Add one to start organising your backlog.</p>
        ) : (
          epics.map((epic) => (
            <EpicCard key={epic.id} epic={epic} onEdit={openEditEpic} />
          ))
        )}
      </div>

      {/* ── Unassigned items ───────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-4">
          Unassigned
          <span className="ml-2 normal-case font-normal">{unassigned.length}</span>
        </h2>

        {types.map((t) => {
          const typeItems = byType.get(t) ?? [];
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
              {typeItems.length === 0 ? (
                <p className="text-xs text-[var(--dpf-muted)]">No unassigned {label.toLowerCase()} items.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {typeItems.map((item) => (
                    <BacklogItemRow key={item.id} item={item} onEdit={openEdit} />
                  ))}
                </div>
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

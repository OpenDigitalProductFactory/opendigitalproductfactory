"use client";

import { useState } from "react";
import { BacklogPanel } from "./BacklogPanel";
import { BacklogItemRow } from "./BacklogItemRow";
import type { BacklogItemWithRelations, DigitalProductSelect, TaxonomyNodeSelect } from "@/lib/backlog";

type PanelState = {
  open: boolean;
  item?: BacklogItemWithRelations | undefined;
  defaultType?: "portfolio" | "product" | undefined;
};

type Props = {
  items: BacklogItemWithRelations[];
  digitalProducts: DigitalProductSelect[];
  taxonomyNodes: TaxonomyNodeSelect[];
};

const TYPE_LABELS: Record<string, string> = {
  portfolio: "Portfolio Backlog",
  product:   "Product Backlog",
};

export function OpsClient({ items, digitalProducts, taxonomyNodes }: Props) {
  const [panel, setPanel] = useState<PanelState>({ open: false });

  const types = ["portfolio", "product"] as const;
  const byType = new Map(types.map((t) => [t, items.filter((i) => i.type === t)]));

  function openCreate(defaultType: "portfolio" | "product") {
    setPanel({ open: true, item: undefined, defaultType });
  }
  function openEdit(item: BacklogItemWithRelations) { setPanel({ open: true, item }); }
  function closePanel() { setPanel({ open: false }); }

  return (
    <>
      {types.map((t) => {
        const typeItems = byType.get(t) ?? [];
        const label = TYPE_LABELS[t] ?? t;

        return (
          <section key={t} className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest">
                {label}
                <span className="ml-2 text-[var(--dpf-muted)] normal-case font-normal">
                  {typeItems.length}
                </span>
              </h2>
              <button
                onClick={() => openCreate(t)}
                className="text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80"
              >
                + Add item
              </button>
            </div>
            {typeItems.length === 0 ? (
              <p className="text-xs text-[var(--dpf-muted)]">No {label.toLowerCase()} items.</p>
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

      {items.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No backlog items yet.</p>
      )}

      <BacklogPanel
        isOpen={panel.open}
        onClose={closePanel}
        {...(panel.item !== undefined ? { item: panel.item } : {})}
        {...(panel.defaultType !== undefined ? { defaultType: panel.defaultType } : {})}
        digitalProducts={digitalProducts}
        taxonomyNodes={taxonomyNodes}
      />
    </>
  );
}

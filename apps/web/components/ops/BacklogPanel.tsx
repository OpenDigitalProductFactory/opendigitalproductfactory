// apps/web/components/ops/BacklogPanel.tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBacklogItem, updateBacklogItem } from "@/lib/actions/backlog";
import {
  validateBacklogInput,
  type BacklogItemInput,
  type BacklogItemWithRelations,
  type DigitalProductSelect,
  type TaxonomyNodeSelect,
  type EpicForSelect,
} from "@/lib/backlog";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  item?: BacklogItemWithRelations;
  defaultType?: "portfolio" | "product";
  defaultEpicId?: string;
  digitalProducts: DigitalProductSelect[];
  taxonomyNodes: TaxonomyNodeSelect[];
  epics: EpicForSelect[];
};

function emptyForm(type: "portfolio" | "product" = "portfolio", epicId?: string): BacklogItemInput {
  return { title: "", type, status: "open", body: "", ...(epicId ? { epicId } : {}) };
}

export function BacklogPanel({
  isOpen,
  onClose,
  item,
  defaultType,
  defaultEpicId,
  digitalProducts,
  taxonomyNodes,
  epics,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState<BacklogItemInput>(() => emptyForm(defaultType, defaultEpicId));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (item) {
      const next: BacklogItemInput = {
        title:  item.title,
        type:   item.type as "product" | "portfolio",
        status: item.status as BacklogItemInput["status"],
        body:   item.body ?? "",
      };
      if (item.priority !== null && item.priority !== undefined) next.priority = item.priority;
      if (item.taxonomyNode?.id) next.taxonomyNodeId = item.taxonomyNode.id;
      if (item.digitalProduct?.id) next.digitalProductId = item.digitalProduct.id;
      if (item.epicId) next.epicId = item.epicId;
      setForm(next);
    } else {
      setForm(emptyForm(defaultType, defaultEpicId));
    }
    setError(null);
  }, [item, isOpen, defaultType, defaultEpicId]);

  function set<K extends keyof BacklogItemInput>(key: K, value: BacklogItemInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateBacklogInput(form);
    if (validationError) { setError(validationError); return; }
    setError(null);

    startTransition(async () => {
      try {
        if (item) {
          await updateBacklogItem(item.id, form);
        } else {
          await createBacklogItem(form);
        }
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-96 bg-[var(--dpf-surface-1)] border-l border-[var(--dpf-border)] z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--dpf-border)]">
          <h2 className="text-sm font-semibold text-white">
            {item ? "Edit Backlog Item" : "New Backlog Item"}
          </h2>
          <button onClick={onClose} className="text-[var(--dpf-muted)] hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Title */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Title *</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
              placeholder="What needs to be done?"
              required
            />
          </label>

          {/* Type */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Type</span>
            <div className="flex rounded overflow-hidden border border-[var(--dpf-border)]">
              {(["portfolio", "product"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    set("type", t);
                    if (t === "portfolio") set("digitalProductId", undefined);
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                    form.type === t
                      ? "bg-[var(--dpf-accent)] text-white"
                      : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] hover:text-white"
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Status</span>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value as BacklogItemInput["status"])}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
            >
              <option value="open">Open</option>
              <option value="in-progress">In Progress</option>
              <option value="done">Done</option>
              <option value="deferred">Deferred</option>
            </select>
          </label>

          {/* Priority */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Priority (lower = higher)</span>
            <input
              type="number"
              min={1}
              value={form.priority ?? ""}
              onChange={(e) => set("priority", e.target.value ? Number(e.target.value) : undefined)}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
              placeholder="Optional"
            />
          </label>

          {/* Epic */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Epic</span>
            <select
              value={form.epicId ?? ""}
              onChange={(e) => set("epicId", e.target.value || undefined)}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
            >
              <option value="">— no epic —</option>
              {epics.map((ep) => (
                <option key={ep.id} value={ep.id}>{ep.title}</option>
              ))}
            </select>
          </label>

          {/* Taxonomy Node */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Ownership Domain</span>
            <select
              value={form.taxonomyNodeId ?? ""}
              onChange={(e) => set("taxonomyNodeId", e.target.value || undefined)}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
            >
              <option value="">— select node —</option>
              {taxonomyNodes.map((n) => (
                <option key={n.id} value={n.id}>{n.nodeId}</option>
              ))}
            </select>
          </label>

          {/* Digital Product (product-type only) */}
          {form.type === "product" && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Digital Product *</span>
              <select
                value={form.digitalProductId ?? ""}
                onChange={(e) => set("digitalProductId", e.target.value || undefined)}
                className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
                required
              >
                <option value="">— select product —</option>
                {digitalProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.lifecycleStage})</option>
                ))}
              </select>
            </label>
          )}

          {/* Body */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Notes</span>
            <textarea
              value={form.body ?? ""}
              onChange={(e) => set("body", e.target.value)}
              rows={4}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)] resize-none"
              placeholder="Optional notes…"
            />
          </label>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </form>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--dpf-border)] flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-2 rounded bg-[var(--dpf-accent)] text-xs text-white font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Saving…" : item ? "Save Changes" : "Create Item"}
          </button>
        </div>
      </div>
    </>
  );
}

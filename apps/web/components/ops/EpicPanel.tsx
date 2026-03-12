// apps/web/components/ops/EpicPanel.tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEpic, updateEpic } from "@/lib/actions/backlog";
import {
  validateEpicInput,
  EPIC_STATUSES,
  type EpicInput,
  type EpicWithRelations,
  type PortfolioForSelect,
} from "@/lib/backlog";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  epic?: EpicWithRelations;
  portfolios: PortfolioForSelect[];
};

function emptyForm(): EpicInput {
  return { title: "", status: "open", portfolioIds: [] };
}

export function EpicPanel({ isOpen, onClose, epic, portfolios }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<EpicInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (epic) {
      setForm({
        title:        epic.title,
        description:  epic.description ?? "",
        status:       epic.status as EpicInput["status"],
        portfolioIds: epic.portfolios.map((p) => p.portfolioId),
      });
    } else {
      setForm(emptyForm());
    }
    setError(null);
  }, [epic, isOpen]);

  function togglePortfolio(portfolioId: string) {
    setForm((prev) => {
      const already = prev.portfolioIds.includes(portfolioId);
      return {
        ...prev,
        portfolioIds: already
          ? prev.portfolioIds.filter((id) => id !== portfolioId)
          : [...prev.portfolioIds, portfolioId],
      };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateEpicInput(form);
    if (validationError) { setError(validationError); return; }
    setError(null);

    startTransition(async () => {
      try {
        if (epic) {
          await updateEpic(epic.id, form);
        } else {
          await createEpic(form);
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
            {epic ? "Edit Epic" : "New Epic"}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--dpf-muted)] hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Title */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Title *</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
              placeholder="What is this initiative?"
              required
            />
          </label>

          {/* Description */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Description</span>
            <textarea
              value={form.description ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              rows={3}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)] resize-none"
              placeholder="Optional context…"
            />
          </label>

          {/* Status */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as EpicInput["status"] }))}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
            >
              {EPIC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </label>

          {/* Portfolios */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Portfolios</span>
            {portfolios.map((p) => (
              <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.portfolioIds.includes(p.id)}
                  onChange={() => togglePortfolio(p.id)}
                  className="accent-[var(--dpf-accent)]"
                />
                <span className="text-sm text-white">{p.name}</span>
              </label>
            ))}
          </div>

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
            {isPending ? "Saving…" : epic ? "Save Changes" : "Create Epic"}
          </button>
        </div>
      </div>
    </>
  );
}

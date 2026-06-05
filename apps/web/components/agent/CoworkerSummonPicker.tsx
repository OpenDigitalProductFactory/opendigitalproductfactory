"use client";

// apps/web/components/agent/CoworkerSummonPicker.tsx
//
// EP-A2A (2026-06-04 spec, Slice 1) — the missing G2 affordance: lets the user
// bring a NAMED coworker into the current conversation as a second/third-tier
// participant. Backed by the governed summonCoworkerAction server action.
// Theme tokens only (AGENTS.md §12); <option> elements carry explicit surface
// + text tokens per the styling standard.

import { useState } from "react";
import {
  listSummonableCoworkers,
  summonCoworkerAction,
  type SummonableCoworker,
} from "@/lib/actions/coworker-summon";

export function CoworkerSummonPicker({
  parentThreadId,
  routeContext,
  onSummoned,
}: {
  parentThreadId: string;
  routeContext?: string;
  onSummoned?: (info: { childThreadId: string; targetLabel: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [coworkers, setCoworkers] = useState<SummonableCoworker[]>([]);
  const [selected, setSelected] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && coworkers.length === 0) {
      setLoading(true);
      try {
        const list = await listSummonableCoworkers();
        setCoworkers(list);
        if (list.length > 0) setSelected(list[0].agentId);
      } catch {
        setError("Could not load coworkers.");
      } finally {
        setLoading(false);
      }
    }
  }

  async function submit() {
    if (!selected || !objective.trim()) {
      setError("Pick a coworker and describe what they should do.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await summonCoworkerAction({
      parentThreadId,
      targetAgent: selected,
      objective: objective.trim(),
      routeContext,
    });
    setBusy(false);
    if (result.ok) {
      onSummoned?.({ childThreadId: result.childThreadId, targetLabel: result.targetLabel });
      setObjective("");
      setOpen(false);
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="px-3 pb-2">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-3)]"
      >
        <span aria-hidden>＋</span> Bring in a coworker
      </button>

      {open ? (
        <div
          role="group"
          aria-label="Summon a coworker"
          className="mt-2 flex flex-col gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
        >
          {loading ? (
            <p className="text-xs text-[var(--dpf-muted)]">Loading coworkers…</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs text-[var(--dpf-muted)]">
                Coworker
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-sm text-[var(--dpf-text)]"
                >
                  {coworkers.map((c) => (
                    <option
                      key={c.agentId}
                      value={c.agentId}
                      className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                    >
                      {c.name}
                      {c.tier ? ` (T${c.tier})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-[var(--dpf-muted)]">
                What should they do?
                <textarea
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  rows={2}
                  placeholder="e.g. Review the proposed schema for normalization issues"
                  className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-sm text-[var(--dpf-text)]"
                />
              </label>

              {error ? <p className="text-xs text-[var(--dpf-error)]">{error}</p> : null}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="rounded bg-[var(--dpf-accent)] px-3 py-1 text-xs text-white disabled:opacity-60"
                >
                  {busy ? "Summoning…" : "Summon"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded border border-[var(--dpf-border)] px-3 py-1 text-xs text-[var(--dpf-text)]"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

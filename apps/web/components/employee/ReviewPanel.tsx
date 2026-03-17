"use client";

import { useState, useTransition } from "react";
import type { ReviewCycleRow, FeedbackRow } from "@/lib/review-data";
import { createReviewCycle, activateReviewCycle } from "@/lib/actions/reviews";
import { useRouter } from "next/navigation";
import { DatePicker } from "@/components/ui/DatePicker";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  active: "#38bdf8",
  completed: "#4ade80",
};

const FEEDBACK_COLOURS: Record<string, string> = {
  praise: "#4ade80",
  constructive: "#fb923c",
  observation: "#38bdf8",
};

type Props = {
  cycles: ReviewCycleRow[];
  feedback: FeedbackRow[];
};

export function ReviewPanel({ cycles, feedback }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [newCycle, setNewCycle] = useState({
    name: "",
    cadence: "annual" as "quarterly" | "semi_annual" | "annual",
    periodStart: "",
    periodEnd: "",
  });

  function handleCreateCycle() {
    if (!newCycle.name || !newCycle.periodStart || !newCycle.periodEnd) return;
    startTransition(async () => {
      await createReviewCycle(newCycle);
      setShowCreate(false);
      setNewCycle({ name: "", cadence: "annual", periodStart: "", periodEnd: "" });
      router.refresh();
    });
  }

  function handleActivate(cycleId: string) {
    startTransition(async () => {
      await activateReviewCycle(cycleId);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Review Cycles */}
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
            Review Cycles
          </h3>
          <button
            type="button"
            onClick={() => setShowCreate(!showCreate)}
            className="text-[10px] px-2 py-0.5 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10"
          >
            + New Cycle
          </button>
        </div>

        {showCreate && (
          <div className="mb-3 p-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] space-y-2">
            <input
              type="text"
              placeholder="Cycle name (e.g. 2026 Annual Review)"
              value={newCycle.name}
              onChange={(e) => setNewCycle((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white"
            />
            <div className="flex gap-2">
              <select
                value={newCycle.cadence}
                onChange={(e) => setNewCycle((p) => ({ ...p, cadence: e.target.value as typeof p.cadence }))}
                className="px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white"
              >
                <option value="quarterly">Quarterly</option>
                <option value="semi_annual">Semi-Annual</option>
                <option value="annual">Annual</option>
              </select>
              <DatePicker
                value={newCycle.periodStart ? new Date(newCycle.periodStart) : null}
                onChange={(d) => setNewCycle((p) => ({ ...p, periodStart: d ? d.toISOString().slice(0, 10) : "" }))}
                placeholder="Period start"
              />
              <DatePicker
                value={newCycle.periodEnd ? new Date(newCycle.periodEnd) : null}
                onChange={(d) => setNewCycle((p) => ({ ...p, periodEnd: d ? d.toISOString().slice(0, 10) : "" }))}
                placeholder="Period end"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending || !newCycle.name}
                onClick={handleCreateCycle}
                className="text-[10px] px-2 py-1 rounded bg-[var(--dpf-accent)]/20 border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] disabled:opacity-50"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-[10px] px-2 py-1 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {cycles.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">No review cycles yet.</p>
        ) : (
          <div className="space-y-2">
            {cycles.map((c) => {
              const colour = STATUS_COLOURS[c.status] ?? "#8888a0";
              return (
                <div key={c.id} className="flex items-center gap-3 p-2 rounded border border-[var(--dpf-border)]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colour }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-white">{c.name}</span>
                    <span className="text-[10px] text-[var(--dpf-muted)] ml-2">
                      {c.cadence.replace("_", "-")} · {new Date(c.periodStart).toLocaleDateString()} – {new Date(c.periodEnd).toLocaleDateString()}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--dpf-muted)]">
                    {c.completedCount}/{c.instanceCount} done
                  </span>
                  {c.status === "draft" && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleActivate(c.cycleId)}
                      className="text-[10px] px-2 py-0.5 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                    >
                      Activate
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Continuous Feedback */}
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Recent Feedback
        </h3>
        {feedback.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">No feedback recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {feedback.map((f) => (
              <div key={f.id} className="p-2 rounded border border-[var(--dpf-border)]">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: `${FEEDBACK_COLOURS[f.feedbackType] ?? "#888"}15`, color: FEEDBACK_COLOURS[f.feedbackType] ?? "#888" }}
                  >
                    {f.feedbackType}
                  </span>
                  <span className="text-[10px] text-[var(--dpf-muted)]">
                    from {f.fromName} · {new Date(f.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs text-white line-clamp-2">{f.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

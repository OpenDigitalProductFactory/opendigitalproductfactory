"use client";

import { useState, useTransition } from "react";
import { updateStallThreshold, type StallThresholdRow } from "@/lib/actions/stall-threshold-admin";

const SCOPE_LABELS: Record<string, string> = {
  "phase.ideate": "Ideate",
  "phase.plan": "Plan",
  "phase.build": "Build",
  "phase.review": "Review",
  "phase.ship": "Ship",
  default: "Default (non-build TaskRuns)",
};

interface EditState {
  heartbeatTimeoutSeconds: number;
  totalPhaseTimeoutSeconds: number;
  error: string | null;
  saved: boolean;
}

export function StallThresholdsClient({ initialRows }: { initialRows: StallThresholdRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [edits, setEdits] = useState<Record<string, EditState>>(() => {
    const map: Record<string, EditState> = {};
    for (const r of initialRows) {
      map[r.scope] = {
        heartbeatTimeoutSeconds: r.heartbeatTimeoutSeconds,
        totalPhaseTimeoutSeconds: r.totalPhaseTimeoutSeconds,
        error: null,
        saved: false,
      };
    }
    return map;
  });
  const [pending, startTransition] = useTransition();

  const setField = (scope: string, field: "heartbeatTimeoutSeconds" | "totalPhaseTimeoutSeconds", value: number) => {
    setEdits((prev) => ({
      ...prev,
      [scope]: { ...prev[scope]!, [field]: value, error: null, saved: false },
    }));
  };

  const onSave = (scope: string) => {
    const edit = edits[scope];
    if (!edit) return;
    startTransition(async () => {
      const result = await updateStallThreshold(
        scope,
        edit.heartbeatTimeoutSeconds,
        edit.totalPhaseTimeoutSeconds,
      );
      if (result.ok) {
        setRows((current) => current.map((r) => (r.scope === scope ? result.row : r)));
        setEdits((prev) => ({ ...prev, [scope]: { ...prev[scope]!, error: null, saved: true } }));
      } else {
        setEdits((prev) => ({ ...prev, [scope]: { ...prev[scope]!, error: result.error, saved: false } }));
      }
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--dpf-text)]">
          Build Studio — Stall Thresholds
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">
          Per-phase timeout values consumed by the <code className="rounded bg-[var(--dpf-surface-2)] px-1">ops/taskrun-watchdog</code>{" "}
          cron. The watchdog re-reads these on every minute tick, so edits take
          effect immediately. <strong>heartbeat</strong> = silence cap;{" "}
          <strong>total</strong> = wall-clock cap. Heartbeat must be less than
          total (otherwise the heartbeat cap is dead code).
        </p>
      </header>

      <div className="space-y-3">
        {rows.map((row) => {
          const edit = edits[row.scope]!;
          const dirty =
            edit.heartbeatTimeoutSeconds !== row.heartbeatTimeoutSeconds ||
            edit.totalPhaseTimeoutSeconds !== row.totalPhaseTimeoutSeconds;
          return (
            <section
              key={row.scope}
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                    {SCOPE_LABELS[row.scope] ?? row.scope}
                  </h2>
                  <p className="text-xs text-[var(--dpf-muted)]">
                    scope: <code>{row.scope}</code> · updated{" "}
                    {new Date(row.updatedAt).toLocaleString()}
                    {row.updatedBy ? ` by ${row.updatedBy}` : " (seeded)"}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="flex flex-col text-xs text-[var(--dpf-muted)]">
                  Heartbeat timeout (seconds)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={edit.heartbeatTimeoutSeconds}
                    onChange={(e) =>
                      setField(row.scope, "heartbeatTimeoutSeconds", Number(e.target.value))
                    }
                    className="mt-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-sm text-[var(--dpf-text)]"
                    disabled={pending}
                  />
                </label>
                <label className="flex flex-col text-xs text-[var(--dpf-muted)]">
                  Total phase timeout (seconds)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={edit.totalPhaseTimeoutSeconds}
                    onChange={(e) =>
                      setField(row.scope, "totalPhaseTimeoutSeconds", Number(e.target.value))
                    }
                    className="mt-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-sm text-[var(--dpf-text)]"
                    disabled={pending}
                  />
                </label>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onSave(row.scope)}
                  disabled={!dirty || pending}
                  className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
                {edit.saved && <span className="text-xs text-[var(--dpf-accent)]">Saved.</span>}
                {edit.error && <span className="text-xs text-[var(--dpf-error)]">{edit.error}</span>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

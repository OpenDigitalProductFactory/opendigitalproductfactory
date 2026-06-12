"use client";

import { useEffect, useState, useTransition } from "react";
import type { WeeklySchedule, DaySchedule } from "@/lib/operating-hours-types";

const DAY_ORDER = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

const DAY_LABELS: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

type Props = {
  defaultSchedule: WeeklySchedule;
  timezone: string;
  onSave: (schedule: WeeklySchedule) => Promise<void>;
  saving?: boolean;
};

export function OperatingHoursEditor({ defaultSchedule, timezone, onSave, saving: externalSaving }: Props) {
  const [schedule, setSchedule] = useState<WeeklySchedule>(defaultSchedule);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const busy = externalSaving || isPending;

  // Auto-dismiss the success toast a few seconds after a save.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(t);
  }, [saved]);

  function updateDay(day: string, patch: Partial<DaySchedule>) {
    setSchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day as keyof WeeklySchedule], ...patch },
    }));
    setError(null);
    setSaved(false);
  }

  function handleSave() {
    // Client-side validation
    const anyEnabled = DAY_ORDER.some((d) => schedule[d].enabled);
    if (!anyEnabled) {
      setError("At least one day must be enabled");
      return;
    }
    for (const day of DAY_ORDER) {
      const d = schedule[day];
      if (d.enabled && d.close <= d.open) {
        setError(`${DAY_LABELS[day]}: closing time must be after opening time`);
        return;
      }
    }

    setSaved(false);
    startTransition(async () => {
      try {
        await onSave(schedule);
        setError(null);
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-[var(--dpf-muted)]">
        Timezone: {timezone}
      </div>

      <div className="space-y-2">
        {DAY_ORDER.map((day) => {
          const d = schedule[day];
          return (
            <div
              key={day}
              className="flex items-center gap-3 p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
            >
              {/* Toggle */}
              <button
                type="button"
                onClick={() => updateDay(day, { enabled: !d.enabled })}
                className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                  d.enabled
                    ? "bg-[var(--dpf-accent)]"
                    : "bg-[var(--dpf-muted-foreground)]/30"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    d.enabled ? "left-5" : "left-0.5"
                  }`}
                />
              </button>

              {/* Day label */}
              <span
                className={`w-24 text-sm font-medium ${
                  d.enabled ? "text-[var(--dpf-text)]" : "text-[var(--dpf-muted)]"
                }`}
              >
                {DAY_LABELS[day]}
              </span>

              {/* Time pickers */}
              {d.enabled ? (
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="time"
                    value={d.open}
                    onChange={(e) => updateDay(day, { open: e.target.value })}
                    className="px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm"
                  />
                  <span className="text-[var(--dpf-muted)]">to</span>
                  <input
                    type="time"
                    value={d.close}
                    onChange={(e) => updateDay(day, { close: e.target.value })}
                    className="px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm"
                  />
                </div>
              ) : (
                <span className="text-sm text-[var(--dpf-muted)]">Closed</span>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="text-xs text-[var(--dpf-destructive)]">{error}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={busy}
          className="px-4 py-2 text-sm rounded-lg border transition-colors disabled:opacity-50"
          style={{
            color: "var(--dpf-accent)",
            borderColor: "var(--dpf-accent)",
            backgroundColor: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)",
          }}
        >
          {busy ? "Saving..." : "Save Operating Hours"}
        </button>
      </div>

      {/* Success toast — auto-dismissing confirmation that the save persisted. */}
      {saved && !busy && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-2)",
            color: "var(--dpf-text)",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          }}
        >
          <span style={{ color: "var(--dpf-success, #22c55e)" }}>✓</span>
          Operating hours saved
        </div>
      )}
    </div>
  );
}

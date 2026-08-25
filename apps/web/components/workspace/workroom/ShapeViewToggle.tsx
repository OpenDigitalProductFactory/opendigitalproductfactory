"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "dpf.workroom.view";

export type WorkroomViewMode = "shape" | "detail";

/**
 * BI-23DB08BB. Shape or detail — the operator's choice, remembered.
 *
 * Neither view is forced: the picture answers "where is this and what is
 * holding it" at a glance, and the detail view stays the authority for reading.
 * The choice persists per browser so a preference survives a reload.
 */
export function useWorkroomViewMode(): [WorkroomViewMode, (next: WorkroomViewMode) => void] {
  const [mode, setMode] = useState<WorkroomViewMode>("shape");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "shape" || stored === "detail") setMode(stored);
    } catch {
      // A blocked storage API is not a reason to fail the view.
    }
  }, []);

  const choose = (next: WorkroomViewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply does not persist; the view still switches.
    }
  };

  return [mode, choose];
}

export function ShapeViewToggle({
  mode,
  onChange,
}: {
  mode: WorkroomViewMode;
  onChange: (next: WorkroomViewMode) => void;
}) {
  const labels: Record<WorkroomViewMode, string> = {
    shape: "Overview",
    detail: "Details",
  };

  return (
    <div
      role="group"
      aria-label="Workroom view"
      className="inline-flex rounded-lg border border-[var(--dpf-border)] p-0.5"
    >
      {(["shape", "detail"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={mode === value}
          className={`min-h-9 rounded-md px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)] ${
            mode === value
              ? "bg-[var(--dpf-surface-2)] font-medium text-[var(--dpf-text)]"
              : "text-[var(--dpf-muted)]"
          }`}
        >
          {labels[value]}
        </button>
      ))}
    </div>
  );
}

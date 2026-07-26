"use client";

import { useEffect } from "react";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export default function OpsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Ops route error:", error);
  }, [error]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Temporary error loading operations data.
        </p>
      </div>

      <OpsTabNav />

      <div className="mt-6 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-8 text-center">
        <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-2">
          Operations Workspace Unavailable
        </h2>
        <p className="text-sm text-[var(--dpf-muted)] mb-4">
          An error occurred while loading this view. You can try refreshing or reloading the data.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-[var(--dpf-accent)] px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

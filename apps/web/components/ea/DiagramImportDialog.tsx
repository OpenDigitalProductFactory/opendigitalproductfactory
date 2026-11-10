"use client";

// The diagram import review, opened from an EA view's Export / Import menu
// (BI-4C17BF51). It loads the imports when it opens and reloads them after an
// upload or a review, so nothing is added to any page's first view.

import { useCallback, useEffect, useState } from "react";
import { listEaDiagramImports, type SerializedDiagramImport } from "@/lib/actions/ea-diagram-import";
import { Button } from "@/components/ui/Button";
import { DiagramImportPanel } from "./DiagramImportPanel";

type Loaded = { canManage: boolean; imports: SerializedDiagramImport[] };

export function DiagramImportDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await listEaDiagramImports();
      if (result.ok) {
        setData(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch {
      setError("The imports could not be loaded. Try again in a moment.");
    }
  }, []);

  useEffect(() => {
    void load();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import a diagram"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: "color-mix(in srgb, var(--dpf-bg) 85%, transparent)" }}
    >
      <div className="w-full max-w-3xl">
        <div className="mb-2 flex justify-end">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        {error && (
          <p role="alert" className="mb-2 text-xs text-[var(--dpf-error)]">
            {error}
          </p>
        )}
        {data ? (
          <DiagramImportPanel imports={data.imports} canManage={data.canManage} onChanged={() => void load()} />
        ) : (
          !error && <p className="text-xs text-[var(--dpf-muted)]">Loading imports…</p>
        )}
      </div>
    </div>
  );
}

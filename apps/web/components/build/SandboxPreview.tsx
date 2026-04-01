// apps/web/components/build/SandboxPreview.tsx
"use client";

import { useState, useCallback } from "react";
import { type BuildPhase } from "@/lib/feature-build-types";

type Props = {
  buildId: string;
  phase: BuildPhase;
  sandboxPort: number | null;
};

export function SandboxPreview({ buildId, phase, sandboxPort }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const isRunning = sandboxPort !== null && (phase === "build" || phase === "review" || phase === "ship");

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  if (!isRunning) {
    return (
      <div className="flex-1 grid place-items-center bg-[var(--dpf-surface-2)] rounded-lg border border-[var(--dpf-border)]">
        <div className="text-center p-8">
          <div className="text-[32px] mb-3 opacity-30">&#9881;</div>
          <p className="text-sm text-[var(--dpf-muted)] leading-relaxed">
            {phase === "ideate" || phase === "plan"
              ? "Live preview will appear here once the Build phase starts."
              : phase === "complete"
              ? "Feature has been shipped."
              : "Sandbox is not running."}
          </p>
        </div>
      </div>
    );
  }

  const previewUrl = `/api/sandbox/preview?buildId=${encodeURIComponent(buildId)}&path=/&_t=${refreshKey}`;

  return (
    <div className="flex-1 flex flex-col rounded-lg border border-[var(--dpf-border)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--dpf-surface-2)] border-b border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)]">
        <span className="w-2 h-2 rounded-full bg-[#4ade80]" />
        Live Preview
        <button
          onClick={handleRefresh}
          className="ml-auto px-2 py-0.5 rounded text-[10px] border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
          title="Refresh preview"
        >
          ↻ Refresh
        </button>
      </div>
      <iframe
        key={refreshKey}
        src={previewUrl}
        title="Sandbox Preview"
        className="flex-1 border-none min-h-[400px]"
        style={{ background: "#1a1a2e" }}
      />
    </div>
  );
}

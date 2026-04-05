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
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const isRunning = sandboxPort !== null && (phase === "build" || phase === "review" || phase === "ship");

  const handleRefresh = useCallback(() => {
    setIframeLoaded(false);
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
    <div className="flex-1 flex flex-col rounded-lg border border-[var(--dpf-border)] overflow-hidden shadow-dpf-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--dpf-surface-2)] border-b border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)]">
        <span className="w-2 h-2 rounded-full bg-[var(--dpf-success)]" />
        Live Preview
        <button
          onClick={handleRefresh}
          className="ml-auto px-2 py-0.5 rounded text-[10px] border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
          title="Refresh preview"
          aria-label="Refresh live preview"
        >
          ↻ Refresh
        </button>
      </div>
      <div className="flex-1 relative min-h-[400px]">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--dpf-surface-2)] animate-fade-in">
            <div className="w-6 h-6 border-2 border-[var(--dpf-accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[var(--dpf-muted)]">Loading preview...</span>
          </div>
        )}
        <iframe
          key={refreshKey}
          src={previewUrl}
          title="Sandbox Preview"
          className="w-full h-full border-none"
          style={{ background: "var(--dpf-surface-1)" }}
          onLoad={() => setIframeLoaded(true)}
        />
      </div>
    </div>
  );
}

// apps/web/components/build/SandboxPreview.tsx
"use client";

import { type BuildPhase } from "@/lib/feature-build-types";

type Props = {
  buildId: string;
  phase: BuildPhase;
  sandboxPort: number | null;
};

export function SandboxPreview({ buildId, phase, sandboxPort }: Props) {
  const isRunning = sandboxPort !== null && (phase === "build" || phase === "review");

  if (!isRunning) {
    return (
      <div className="flex-1 grid place-items-center bg-[var(--dpf-surface-2)] rounded-lg border border-[var(--dpf-border)]">
        <div className="text-center p-8">
          <div className="text-[32px] mb-3 opacity-30">&#9881;</div>
          <p className="text-sm text-[var(--dpf-muted)] leading-relaxed">
            {phase === "ideate" || phase === "plan"
              ? "Live preview will appear here once the Build phase starts."
              : phase === "ship" || phase === "complete"
              ? "Feature has been shipped. Sandbox was destroyed."
              : "Sandbox is not running."}
          </p>
        </div>
      </div>
    );
  }

  const previewUrl = `/api/sandbox/preview?buildId=${encodeURIComponent(buildId)}&path=/`;

  return (
    <div className="flex-1 flex flex-col rounded-lg border border-[var(--dpf-border)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--dpf-surface-2)] border-b border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)]">
        <span className="w-2 h-2 rounded-full bg-[#4ade80]" />
        Live Preview
      </div>
      <iframe
        src={previewUrl}
        title="Sandbox Preview"
        className="flex-1 border-none bg-white min-h-[400px]"
      />
    </div>
  );
}

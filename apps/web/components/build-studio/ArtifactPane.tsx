"use client";
import { MoreHorizontal } from "lucide-react";
import { ArtifactTabs } from "./ArtifactTabs";
import { PreviewFrame } from "./PreviewFrame";
import type { ArtifactView } from "./types";

interface Props {
  view: ArtifactView;
  onViewChange: (v: ArtifactView) => void;
  sandboxUrl: string | null;
}

function StubView({ slice, name }: { slice: number; name: string }) {
  return (
    <div className="h-full grid place-items-center p-6 text-center text-[var(--dpf-text-secondary)] text-sm">
      <div>
        <div className="font-semibold text-[var(--dpf-text)] mb-1">{name}</div>
        Coming in Slice {slice}.
      </div>
    </div>
  );
}

export function ArtifactPane({ view, onViewChange, sandboxUrl }: Props) {
  return (
    <div className="flex flex-col h-full bg-[var(--dpf-surface-2)] border-l border-[var(--dpf-border)]">
      <div className="px-[22px] py-3 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] flex items-center gap-2.5">
        <ArtifactTabs value={view} onChange={onViewChange} />
        <span className="flex-1" />
        <button
          type="button"
          aria-label="More"
          className="p-1.5 rounded-lg text-[var(--dpf-text-secondary)] hover:bg-[var(--dpf-surface-2)]"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === "preview" && <PreviewFrame sandboxUrl={sandboxUrl} />}
        {view === "verification" && <StubView slice={3} name="Walkthrough" />}
        {view === "schema" && <StubView slice={3} name="What changed" />}
        {view === "diff" && <StubView slice={3} name="The change" />}
      </div>
    </div>
  );
}

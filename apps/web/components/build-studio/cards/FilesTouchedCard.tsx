"use client";
import { ChevronRight } from "lucide-react";
import type { FileTouched, FileTouchedKind } from "../types";

interface Props {
  files: FileTouched[];
  onDrill: () => void;
}

function chipColor(kind: FileTouchedKind): { color: string; bg: string; border: string } {
  switch (kind) {
    case "new":
      return {
        color: "var(--dpf-success)",
        bg: "color-mix(in srgb, var(--dpf-success) 14%, var(--dpf-surface-1))",
        border: "color-mix(in srgb, var(--dpf-success) 35%, var(--dpf-border))",
      };
    case "modified":
      return {
        color: "var(--dpf-warning)",
        bg: "color-mix(in srgb, var(--dpf-warning) 12%, var(--dpf-surface-1))",
        border: "color-mix(in srgb, var(--dpf-warning) 35%, var(--dpf-border))",
      };
    case "deleted":
      return {
        color: "var(--dpf-error)",
        bg: "color-mix(in srgb, var(--dpf-error) 14%, var(--dpf-surface-1))",
        border: "color-mix(in srgb, var(--dpf-error) 35%, var(--dpf-border))",
      };
  }
}

export function FilesTouchedCard({ files, onDrill }: Props) {
  return (
    <div className="mt-2 p-3.5 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-xl">
      <div className="text-[10.5px] font-bold text-[var(--dpf-muted)] uppercase tracking-[0.6px] mb-2.5">
        What I touched · {files.length} files
      </div>
      <div className="flex flex-col gap-2">
        {files.map((f) => {
          const { color, bg, border } = chipColor(f.kind);
          return (
            <div
              key={f.name}
              data-testid="files-touched-row"
              className="flex items-start gap-2.5"
            >
              <span
                className="inline-flex items-center justify-center px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.4px] rounded-full border shrink-0 mt-0.5"
                style={{ color, background: bg, borderColor: border }}
              >
                {f.kind}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[var(--dpf-text)]">{f.name}</div>
                <div className="text-[12px] text-[var(--dpf-text-secondary)]">{f.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--dpf-border)]">
        <button
          type="button"
          onClick={onDrill}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-[12.5px] font-medium rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-3)] transition-colors"
        >
          See the diff
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

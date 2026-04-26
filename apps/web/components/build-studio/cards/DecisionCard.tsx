"use client";
import { AlertTriangle } from "lucide-react";

interface Props {
  body: string;
  onApprove: () => void;
  onRequestChanges: () => void;
  onDrill: () => void;
}

export function DecisionCard({ body, onApprove, onRequestChanges, onDrill }: Props) {
  return (
    <div
      className="mt-2 p-3.5 rounded-xl border"
      style={{
        background: "color-mix(in srgb, var(--dpf-warning) 10%, var(--dpf-surface-1))",
        borderColor: "color-mix(in srgb, var(--dpf-warning) 35%, var(--dpf-border))",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-[18px] h-[18px] rounded-full grid place-items-center text-[var(--dpf-surface-1)]"
          style={{ background: "var(--dpf-warning)" }}
          aria-hidden="true"
        >
          <AlertTriangle size={11} strokeWidth={2.4} />
        </span>
        <div
          className="text-[10.5px] font-bold uppercase tracking-[0.6px]"
          style={{ color: "var(--dpf-warning)" }}
        >
          Needs your eye
        </div>
      </div>
      <p className="m-0 text-[13px] text-[var(--dpf-text)] leading-snug">{body}</p>
      <div className="mt-3 pt-3 border-t border-[var(--dpf-border)] flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApprove}
          className="px-3 py-1.5 text-[12.5px] font-semibold rounded-lg bg-[var(--dpf-accent)] text-[var(--dpf-bg)] hover:opacity-90 transition-opacity"
        >
          Approve & ship
        </button>
        <button
          type="button"
          onClick={onRequestChanges}
          className="px-3 py-1.5 text-[12.5px] font-medium rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-3)] transition-colors"
        >
          Request changes
        </button>
        <button
          type="button"
          onClick={onDrill}
          className="px-3 py-1.5 text-[12.5px] font-medium rounded-lg text-[var(--dpf-text-secondary)] hover:bg-[var(--dpf-surface-2)] transition-colors"
        >
          See the change
        </button>
      </div>
    </div>
  );
}

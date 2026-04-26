"use client";
import { ChevronRight } from "lucide-react";

const PLAN_ITEMS = [
  "Add a way to expire & revoke keys safely",
  "Build the rotate action with a 60-second grace window",
  "Add tests covering the happy path and edge cases",
  "Wire it into the Settings → API Keys screen",
  "Record every rotation in the audit log",
];

interface Props {
  onDrill: () => void;
}

export function PlanSummaryCard({ onDrill }: Props) {
  return (
    <div className="mt-2 p-3.5 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-xl">
      <div className="text-[10.5px] font-bold text-[var(--dpf-muted)] uppercase tracking-[0.6px] mb-2.5">
        The plan
      </div>
      <ol className="flex flex-col gap-2 m-0 p-0 list-none">
        {PLAN_ITEMS.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className="grid place-items-center rounded-full text-[11px] font-bold text-[var(--dpf-text)] shrink-0 mt-0.5"
              style={{
                width: 18,
                height: 18,
                background: "var(--dpf-surface-3)",
                border: "1px solid var(--dpf-border)",
              }}
            >
              {i + 1}
            </span>
            <span className="text-[13px] text-[var(--dpf-text)] leading-snug">{item}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 pt-3 border-t border-[var(--dpf-border)]">
        <button
          type="button"
          onClick={onDrill}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-[12.5px] font-medium rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-3)] transition-colors"
        >
          See the technical plan
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

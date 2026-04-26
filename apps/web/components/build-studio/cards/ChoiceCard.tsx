"use client";
import { useState } from "react";
import type { Choice } from "../types";

export function ChoiceCard({ choice }: { choice: Choice }) {
  const [picked, setPicked] = useState(choice.picked);
  return (
    <div className="mt-2 p-3 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-xl">
      <div className="text-[13px] font-semibold text-[var(--dpf-text)] mb-2">
        {choice.label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {choice.options.map((o) => {
          const sel = picked === o;
          return (
            <button
              key={o}
              type="button"
              aria-pressed={sel}
              onClick={() => setPicked(o)}
              className={[
                "px-3 py-1.5 text-[12.5px] rounded-full transition-colors border",
                sel
                  ? "bg-[var(--dpf-text)] text-[var(--dpf-bg)] border-[var(--dpf-text)] font-semibold"
                  : "bg-[var(--dpf-surface-1)] text-[var(--dpf-text-secondary)] border-[var(--dpf-border)] font-medium",
              ].join(" ")}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

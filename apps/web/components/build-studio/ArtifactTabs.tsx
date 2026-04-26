"use client";
import { Play, Image as ImageIcon, Table, ChevronRight } from "lucide-react";
import type { ComponentType } from "react";
import type { ArtifactView } from "./types";

interface Tab {
  id: ArtifactView;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

const TABS: Tab[] = [
  { id: "preview", label: "Preview", Icon: Play },
  { id: "verification", label: "Walkthrough", Icon: ImageIcon },
  { id: "schema", label: "What changed", Icon: Table },
  { id: "diff", label: "The change", Icon: ChevronRight },
];

interface Props {
  value: ArtifactView;
  onChange: (v: ArtifactView) => void;
}

export function ArtifactTabs({ value, onChange }: Props) {
  return (
    <div
      className="inline-flex gap-0.5 p-[3px] bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-[10px]"
      role="tablist"
    >
      {TABS.map(({ id, label, Icon }) => {
        const sel = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={sel}
            onClick={() => onChange(id)}
            className={[
              "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] rounded-lg transition-colors",
              sel
                ? "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] font-semibold"
                : "border border-transparent text-[var(--dpf-text-secondary)] font-medium",
            ].join(" ")}
          >
            <Icon size={12} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

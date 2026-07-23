"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { EpicRollupView } from "@/lib/build/epic-rollup";
import { PHASE_LABELS, type BuildPhase } from "@/lib/feature-build-types";

type EpicRollupListItemProps = {
  rollup: EpicRollupView;
  activeBuildId: string | null;
  expanded: boolean;
  index: number;
  onToggle: () => void;
  onSelectBuild: (buildId: string) => void;
};

export function EpicRollupListItem({
  rollup,
  activeBuildId,
  expanded,
  index,
  onToggle,
  onSelectBuild,
}: EpicRollupListItemProps) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  const activeChildCount = rollup.children.filter((child) => child.buildId === activeBuildId).length;

  return (
    <div
      data-testid="build-studio-epic-rollup"
      data-active-epic={activeChildCount > 0 ? "true" : "false"}
      className="animate-dpf-slide-up"
      style={{
        animationDelay: `${index * 30}ms`,
        animationFillMode: "backwards",
      }}
    >
      <div
        className={[
          "group",
          "relative",
          "flex",
          "items-center",
          "gap-2",
          "rounded-md",
          "border-l-4",
          activeChildCount > 0 ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)]" : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]",
          "px-2",
          "py-1",
          "min-h-11",
          "hover:bg-[var(--dpf-surface-2)]",
        ].join(" ")}
      >
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} epic ${rollup.title}`}
          aria-expanded={expanded}
          onClick={onToggle}
          className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded text-[var(--dpf-muted)] transition-colors hover:text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--dpf-text)]">
              {rollup.title}
            </span>
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--dpf-muted)]">
            <span className="min-w-0 truncate">{rollup.rollupSummary}</span>
            <span className="shrink-0">{rollup.backlogSummary}</span>
            <span className="shrink-0">Updated {formatUpdatedAt(rollup.updatedAt)}</span>
          </span>
        </button>
      </div>

      {expanded && (
        <ul className="ml-5 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--dpf-border)] pl-2">
          {rollup.children.map((child, childIndex) => {
            const activeChild = activeBuildId === child.buildId;
            return (
              <li key={child.buildId}>
                <button
                  type="button"
                  aria-label={`Open build ${child.title}`}
                  aria-pressed={activeChild}
                  data-active-child={activeChild ? "true" : "false"}
                  onClick={() => onSelectBuild(child.buildId)}
                  className={[
                    "flex",
                    "min-h-8",
                    "w-full",
                    "cursor-pointer",
                    "items-center",
                    "gap-2",
                    "rounded-md",
                    "border-l-4",
                    activeChild ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)]" : "border-transparent bg-transparent",
                    "px-2",
                    "py-1",
                    "text-left",
                    "hover:bg-[var(--dpf-surface-2)]",
                    "focus-visible:outline-2",
                    "focus-visible:outline-[var(--dpf-accent)]",
                    "focus-visible:outline-offset-2",
                  ].join(" ")}
                >
                  <span className="w-4 shrink-0 text-right font-mono text-[10px] text-[var(--dpf-muted)]">
                    {child.childOrder ?? childIndex + 1}
                  </span>
                  <PhaseBadge phase={child.phase} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--dpf-text)]">
                    {child.title}
                  </span>
                  {child.waitingOn.length > 0 && (
                    <span className="hidden max-w-[45%] shrink truncate text-[11px] text-[var(--dpf-muted)] xl:inline">
                      Waiting on: {child.waitingOn.join(", ")}
                    </span>
                  )}
                </button>
                {child.waitingOn.length > 0 && (
                  <p className="ml-[4.75rem] mt-0.5 truncate text-[10px] text-[var(--dpf-muted)] xl:hidden">
                    Waiting on: {child.waitingOn.join(", ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: BuildPhase }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 text-[10px] font-semibold text-[var(--dpf-muted)]">
      {PHASE_LABELS[phase] ?? phase}
    </span>
  );
}

function formatUpdatedAt(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

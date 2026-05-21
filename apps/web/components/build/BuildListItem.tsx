"use client";

import type { FeatureBuildRow } from "@/lib/feature-build-types";
import {
  BUILD_STUDIO_TEST_IDS,
  FLEET_ROW_HEIGHT_CLASS,
} from "./build-studio-layout";
import { PhaseMiniRail, type PhaseRailPhase } from "./PhaseMiniRail";
import { QueueStateBadge, type BuildQueueState } from "./QueueStateBadge";

export type BuildListItemDensity = "comfortable" | "fleet";

type BuildListItemProps = {
  build: FeatureBuildRow;
  active: boolean;
  index: number;
  lifecycleLabel: string | null;
  isDevEnvironment: boolean;
  onSelect: () => void;
  onDelete: () => void;
  /** Optional density variant. Defaults to "comfortable" so existing callers
   *  render the legacy card. The fleet rail uses "fleet" for ≤32px rows. */
  density?: BuildListItemDensity;
  /** Runtime queue state surfaced as a badge between the claim and the
   *  attention dot. Used only by the fleet density variant. */
  queueState?: BuildQueueState;
  /** Render the attention dot when true. Fleet density only. */
  needsAttention?: boolean;
};

function formatUpdatedAt(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

/** Resolve which canonical PhaseMiniRail phase to render for an FB phase.
 *  The mini-rail only knows about the 5 canonical phases — failed/complete
 *  fall back to the closest sensible representation. */
function toPhaseRailPhase(phase: FeatureBuildRow["phase"]): PhaseRailPhase {
  switch (phase) {
    case "ideate":
    case "plan":
    case "build":
    case "review":
    case "ship":
      return phase;
    case "complete":
      return "ship";
    case "failed":
    case "abandoned":
      // Treat terminal-failure states as still-in-review for the mini-rail.
      return "review";
    default:
      return "ideate";
  }
}

export function BuildListItem({
  build,
  active,
  index,
  lifecycleLabel,
  isDevEnvironment,
  onSelect,
  onDelete,
  density = "comfortable",
  queueState,
  needsAttention = false,
}: BuildListItemProps) {
  if (density === "fleet") {
    return (
      <FleetDensityRow
        build={build}
        active={active}
        index={index}
        isDevEnvironment={isDevEnvironment}
        onSelect={onSelect}
        onDelete={onDelete}
        queueState={queueState ?? { kind: "idle" }}
        needsAttention={needsAttention}
      />
    );
  }

  // ── Comfortable density (legacy) — unchanged so existing callers + tests pass ──
  return (
    <div
      data-testid={BUILD_STUDIO_TEST_IDS.buildListItem}
      className="group mb-1 flex max-h-[128px] min-h-[88px] min-w-0 rounded-md border transition-all duration-150 hover:bg-[var(--dpf-surface-2)] hover:shadow-dpf-xs animate-slide-up"
      style={{
        animationDelay: `${index * 30}ms`,
        animationFillMode: "backwards",
        borderColor: active ? "var(--dpf-accent)" : "transparent",
        background: active ? "var(--dpf-surface-2)" : "transparent",
      }}
    >
      <button
        type="button"
        aria-label={`Open build ${build.title}`}
        aria-pressed={active}
        onClick={onSelect}
        className="min-w-0 flex-1 cursor-pointer rounded-l-md px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
      >
        <div
          title={build.title}
          className="line-clamp-2 max-h-[2.5rem] min-w-0 overflow-hidden break-words text-sm font-semibold leading-5 text-[var(--dpf-text)]"
        >
          {build.title}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--dpf-muted)]">
          <span className="font-mono">{build.buildId}</span>
          {build.originator && (
            <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-1.5 py-0.5 font-medium text-[var(--dpf-text)]">
              {build.originator.itemId}
            </span>
          )}
          <span className="capitalize">{build.phase}</span>
          <span>Updated {formatUpdatedAt(build.updatedAt)}</span>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          {lifecycleLabel && (
            <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--dpf-text)]">
              <span className="truncate">{lifecycleLabel}</span>
            </span>
          )}
          {build.product && (
            <span className="truncate text-xs text-[var(--dpf-muted)]">
              v{build.product.version} · {build.product.backlogCount} item{build.product.backlogCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </button>
      <button
        type="button"
        aria-label={`Delete ${build.title}`}
        disabled={isDevEnvironment}
        onClick={onDelete}
        className="grid w-8 shrink-0 cursor-pointer place-items-start rounded-r-md px-2 py-2 text-xs text-[var(--dpf-muted)] transition-colors hover:text-[var(--dpf-error)] focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        &times;
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Fleet density — compact 32px row with phase mini-rail + queue badge.       */
/* ────────────────────────────────────────────────────────────────────────── */

type FleetRowProps = {
  build: FeatureBuildRow;
  active: boolean;
  index: number;
  isDevEnvironment: boolean;
  onSelect: () => void;
  onDelete: () => void;
  queueState: BuildQueueState;
  needsAttention: boolean;
};

function FleetDensityRow({
  build,
  active,
  index,
  isDevEnvironment,
  onSelect,
  onDelete,
  queueState,
  needsAttention,
}: FleetRowProps) {
  const railPhase = toPhaseRailPhase(build.phase);
  const biCostTooltip = build.originator?.itemId ?? "";
  return (
    <div
      data-testid={BUILD_STUDIO_TEST_IDS.buildListItem}
      data-density="fleet"
      data-active={active ? "true" : "false"}
      aria-current={active ? "true" : undefined}
      className={[
        "fleet-row",
        "group",
        "relative",
        "flex",
        "items-center",
        "gap-2",
        "rounded-md",
        "border-l-4",
        active ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)]" : "border-transparent bg-transparent",
        "px-2",
        "py-0.5",
        "hover:bg-[var(--dpf-surface-2)]",
        FLEET_ROW_HEIGHT_CLASS,
        "animate-slide-up",
      ].join(" ")}
      style={{
        animationDelay: `${index * 30}ms`,
        animationFillMode: "backwards",
      }}
    >
      <button
        type="button"
        aria-label={`Open build ${build.title}`}
        aria-pressed={active}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
      >
        <span
          className="shrink-0 font-mono text-[11px] text-[var(--dpf-text)]"
          title={biCostTooltip || undefined}
        >
          {build.buildId}
        </span>
        <PhaseMiniRail currentPhase={railPhase} />
        {build.claimStatus === "claimed" && build.claimedByAgentId && (
          <span
            className="inline-flex h-3.5 items-center justify-center rounded-full bg-[var(--dpf-accent-soft)] px-1.5 text-[9px] font-semibold uppercase text-[var(--dpf-accent)]"
            title={`Claimed by ${build.claimedByAgentId}`}
            data-testid="fleet-row-claim"
          >
            ●
          </span>
        )}
        <QueueStateBadge state={queueState} />
        {needsAttention && (
          <span
            role="img"
            aria-label="Needs attention"
            title="Needs your attention"
            data-testid="fleet-row-attention"
            className="inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full bg-[var(--dpf-error)] ring-1 ring-[var(--dpf-error)] ring-offset-1 ring-offset-[var(--dpf-surface-1)]"
          />
        )}
        <span className="ml-auto min-w-0 truncate text-[11px] text-[var(--dpf-muted)]">
          {build.title}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${build.title}`}
        disabled={isDevEnvironment}
        onClick={onDelete}
        data-testid="fleet-row-delete"
        className="hidden h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-[10px] text-[var(--dpf-muted)] transition-colors hover:text-[var(--dpf-error)] focus-visible:flex focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2 group-hover:flex disabled:cursor-not-allowed disabled:opacity-40"
      >
        &times;
      </button>
    </div>
  );
}

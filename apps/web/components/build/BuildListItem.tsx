"use client";

import type { FeatureBuildRow } from "@/lib/feature-build-types";
import {
  BUILD_STUDIO_TEST_IDS,
  FLEET_ROW_HEIGHT_CLASS,
} from "./build-studio-layout";
import { FleetDensityBar } from "./FleetDensityBar";
import type { BuildQueueState } from "./QueueStateBadge";
import {
  ownerStateBadgeLabel,
  type BuildStudioOwnerState,
} from "@/lib/build/owner-status-reconciliation";
import type { BuildAttention } from "@/lib/build/build-attention";

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
  /** Runtime queue state surfaced as a plain status label. Fleet density only. */
  queueState?: BuildQueueState;
  /**
   * The row's ONE attention answer — canonical owner state plus the reason.
   * Fleet density only. Replaces the old `needsAttention` boolean + separate
   * `ownerState`: those were two answers to one question, and the boolean
   * could contradict the Next card while naming no reason (BI one-attention-truth).
   */
  attention?: BuildAttention | null;
};

function formatUpdatedAt(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
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
  attention = null,
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
        attention={attention}
      />
    );
  }

  // ── Comfortable density (legacy) — unchanged so existing callers + tests pass ──
  return (
    <div
      data-testid={BUILD_STUDIO_TEST_IDS.buildListItem}
      className="group mb-1 flex max-h-[128px] min-h-[88px] min-w-0 rounded-md border transition-all duration-150 hover:bg-[var(--dpf-surface-2)] hover:shadow-dpf-xs animate-dpf-slide-up"
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
          {build.originator && (
            <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-1.5 py-0.5 font-medium text-[var(--dpf-text)]">
              Backlog-linked
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
/* Fleet density — compact 32px row with a plain operator status.             */
/* ────────────────────────────────────────────────────────────────────────── */

type FleetRowProps = {
  build: FeatureBuildRow;
  active: boolean;
  index: number;
  isDevEnvironment: boolean;
  onSelect: () => void;
  onDelete: () => void;
  queueState: BuildQueueState;
  attention: BuildAttention | null;
};

type FleetRowStatus = {
  label: string;
  className: string;
  /** Why this state, in operator language. Rendered as the row's title. */
  reason: string | null;
};

function statusClassName(intent: "info" | "warning" | "danger" | "success" | "neutral"): string {
  const base = "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none";
  if (intent === "danger") {
    return `${base} border-[var(--dpf-error)] bg-[var(--dpf-state-error)] text-[var(--dpf-error)]`;
  }
  if (intent === "warning") {
    return `${base} border-[var(--dpf-warning)] bg-[var(--dpf-state-warning)] text-[var(--dpf-warning)]`;
  }
  if (intent === "success") {
    return `${base} border-[var(--dpf-success)] bg-[var(--dpf-state-success)] text-[var(--dpf-success)]`;
  }
  if (intent === "info") {
    return `${base} border-[var(--dpf-info)] bg-[var(--dpf-state-info)] text-[var(--dpf-info)]`;
  }
  return `${base} border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]`;
}

function ownerStateIntent(
  state: BuildStudioOwnerState,
): "info" | "warning" | "danger" | "success" | "neutral" {
  switch (state) {
    case "working": return "info";
    case "complete": return "success";
    case "failed":
    case "blocked": return "danger";
    case "waiting-capacity":
    case "waiting-owner":
    case "inconclusive": return "warning";
    case "not-started": return "neutral";
  }
}

function deriveFleetRowStatus(
  build: FeatureBuildRow,
  queueState: BuildQueueState,
  attention: BuildAttention | null,
): FleetRowStatus {
  // ownerStateBadgeLabel is the ONLY producer of row status copy. The previous
  // `if (needsAttention) return { label: "Needs you" }` branch hardcoded a
  // second vocabulary that could disagree with the canonical one shown on the
  // same screen — the rail said "Needs you" while the Next card said no action
  // was needed. Every row now renders the same eight-state vocabulary, and
  // carries the reason as its title.
  if (attention) {
    return {
      label: ownerStateBadgeLabel(attention.state),
      className: statusClassName(ownerStateIntent(attention.state)),
      reason: attention.reason,
    };
  }

  // No attention answer (non-fleet callers / tests) — fall back to the runtime
  // queue signal, then the phase. Never invents an attention state.
  if (queueState.kind === "blocked") {
    return { label: "Blocked", className: statusClassName("warning"), reason: queueState.reason ?? null };
  }
  if (queueState.kind === "queued") {
    return { label: "Waiting", className: statusClassName("neutral"), reason: null };
  }
  if (queueState.kind === "running") {
    return { label: "Working", className: statusClassName("info"), reason: null };
  }

  switch (build.phase) {
    case "ideate":
      return { label: "Designing", className: statusClassName("neutral"), reason: null };
    case "plan":
      return { label: "Planning", className: statusClassName("neutral"), reason: null };
    case "build":
      return { label: "Building", className: statusClassName("info"), reason: null };
    case "review":
      return { label: "Reviewing", className: statusClassName("info"), reason: null };
    case "ship":
      return { label: "Ready", className: statusClassName("warning"), reason: null };
    case "complete":
      return { label: "Done", className: statusClassName("success"), reason: null };
    case "failed":
      return { label: "Blocked", className: statusClassName("warning"), reason: null };
    default:
      return { label: "Queued", className: statusClassName("neutral"), reason: null };
  }
}

function FleetDensityRow({
  build,
  active,
  index,
  isDevEnvironment,
  onSelect,
  onDelete,
  queueState,
  attention,
}: FleetRowProps) {
  const status = deriveFleetRowStatus(build, queueState, attention);
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
        "animate-dpf-slide-up",
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
          data-testid="fleet-row-status"
          aria-label={
            status.reason
              ? `Status: ${status.label}. ${status.reason}`
              : `Status: ${status.label}`
          }
          title={status.reason ?? undefined}
          className={status.className}
        >
          {status.label}
        </span>
        {build.phase === "build" && (
          <FleetDensityBar taskResults={build.taskResults} buildPlan={build.buildPlan} />
        )}
        {build.claimStatus === "claimed" && build.claimedByAgentId && (
          <span
            className="inline-flex h-3.5 items-center justify-center rounded-full bg-[var(--dpf-accent-soft)] px-1.5 text-[9px] font-semibold uppercase text-[var(--dpf-accent)]"
            title={`Claimed by ${build.claimedByAgentId}`}
            data-testid="fleet-row-claim"
          >
            ●
          </span>
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

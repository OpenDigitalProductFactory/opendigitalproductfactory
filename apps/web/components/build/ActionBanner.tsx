// apps/web/components/build/ActionBanner.tsx
//
// Compact 40px presentation of the build's current state + primary action.
// Replaces the current ~200px stacked "Build Status / heading / repeated
// sentence / button / repeated detail" card in the new layout. Used by
// BuildStudio (and, via delegation, by BuildStudioWorkflowActionCard) in
// later waves — this PR introduces the component standalone with tests.
//
// Per the design spec §1 + §6:
//   - One sentence describes the state. The sentence IS the heading — no
//     duplicate "Build Status" label or repeated warning.
//   - Detail line is rendered ONLY when the state is "blocked" or "review_failed".
//   - Height is exactly 40px (Tailwind h-10).
//   - role="region" with an aria-label so screen readers can land here.
//   - Uses ACTION_BANNER_HEIGHT_CLASS so the size lives in one place.
//   - Status color comes from --dpf-state-* variables (now subtle tints
//     after PR #905) — fg uses the matching --dpf-{tone} variable so the
//     two are distinct.

"use client";

import { ACTION_BANNER_HEIGHT_CLASS, BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";

export type ActionBannerState = "ready" | "running" | "blocked" | "review_failed" | "complete";

export type ActionBannerPrimaryAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export type ActionBannerProps = {
  state: ActionBannerState;
  /** One sentence describing the current state. This IS the heading — no separate title. */
  sentence: string;
  /** Optional primary action. Right-aligned, min-width 120px. */
  primaryAction?: ActionBannerPrimaryAction;
  /** Extra detail line. Rendered ONLY when state is "blocked" or "review_failed". */
  detail?: string;
};

/** Distinct fg + bg tokens per state. Tints come from --dpf-state-* (PR #905). */
function stateClassName(state: ActionBannerState): string {
  if (state === "blocked" || state === "review_failed") {
    return [
      "bg-[var(--dpf-state-warning)]",
      "text-[var(--dpf-text)]",
      "border-[var(--dpf-warning)]",
    ].join(" ");
  }
  if (state === "running") {
    return [
      "bg-[var(--dpf-state-info)]",
      "text-[var(--dpf-text)]",
      "border-[var(--dpf-info)]",
    ].join(" ");
  }
  if (state === "complete") {
    return [
      "bg-[var(--dpf-state-success)]",
      "text-[var(--dpf-text)]",
      "border-[var(--dpf-success)]",
    ].join(" ");
  }
  // "ready" — default surface, no state color.
  return [
    "bg-[var(--dpf-surface-2)]",
    "text-[var(--dpf-text)]",
    "border-[var(--dpf-border)]",
  ].join(" ");
}

/** Detail is intentionally rendered only for blocked / review_failed. */
function shouldShowDetail(state: ActionBannerState, detail: string | undefined): detail is string {
  if (!detail) return false;
  return state === "blocked" || state === "review_failed";
}

export function ActionBanner({ state, sentence, primaryAction, detail }: ActionBannerProps) {
  const showDetail = shouldShowDetail(state, detail);
  return (
    <div
      role="region"
      aria-label="Current build action"
      data-testid={BUILD_STUDIO_TEST_IDS.actionBanner}
      data-state={state}
      className={[
        ACTION_BANNER_HEIGHT_CLASS,
        "flex",
        "shrink-0",
        "items-center",
        "justify-between",
        "gap-3",
        "border-b",
        "px-4",
        "text-xs",
        "leading-tight",
        stateClassName(state),
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The sentence IS the heading — render as a single line that describes the state. */}
        <span className="min-w-0 truncate font-medium" data-testid="action-banner-sentence">
          {sentence}
        </span>
        {showDetail && (
          <span
            className="min-w-0 truncate text-[10px] text-[var(--dpf-muted)]"
            data-testid="action-banner-detail"
          >
            {detail}
          </span>
        )}
      </div>
      {primaryAction && (
        <button
          type="button"
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          aria-disabled={primaryAction.disabled}
          data-testid="action-banner-primary"
          className="action-banner__primary inline-flex min-w-[120px] shrink-0 items-center justify-center rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          {primaryAction.label}
        </button>
      )}
    </div>
  );
}

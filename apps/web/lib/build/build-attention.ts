// apps/web/lib/build/build-attention.ts
//
// ONE attention truth for a Build Studio row (BI — one-attention-truth).
//
// The defect this closes: `/build` could show "Needs you" on a rail row while
// that same build's Next card read "No action needed unless Build Studio asks
// for a decision", with nothing anywhere saying what was actually wanted.
//
// That happened because two independent derivations answered the same
// question. `components/build/fleet-derivation.ts` computed a BOOLEAN over the
// raw FeatureBuildRow — evaluating seven distinct conditions and collapsing
// every one to `true`, discarding which fired — while
// `owner-status-reconciliation.ts` (which already calls itself "the one seam
// for Build Studio owner state") owned the canonical eight-state vocabulary
// and the Needs-you / Needs-attention distinction. The rail imported none of
// it.
//
// This module is the single producer. It returns the canonical
// BuildStudioOwnerState PLUS the reason, so a row can say what it needs rather
// than only that it needs something.
//
// UNION, NOT REPLACEMENT — deliberately. The capsule projection is the
// authority when it has an opinion, but it cannot see runtime freshness: a
// build whose watchdog died mid-phase, or whose buildExecState carries an
// error, still projects a healthy-looking capsule. Those local signals are
// therefore evaluated FIRST and mapped onto the canonical vocabulary. Deleting
// the local heuristic outright would have lost exactly the failures the
// operator most needs to see.

import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { BuildStudioCustomerStatus } from "@/lib/build/customer-status-projection";
import {
  reconcileBuildStudioCustomerStatus,
  type BuildStudioOwnerState,
} from "@/lib/build/owner-status-reconciliation";
// BI-46204009: fleet status must reflect ACTIVITY FRESHNESS, not just the
// stored phase. A build frozen in an active phase (watchdog stall never
// remediated) otherwise renders forever as an animated "Working" badge,
// implying live work where there is none. Healthy builds checkpoint
// FeatureBuild.updatedAt every few minutes, so a conservative 30-minute floor
// avoids false positives on normal long-running steps.
//
// This primitive lives here, in lib/, rather than in the component layer that
// used to own it: it is a projection input, and lib must not import from
// components.
export const STALL_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * True when a build sits in an active execution phase (build/review) but has
 * had no update for longer than {@link STALL_THRESHOLD_MS} — i.e. it is
 * frozen, not working. Only build/review can stall: ideate/plan are off-rail
 * coworker custody and ship/complete/failed/abandoned are terminal-ish.
 */
export function isBuildStalled(
  build: Pick<FeatureBuildRow, "phase" | "updatedAt">,
  now: number = Date.now(),
): boolean {
  if (build.phase !== "build" && build.phase !== "review") return false;
  // updatedAt is typed Date but arrives as an ISO string after RSC
  // serialization on the client — new Date() handles both.
  const ms = new Date(build.updatedAt).getTime();
  if (Number.isNaN(ms)) return false;
  return now - ms > STALL_THRESHOLD_MS;
}

/** Owner states that genuinely want a human. Derived, never independent. */
const OWNER_ACTIONABLE: ReadonlySet<BuildStudioOwnerState> = new Set([
  "waiting-owner",
  "blocked",
  "failed",
  "inconclusive",
]);

export type BuildAttention = {
  /** Canonical state — the ONLY vocabulary a row may render. */
  state: BuildStudioOwnerState;
  /**
   * Why this state, in operator language. Null only when the state is
   * unremarkable (working / complete / not-started with nothing to say).
   * This is the field the old boolean threw away.
   */
  reason: string | null;
  /** True when the state is one a human must act on. Derived from `state`. */
  needsOwner: boolean;
  /**
   * True when the reason came from a local runtime signal the capsule
   * projection could not see (stall, exec error). Useful for diagnostics and
   * for asserting the union behaviour in tests.
   */
  fromRuntimeSignal: boolean;
};

function attention(
  state: BuildStudioOwnerState,
  reason: string | null,
  fromRuntimeSignal = false,
): BuildAttention {
  return { state, reason, needsOwner: OWNER_ACTIONABLE.has(state), fromRuntimeSignal };
}

function stalledReason(build: Pick<FeatureBuildRow, "updatedAt">, now: number): string {
  const mins = Math.round((now - new Date(build.updatedAt).getTime()) / 60_000);
  const label = mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`;
  return `No activity for ${label} — the step may be stuck. Review it and resume or stop it.`;
}

/**
 * Derive the one attention answer for a build.
 *
 * @param build   the row
 * @param status  that build's canonical customer status, when loaded. This is
 *                already available per-build via loadBuildStudioCustomerStatuses;
 *                callers must pass it rather than letting it default.
 * @param now     injectable clock for tests
 */
export function deriveBuildAttention(
  build: FeatureBuildRow,
  status: BuildStudioCustomerStatus | null | undefined,
  now: number = Date.now(),
): BuildAttention {
  // ---- 1. Runtime-freshness signals the capsule cannot see. ----------------
  // These win because a dead watchdog leaves a healthy-looking capsule behind.
  if (isBuildStalled(build, now)) {
    return attention("blocked", stalledReason(build, now), true);
  }

  if (build.phase === "build") {
    const exec = build.buildExecState as { error?: string | null } | null | undefined;
    if (exec?.error) {
      return attention("blocked", `The build step reported an error: ${exec.error.slice(0, 140)}`, true);
    }
  }

  // ---- 2. The canonical projection, when we have it. ----------------------
  if (status) {
    const reconciled = reconcileBuildStudioCustomerStatus({
      phase: build.phase,
      status,
      progress: null,
    });
    const state = reconciled.ownerState ?? "working";
    // nextAction is the operator-facing "what is wanted"; only surface it as a
    // reason when something is actually wanted, so quiet rows stay quiet.
    const reason = OWNER_ACTIONABLE.has(state)
      ? (reconciled.nextAction?.trim() || reconciled.lifecyclePosition?.trim() || null)
      : null;
    return attention(state, reason);
  }

  // ---- 3. No capsule status — fall back to row-local evidence. ------------
  // Same seven conditions the old boolean used, now each carrying its reason.
  if (build.phase === "failed") {
    return attention("failed", "The build stopped. Resolve the blocker, then resume it.", true);
  }
  if (build.claimStatus === "abandoned") {
    return attention("failed", "This work was stopped. Restart it only if it is still valuable.", true);
  }

  const designReview = build.designReview as { decision?: string } | null | undefined;
  if (designReview?.decision === "fail") {
    return attention("waiting-owner", "The design review did not pass. Review the findings and revise the design.", true);
  }

  const planReview = build.planReview as { decision?: string } | null | undefined;
  if (planReview?.decision === "fail") {
    return attention("waiting-owner", "The plan review did not pass. Review the findings and revise the plan.", true);
  }

  if (build.phase === "ship" && build.acceptanceMet === null) {
    return attention("waiting-owner", "Ready for your release decision.", true);
  }

  if (build.phase === "complete") return attention("complete", null);

  return attention("working", null);
}

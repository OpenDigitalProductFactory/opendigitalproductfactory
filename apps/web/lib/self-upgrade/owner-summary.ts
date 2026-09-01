// apps/web/lib/self-upgrade/owner-summary.ts
//
// Owner-readable release summary for /ops/self-upgrade (BI-8D87084D).
//
// The Self-Upgrade page reads like a runtime ledger: SUR ids, RUNTIME/RELEASES/
// SECURITY tabs, SUCCEEDED/SKIPPED/FAILED status, quiescence blockers. A
// non-technical owner cannot answer the only questions they actually have —
// is an update available, is it safe, is the business still working, can it be
// undone, and what happens if I do nothing.
//
// This is the PURE derivation from the existing status object (no I/O, no React)
// into plain-language answers to exactly those questions, so the card is a thin
// presenter and the wording is unit-testable. The technical controls, run logs,
// and ledgers stay on the page behind an Advanced disclosure — this never
// replaces them, it fronts them.

import type { LocalChangesResult } from "@/lib/self-upgrade/local-changes-ledger";
import { describeSkipReason } from "@/lib/self-upgrade/skip-reason";
import { describeFailureReason } from "@/lib/self-upgrade/failure-reason";

/** The release state an owner cares about — deliberately coarser than the run status machine. */
export type OwnerReleaseState =
  | "up-to-date"
  | "update-available"
  | "in-progress"
  | "failed"
  | "unavailable";

/** Notice/badge tone paired with each state, resolved through the report-kit intent model by the card. */
export type OwnerReleaseTone = "success" | "info" | "warning" | "danger";

/** Consequence copy shown BEFORE a risk-bearing action (Upgrade now) is offered. */
export interface OwnerRiskNotice {
  consequence: string;
  reversibility: string;
  duration: string;
  recovery: string;
}

export interface OwnerReleaseSummary {
  state: OwnerReleaseState;
  tone: OwnerReleaseTone;
  /** One plain-language sentence: the answer to "what's going on with updates?". */
  headline: string;
  /** Human version label for the running build. */
  currentVersion: string;
  /** Human label for the update that's ready, or null when there's nothing newer. */
  availableVersion: string | null;
  /**
   * Whether a newer build is genuinely waiting, independent of what the run
   * state machine is doing about it.
   *
   * This is deliberately NOT derived from `state`. `state` answers "what is
   * happening right now", and its precedence puts in-progress and failed ahead
   * of update-available — so a pending update disappears from `state` the
   * moment a run starts or fails, which is exactly when the operator most needs
   * to see it. Callers deciding whether to offer an install action read this,
   * never `state === "update-available"`.
   */
  updatePending: boolean;
  /**
   * Label for the "update" side of the version pair, phrased for the current
   * state ("Update ready" / "Installing now" / "Update still pending"). Keeps
   * the presenter from having to infer wording from a null.
   */
  availableVersionLabel: string;
  /** The single next thing (if any) the owner should do, in plain words. */
  recommendedAction: { label: string; detail: string };
  /** Can the business keep working through this? */
  canKeepWorking: { ok: boolean; detail: string };
  /** What of the owner's own customisations is preserved across the update. */
  keptLocally: { count: number; detail: string };
  /** Honest, short list of risks — empty when there's nothing to flag. */
  whatCouldGoWrong: string[];
  /** Whether the last/next update can be undone, and how. */
  rollback: { available: boolean; detail: string };
  /** What happens with zero owner intervention. */
  ifYouDoNothing: string;
  /** Present only when a risk-bearing install action is offered (state = update-available). */
  riskNotice: OwnerRiskNotice | null;
}

/**
 * The subset of `getSelfUpgradeStatus()` the summary reads. Declared structurally
 * (not `Awaited<ReturnType<...>>`) so the builder stays decoupled from the server
 * action module and its fixtures stay small. The real status object is a superset
 * and assigns cleanly.
 */
export interface OwnerReleaseInput {
  enabled: boolean;
  support: {
    supported: boolean;
    targetKind: "git-source" | "release-artifact" | "unknown";
    reason: string;
    message: string | null;
  };
  isFresh: boolean;
  targetSha: string | null;
  targetTag?: string | null;
  targetAvailability: "resolved" | "unavailable";
  targetUnavailableReason: string | null;
  deployedSha: string | null;
  nextWindowStart: string | null;
  blackoutUntil: string | null;
  blackoutName: string | null;
  platformVersion: { version: string; gitSha: string | null };
  /**
   * Whether a governed recovery point exists for the last run, so this update
   * can be undone. Computed by the caller (via `hasGovernedRecoveryPoint`) and
   * passed in as a plain boolean, keeping this builder free of the prisma-backed
   * rollback module.
   */
  rollbackAvailable: boolean;
  latestRun: {
    status: string;
    reason: string | null;
    targetSha: string | null;
  } | null;
  latestRunImpact: {
    // Only `breaking` and `total` are read here, so the shape stays permissive:
    // a summary persisted under an older category taxonomy assigns cleanly and
    // this builder never has to know the current bucket list.
    counts: { total: number; breaking?: number } & Record<string, number | undefined>;
    headline: string | null;
  } | null;
  /**
   * BI-5B1FDA09: operator-facing identity for the running / available build,
   * as the last merged PR each contains (`PR #3747`). Optional and nullable:
   * a shallow clone, an unfetched commit, or a direct push with no `(#N)` in
   * its subject leaves these null and the short-SHA labelling below stands.
   */
  runningMergePointLabel?: string | null;
  availableMergePointLabel?: string | null;
}

const IN_FLIGHT: ReadonlySet<string> = new Set(["queued", "pending", "running", "completing"]);

function shortSha(sha: string | null | undefined): string | null {
  if (!sha) return null;
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/** A friendly "on Tuesday at 2:00 AM" for the next quiet window, or "" when unknown. */
function describeWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return ` (${d.toLocaleString(undefined, {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    })})`;
  } catch {
    return "";
  }
}

/**
 * Derive the owner-readable release summary from the self-upgrade status. Pure —
 * safe to unit-test and to call during server render.
 */
export function buildOwnerReleaseSummary(
  input: OwnerReleaseInput,
  localChanges: LocalChangesResult,
): OwnerReleaseSummary {
  const runStatus = input.latestRun?.status ?? null;
  const inFlight = runStatus != null && IN_FLIGHT.has(runStatus);
  const failed = runStatus === "failed";

  const state: OwnerReleaseState = !input.support.supported
    ? "unavailable"
    : inFlight
      ? "in-progress"
      : failed
        ? "failed"
        : input.targetAvailability === "unavailable"
          ? "unavailable"
        : input.isFresh
          ? "up-to-date"
          : "update-available";

  const tone: OwnerReleaseTone =
    state === "up-to-date"
      ? "success"
      : state === "unavailable"
        ? "warning"
      : state === "failed"
        ? "danger"
        : state === "in-progress"
          ? "info"
          : "info";

  // Prefer the merged-PR label over hex. A SHA tells an operator nothing and
  // cannot be looked up; `PR #3747` is a thing they can open, quote, and trace.
  const currentShort = shortSha(input.deployedSha) ?? shortSha(input.platformVersion.gitSha);
  const currentDetail = input.runningMergePointLabel ?? currentShort;
  const currentVersion = currentDetail
    ? `${input.platformVersion.version} (${currentDetail})`
    : input.platformVersion.version;

  // Is a newer build actually waiting? Read from the facts — support, target
  // resolution, freshness — never from `state`.
  //
  // The bug this replaces: `availableVersion` was gated on
  // `state === "update-available"`, so a run that was merely RUNNING or FAILED
  // collapsed it to null, and OwnerReleaseCard rendered that null as the
  // positive claim "You're current" in success green. On a failed upgrade the
  // card asserted the operator was up to date directly above an enabled
  // "Upgrade now" button. page.tsx had already patched around it for the
  // button alone (a `state === "failed" && ... && !isFresh` special case),
  // which left the contradiction on screen and two sources of truth in the code.
  const updatePending =
    input.support.supported && input.targetAvailability === "resolved" && !input.isFresh;

  const targetShort = shortSha(input.targetSha);
  const targetDetail = input.availableMergePointLabel ?? targetShort;
  const availableVersion = updatePending
    ? input.support.targetKind === "release-artifact" && input.targetTag
      ? input.targetTag
      : input.latestRunImpact?.headline
      ? input.latestRunImpact.headline
      : targetDetail
        ? `Latest build (${targetDetail})`
        : "Latest build"
    : null;

  // Same value, different thing being said about it, so the operator is never
  // left to guess why an update is listed while nothing appears to happen.
  const availableVersionLabel = !updatePending
    ? "Update ready"
    : inFlight
      ? "Installing now"
      : failed
        ? "Update still pending"
        : "Update ready";

  // "Why nothing happened" copy for the routine no-op path (run skipped).
  // A resolved, fresh target is newer evidence than an older skipped run. Do
  // not let a historical Git-era "no-target" result overwrite the current
  // release-artifact verdict after a consumer install has recovered discovery.
  const skip = runStatus === "skipped" && !input.isFresh
    ? describeSkipReason(input.latestRun?.reason)
    : null;

  // What's kept from the owner's own install.
  const localCount = localChanges.available ? localChanges.changes.length : 0;
  const keptLocally = localChanges.available
    ? localCount > 0
      ? {
          count: localCount,
          detail: `${localCount} change${plural(localCount)} you've made to this install are kept and re-applied on top of each update.`,
        }
      : {
          count: 0,
          detail: "You have no local changes — this install tracks the standard platform.",
        }
    : {
        count: 0,
        detail: localChanges.note ?? "We couldn't check your local changes just now.",
      };

  const rollbackAvailable = input.rollbackAvailable;
  const rollback = {
    available: rollbackAvailable,
    detail: state === "unavailable"
      ? "There is no automatic update action to undo on this install."
      : rollbackAvailable
      ? "You can restore the version from before the last update — a recovery point was saved."
      : "A recovery point is saved automatically before each update, so an update can be undone.",
  };

  const breaking = input.latestRunImpact?.counts.breaking ?? 0;
  const whatCouldGoWrong: string[] = [];
  if (state !== "unavailable" && breaking > 0) {
    whatCouldGoWrong.push(
      `This update includes ${breaking} higher-impact change${plural(breaking)} — open "What's in this update" below before installing.`,
    );
  }
  if (state !== "unavailable" && keptLocally.count > 0) {
    whatCouldGoWrong.push(
      "Your local changes are merged in automatically; a rare conflict would pause the update for review rather than lose your work.",
    );
  }
  if (state !== "unavailable" && failed) {
    // Say WHAT went wrong, not just that something did. "Check the details
    // below" used to point at a raw build log — the only place the cause
    // existed, which is how two multi-day outages stayed invisible.
    const why = describeFailureReason(input.latestRun?.reason);
    whatCouldGoWrong.push(
      why
        ? `${why.title}. ${why.detail}`
        : "The previous attempt didn't finish — check the details below before you retry.",
    );
  }
  // Always reassure with the safety net, last.
  if (state !== "unavailable") {
    whatCouldGoWrong.push(
      "If an update fails, the platform restores the previous version on its own.",
    );
  }

  let headline: string;
  let recommendedAction: { label: string; detail: string };
  let ifYouDoNothing: string;
  let riskNotice: OwnerRiskNotice | null = null;

  const canKeepWorking = inFlight
    ? {
        ok: true,
        detail: "Mostly — the portal restarts for a moment as the update finishes, then reconnects on its own.",
      }
    : {
        ok: true,
        detail: "Yes. Updates install while your storefront is closed and only restart the portal briefly.",
      };

  switch (state) {
    case "unavailable":
      headline = input.support.supported
        ? "Update availability could not be verified"
        : input.support.message?.replace(/[.]$/, "") ??
          "Automatic updates aren’t available for this install yet";
      recommendedAction = {
        label: input.support.supported ? "No update action available" : "No automatic update action",
        detail: input.support.supported
          ? "DPF could not prove a newer immutable release from the update registry, so it will not queue or install anything. It keeps checking automatically."
          : "DPF will not queue an update until this install’s identity can be verified. Try again when status is available.",
      };
      ifYouDoNothing =
        "Your current release keeps running. Nothing is queued or changed automatically.";
      break;
    case "up-to-date":
      headline = "Your platform is up to date";
      recommendedAction = {
        label: "No action needed",
        detail: skip?.detail ?? "You're running the latest version. Nothing to install.",
      };
      ifYouDoNothing =
        "Nothing changes — you stay on the latest version, and the platform keeps checking for updates for you.";
      break;
    case "update-available":
      headline = "A platform update is ready to install";
      recommendedAction = {
        label: "Install the update",
        detail: input.enabled
          ? "Install it now below, or leave it — it installs on its own during your next quiet period."
          : "Automatic updates are off. Install it below when you're ready.",
      };
      if (input.blackoutUntil) {
        ifYouDoNothing = `Updates are paused${
          input.blackoutName ? ` (${input.blackoutName})` : ""
        } right now, so nothing installs until the pause ends.`;
      } else if (input.enabled) {
        ifYouDoNothing = `The update installs on its own during your next quiet period${describeWhen(
          input.nextWindowStart,
        )}.`;
      } else {
        ifYouDoNothing =
          "Nothing installs — automatic updates are off. It waits here until you install it.";
      }
      riskNotice = {
        consequence: "Installs the new version and briefly restarts the portal.",
        reversibility: rollbackAvailable
          ? "Reversible — restore the saved recovery point to undo it."
          : "A recovery point is saved first, so it can be undone.",
        duration: "Usually a few minutes.",
        recovery: "If it fails, the previous version is restored automatically.",
      };
      break;
    case "in-progress":
      headline = "A platform update is installing now";
      recommendedAction = {
        label: "Let it finish",
        detail: "The update is running. The portal may reconnect for a moment — no action is needed.",
      };
      ifYouDoNothing = "The update finishes on its own. You don't need to do anything.";
      break;
    case "failed":
    default:
      {
        const why = describeFailureReason(input.latestRun?.reason);
        headline = why ? `The last update didn't finish — ${why.title.toLowerCase()}` : "The last update didn't finish";
        recommendedAction = {
          label: why && !why.retryable ? "Needs a decision" : "Review and recover",
          detail: rollbackAvailable
            ? "Restore the previous version below if the platform isn't behaving, then try the update again."
            : why && !why.retryable
              ? "This one won't fix itself on a retry — someone needs to look at the details below."
              : "Check the details below, then try the update again.",
        };
      }
      ifYouDoNothing =
        "The platform stays on the previous version. Nothing else changes until you retry.";
      break;
  }

  return {
    state,
    tone,
    headline,
    currentVersion,
    availableVersion,
    updatePending,
    availableVersionLabel,
    recommendedAction,
    canKeepWorking,
    keptLocally,
    whatCouldGoWrong,
    rollback,
    ifYouDoNothing,
    riskNotice,
  };
}

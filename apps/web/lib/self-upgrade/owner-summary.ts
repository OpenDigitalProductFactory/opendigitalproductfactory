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

/** The release state an owner cares about — deliberately coarser than the run status machine. */
export type OwnerReleaseState =
  | "up-to-date"
  | "update-available"
  | "in-progress"
  | "failed"
  | "blocked";

/** Notice/badge tone paired with each state, resolved through the report-kit intent model by the card. */
export type OwnerReleaseTone = "success" | "info" | "warning" | "danger";

/** Consequence copy shown BEFORE a risk-bearing action (Upgrade now) is offered. */
export interface OwnerRiskNotice {
  consequence: string;
  reversibility: string;
  duration: string;
  authority: string;
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
  statusAvailable?: boolean;
  enabled: boolean;
  isFresh: boolean;
  targetSha: string | null;
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
    counts: {
      breaking: number;
      feature: number;
      fix: number;
      performance: number;
      other: number;
      total: number;
    };
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
  blockerReason?: string | null;
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

  const state: OwnerReleaseState = inFlight
    ? "in-progress"
    : failed
      ? "failed"
      : input.statusAvailable === false
        ? "blocked"
      : input.isFresh || !input.targetSha
        ? "up-to-date"
        : input.blockerReason
          ? "blocked"
        : "update-available";

  const tone: OwnerReleaseTone =
    state === "up-to-date"
      ? "success"
      : state === "failed"
        ? "danger"
        : state === "blocked"
          ? "warning"
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

  const targetShort = shortSha(input.targetSha);
  const targetDetail = input.availableMergePointLabel ?? targetShort;
  const availableVersion =
    state === "update-available" || (state === "blocked" && targetDetail)
      ? input.latestRunImpact?.headline
        ? input.latestRunImpact.headline
        : targetDetail
          ? `Latest build (${targetDetail})`
          : "Latest build"
      : null;

  // "Why nothing happened" copy for the routine no-op path (run skipped).
  const skip = runStatus === "skipped" ? describeSkipReason(input.latestRun?.reason) : null;

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
    detail: rollbackAvailable
      ? "You can restore the version from before the last update — a recovery point was saved."
      : "A recovery point is saved automatically before each update, so an update can be undone.",
  };

  const breaking = input.latestRunImpact?.counts.breaking ?? 0;
  const whatCouldGoWrong: string[] = [];
  if (breaking > 0) {
    whatCouldGoWrong.push(
      `This update includes ${breaking} higher-impact change${plural(breaking)} — open "What's in this update" below before installing.`,
    );
  }
  if (keptLocally.count > 0) {
    whatCouldGoWrong.push(
      "Your local changes are merged in automatically; a rare conflict would pause the update for review rather than lose your work.",
    );
  }
  if (failed) {
    whatCouldGoWrong.push(
      "The previous attempt didn't finish — check the details below before you retry.",
    );
  }
  // Always reassure with the safety net, last.
  whatCouldGoWrong.push(
    "If an update fails, the platform restores the previous version on its own.",
  );

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
        authority: "Only a platform operator can start or override an update.",
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
      headline = "The last update didn't finish";
      recommendedAction = {
        label: "Review and recover",
        detail: rollbackAvailable
          ? "Restore the previous version below if the platform isn't behaving, then try the update again."
          : "Check the details below, then try the update again.",
      };
      ifYouDoNothing =
        "The platform stays on the previous version. Nothing else changes until you retry.";
      break;
    case "blocked":
    default:
      headline = "The platform update needs attention";
      recommendedAction = {
        label: "Resolve the blocker",
        detail:
          input.blockerReason ??
          "Open recovery guidance to resolve the prerequisite safely.",
      };
      ifYouDoNothing =
        "The running version stays in place. No update starts until the blocker is resolved.";
      break;
  }

  return {
    state,
    tone,
    headline,
    currentVersion,
    availableVersion,
    recommendedAction,
    canKeepWorking,
    keptLocally,
    whatCouldGoWrong,
    rollback,
    ifYouDoNothing,
    riskNotice,
  };
}

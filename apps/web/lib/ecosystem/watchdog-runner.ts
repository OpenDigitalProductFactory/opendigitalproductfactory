/**
 * Weekly watchdog runner (BI-784D20FD) — the impure edge that makes the digest
 * actually fire.
 *
 * `buildWatchdogDigest` is pure and had no caller, which is the failure mode the
 * platform already named: a mechanism that is merged but never runs is not
 * delivered. This is its trigger path.
 *
 * Everything external is injected, so the runner is testable without Prisma,
 * without a room, and without a clock.
 */

import { getErrorMessage } from "@/lib/shared/get-error-message";
import { resolveProactivityPlan } from "@/lib/proactivity/proactivity-resolver";
import type { BallotCandidate } from "./ballot";
import type { InstallRelevanceProfile } from "./ballot-applicability";
import {
  buildWatchdogDigest,
  type ApplicableRelease,
  type DispositionNews,
  type WatchdogDigest,
} from "./watchdog";

export interface WatchdogViewer {
  installationId: string;
  audience: string;
  profile: InstallRelevanceProfile;
}

export type WatchdogOutcome =
  | { delivered: true; digest: WatchdogDigest; roomRef: string }
  | { delivered: false; reason: "quiet-week" | "no-room" | "delivery-failed"; message: string };

export interface WatchdogRunnerDeps {
  loadViewer: () => Promise<WatchdogViewer | null>;
  loadCandidates: () => Promise<BallotCandidate[]>;
  loadDispositions?: () => Promise<DispositionNews[]>;
  loadReleases?: () => Promise<ApplicableRelease[]>;
  /** Resolve the derived room this belongs in. Never authored per install. */
  resolveRoom: () => Promise<string | null>;
  deliver: (roomRef: string, digest: WatchdogDigest) => Promise<void>;
  now?: Date;
}

export async function runEcosystemWatchdog(deps: WatchdogRunnerDeps): Promise<WatchdogOutcome> {
  const viewer = await deps.loadViewer();
  if (!viewer) {
    return {
      delivered: false,
      reason: "no-room",
      message: "this installation has no federation identity yet, so it has no ecosystem voice to exercise",
    };
  }

  const [candidates, dispositions, releases] = await Promise.all([
    deps.loadCandidates(),
    deps.loadDispositions?.() ?? Promise.resolve([]),
    deps.loadReleases?.() ?? Promise.resolve([]),
  ]);

  // The posture governs how much is surfaced — the resolver is the single home
  // for that decision, so the watchdog asks rather than deciding for itself.
  const plan = resolveProactivityPlan({ activityFamily: "ecosystem-participation" });

  const digest = buildWatchdogDigest({
    candidates,
    dispositions,
    releases,
    viewer,
    level: plan.resolvedLevel,
    now: deps.now,
  });

  // A quiet week is reported as quiet. Posting "nothing this week" every week is
  // how a coworker gets muted, and a muted coworker delivers nothing at all.
  if (digest.empty) {
    return { delivered: false, reason: "quiet-week", message: "nothing inbound, nothing to answer, nothing shipped" };
  }

  const roomRef = await deps.resolveRoom();
  if (!roomRef) {
    return {
      delivered: false,
      reason: "no-room",
      message: "no derived room resolved for ecosystem participation — the digest was not posted anywhere",
    };
  }

  try {
    await deps.deliver(roomRef, digest);
  } catch (err) {
    // Say it could not be delivered. A digest that was built and lost is worse
    // than one never built, because the counters suggest it arrived.
    return { delivered: false, reason: "delivery-failed", message: getErrorMessage(err) };
  }

  return { delivered: true, digest, roomRef };
}

/** Render the digest as the message a person actually reads. */
export function renderWatchdogMessage(digest: WatchdogDigest): string {
  const lines: string[] = ["## This week in the ecosystem", ""];

  if (digest.ballot.yours.length > 0) {
    lines.push("**What you raised**");
    for (const entry of digest.ballot.yours) lines.push(`- ${entry.title}`);
    lines.push("");
  }

  if (digest.ballot.applies.length > 0) {
    lines.push("**Open for your vote — these apply to you**");
    for (const entry of digest.ballot.applies) {
      lines.push(`- ${entry.title} — ${entry.applicability.reason}`);
    }
    lines.push("");
  }

  if (digest.ballot.mightApply.length > 0) {
    lines.push("**Might apply to you**");
    for (const entry of digest.ballot.mightApply) {
      lines.push(`- ${entry.title} — ${entry.applicability.reason}`);
    }
    lines.push("");
  }

  if (digest.dispositions.length > 0) {
    lines.push("**What happened to what you backed**");
    for (const news of digest.dispositions) {
      lines.push(`- ${news.title}: ${news.outcome}${news.reason ? ` — ${news.reason}` : ""}`);
    }
    lines.push("");
  }

  if (digest.releases.length > 0) {
    lines.push("**Shipped, and it affects you**");
    for (const release of digest.releases) lines.push(`- ${release.summary}`);
    lines.push("");
  }

  // Say what was held back, as a count. Silence about withheld items would make
  // the ballot look complete when it is not.
  const { notRelevant, noConsent } = digest.ballot.withheld;
  if (notRelevant > 0 || noConsent > 0) {
    lines.push(
      `_${notRelevant} not relevant to this organisation; ${noConsent} not shared with us._`,
    );
  }

  return lines.join("\n").trim();
}

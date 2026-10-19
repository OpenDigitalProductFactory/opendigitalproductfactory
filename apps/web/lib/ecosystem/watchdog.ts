/**
 * The weekly ecosystem watchdog (BI-784D20FD).
 *
 * The ballot is not a page somebody must remember to visit. A coworker assembles
 * it, brings it to the room, and carries the outcome back.
 *
 * Two-directional on purpose — that is what makes it a watchdog rather than a
 * ballot box. One weekly turn carries four things into the install:
 *
 *   1. the ballot            — what the ecosystem is asking for, scoped to here
 *   2. inbound relevance     — "this is coming for you too"
 *   3. disposition news      — what happened to what you submitted or voted on
 *   4. applicable releases   — a fix that shipped and applies to this install
 *
 * Pure and dependency-injected: no Prisma, no fetch, no clock of its own.
 */

import { assembleBallot, type Ballot, type BallotCandidate } from "./ballot";
import { classifyBallotItem, type InstallRelevanceProfile } from "./ballot-applicability";

export interface DispositionNews {
  ref: string;
  title: string;
  /** What the upstream install decided. */
  outcome: "scheduled" | "declined" | "deferred";
  /** Why — mandatory for declined and deferred; a bare verdict is not closure. */
  reason: string | null;
}

export interface ApplicableRelease {
  releaseRef: string;
  summary: string;
  archetypeRefs?: string[] | null;
}

export interface WatchdogDigest {
  ballot: Ballot;
  /** Items others submitted that apply here — the "coming for you too" signal. */
  alsoAffectsYou: Array<{ ref: string; title: string; reason: string }>;
  dispositions: DispositionNews[];
  releases: Array<{ releaseRef: string; summary: string }>;
  /** True when there is genuinely nothing to bring. A quiet week is reported as
   *  quiet rather than dressed up as activity. */
  empty: boolean;
}

export interface WatchdogInput {
  candidates: BallotCandidate[];
  dispositions: DispositionNews[];
  releases: ApplicableRelease[];
  viewer: { installationId: string; audience: string; profile: InstallRelevanceProfile };
  /** Resolved proactivity level for the ecosystem-participation family. */
  level: "quiet" | "balanced" | "assertive";
  now?: Date;
}

/**
 * A disposition without a reason is not closure.
 *
 * Ubuntu Brainstorm was retired for accumulating votes that were never answered;
 * a bare "declined" reproduces that failure while looking like a response. A
 * scheduled item speaks for itself, but a decline or a deferral must say why or
 * it is withheld rather than shown as an empty verdict.
 */
export function isClosure(news: DispositionNews): boolean {
  if (news.outcome === "scheduled") return true;
  return Boolean(news.reason && news.reason.trim());
}

export function buildWatchdogDigest(input: WatchdogInput): WatchdogDigest {
  const ballot = assembleBallot({
    candidates: input.candidates,
    viewer: input.viewer,
    now: input.now,
  });

  // Quiet installs get tier 1 and tier 2 only. "Might apply" is exactly the
  // speculative material a quiet posture exists to suppress.
  if (input.level === "quiet") ballot.mightApply = [];

  const ownRefs = new Set(ballot.yours.map((entry) => entry.ref));
  const alsoAffectsYou = ballot.applies
    .filter((entry) => !ownRefs.has(entry.ref))
    .map((entry) => ({ ref: entry.ref, title: entry.title, reason: entry.applicability.reason }));

  const releases = input.releases
    .filter((release) => classifyBallotItem(release, input.viewer.profile).scope === "applies")
    .map((release) => ({ releaseRef: release.releaseRef, summary: release.summary }));

  const dispositions = input.dispositions.filter(isClosure);

  return {
    ballot,
    alsoAffectsYou,
    dispositions,
    releases,
    empty:
      ballot.yours.length === 0
      && ballot.applies.length === 0
      && ballot.mightApply.length === 0
      && dispositions.length === 0
      && releases.length === 0,
  };
}

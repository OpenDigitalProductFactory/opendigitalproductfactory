/**
 * BI-41D7A057 — read the durable promoter step trail and decide, for a run that
 * ended without ever reporting an outcome, whether the container swap could
 * possibly have been applied.
 *
 * Why this exists. A self-upgrade is orchestrated by the very portal it
 * replaces, so its stdout dies with it. When the process is killed for a reason
 * that is NOT the swap — a Docker Desktop restart, a host reboot, a power cut —
 * the run is reconciled to `failed` with no record of how far it got. That is
 * the whole defect: SUR-E18E0141 ended exactly that way and could not be
 * explained afterwards, so nothing about the interruption could be improved.
 *
 * `scripts/promote.sh` now appends each step it announces to a host-backed file
 * on the shared state mount, which outlives the process. This module turns that
 * file into the one fact recovery needs: was the new container ever created?
 *
 * The classification is deliberately one-sided. It returns `false` only for a
 * trail that PROVES the swap had not begun, and `null` for everything else —
 * an absent trail, an unrecognised step, a step at or past the swap. A false
 * "not applied" would authorise re-running a promotion that had already
 * replaced the portal; a false "unknown" costs nothing but an operator click.
 */

/** Where `promote.sh` writes the trail, inside the portal's read-only mount. */
export const INTERRUPTION_TRAIL_PATH = "/dpf-state/self-upgrade-steps.log";

/**
 * Steps `promote.sh` announces strictly BEFORE it recreates any container.
 * While the trail's newest entry is one of these, the running portal is
 * provably still the pre-upgrade one.
 *
 * Listed explicitly rather than derived from an ordered sequence so that a
 * promote.sh NEWER than this portal — an ordinary state during a fleet-wide
 * rollout — emits step names that are simply unrecognised, and an unrecognised
 * step yields "unknown". A positional rule would instead have to guess where an
 * unknown name sits relative to the swap, and guessing in the unsafe direction
 * is what this module exists to avoid.
 *
 * `migrate` is included: schema migrations run before the swap and are
 * forward-only, so re-running the same target after an interruption there
 * re-applies nothing. It is the CONTAINER swap this predicate is about.
 */
const PRE_SWAP_STEPS: ReadonlySet<string> = new Set([
  "host-bind-address-preserved",
  "prepare",
  "backup",
  "install-state-migrate",
  "docker-build",
  "ensure-pgvector",
  "ensure-pgvector-recreate",
  "migrate",
]);

export type TrailEntry = {
  at: string;
  /** "real" | "dry-run" — dry runs never touch the install and never count. */
  mode: string;
  step: string;
  targetSha: string;
};

export type InterruptionClassification = {
  /**
   * `false` when the trail proves the container swap had not started.
   * `null` when it cannot be proven either way. Never `true`: a run that
   * completed its swap reports that itself, and does not come through here.
   */
  swapApplied: false | null;
  /** Newest real step recorded for the target, when there was one. */
  lastStep: string | null;
  /** Timestamp of that step, so an operator can see when progress stopped. */
  lastStepAt: string | null;
  /** Why the classifier reached its verdict — rendered in run history. */
  basis:
    | "no-trail"
    | "no-entry-for-target"
    | "pre-swap-step"
    | "step-at-or-past-swap"
    | "unrecognized-step";
};

const UNKNOWN: InterruptionClassification = {
  swapApplied: null,
  lastStep: null,
  lastStepAt: null,
  basis: "no-trail",
};

/**
 * Parse the tab-separated trail. Malformed lines are skipped rather than
 * throwing: this file is written best-effort by a shell script that may be
 * killed mid-write, so a torn final line is an expected input, not a fault.
 */
export function parseInterruptionTrail(contents: string): TrailEntry[] {
  const entries: TrailEntry[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const parts = line.split("\t");
    if (parts.length !== 4) continue;
    const [at, mode, step, targetSha] = parts;
    if (!at || !mode || !step || !targetSha) continue;
    entries.push({ at, mode, step, targetSha });
  }
  return entries;
}

/**
 * Classify one run's interruption from the trail.
 *
 * Matching is by target SHA, not by run id, because the trail carries no run id
 * — `promote.sh` is not told one, and inventing that env contract would make an
 * older promoter incompatible with a newer portal for no gain. A target SHA is
 * sufficient: only one run per target can be active at a time (admission holds
 * an advisory lock), so the newest real entry for a target belongs to the run
 * being classified.
 */
export function classifyInterruption(
  contents: string | null,
  targetSha: string | null,
): InterruptionClassification {
  if (!contents || !targetSha) return UNKNOWN;
  const wanted = targetSha.toLowerCase();
  const forTarget = parseInterruptionTrail(contents).filter(
    (entry) => entry.mode === "real" && entry.targetSha.toLowerCase() === wanted,
  );
  const last = forTarget.at(-1);
  if (!last) return { ...UNKNOWN, basis: "no-entry-for-target" };
  if (PRE_SWAP_STEPS.has(last.step)) {
    return {
      swapApplied: false,
      lastStep: last.step,
      lastStepAt: last.at,
      basis: "pre-swap-step",
    };
  }
  return {
    swapApplied: null,
    lastStep: last.step,
    lastStepAt: last.at,
    basis: SWAP_AND_LATER_STEPS.has(last.step)
      ? "step-at-or-past-swap"
      : "unrecognized-step",
  };
}

/**
 * Steps at or after the swap. Used only to distinguish "we know this step and
 * it is past the boundary" from "we have never heard of this step" in the
 * recorded basis — both are `swapApplied: null`, but they mean different things
 * to whoever reads the evidence later.
 */
const SWAP_AND_LATER_STEPS: ReadonlySet<string> = new Set([
  "docker-up",
  "seed",
  "health",
  "sha-verify",
  "content-verify",
  "release-identity-commit",
  "sandbox-refresh",
  "decommission-legacy-stores",
  "cleanup",
]);

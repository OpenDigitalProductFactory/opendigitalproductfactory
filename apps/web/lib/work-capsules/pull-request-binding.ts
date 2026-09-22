// Bind a Workroom to the pull request its branch actually produced (BI-0B3FED3D).
//
// Measured on this operator install 2026-09-08: 422 Workrooms, 340 carrying a headBranch,
// and `pullRequestNumber` null on every single one. Only Build Studio's
// capture-build-pr.ts ever writes the field, and its rooms have no headBranch, so
// in practice nothing writes it at all. The consequences compound:
//
//   - A Workroom cannot report whether its work shipped, so a room is closed out
//     by timeout or abandonment rather than by delivery evidence.
//   - `classifyWorkCapsuleLiveness` already gives an open PR precedence over the
//     lease (step 2, "parked in review"). With the field null that branch can
//     never fire, so every room falls through to the lease — which is half of
//     why a bare lease was masquerading as work (BI-7271460C).
//
// The rule is DERIVED, never asked: the branch already determines the answer, so
// nobody has to remember to report the PR number. That is the discipline
// `principles/gate-coverage-matches-blast-radius` states as "prefer a rule the
// gate can decide without anyone remembering to annotate", and it is why this
// resolves from observations rather than adding a reporting obligation to every
// agent that opens a PR (kernel decision DI-D17CAA32468F).
//
// Pure and total: the caller supplies the observations and performs the writes.

import type { PullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";

/** The Workroom fields this rule needs. */
export type BindablePullRequestRoom = {
  capsuleId: string;
  repositoryFullName: string | null;
  headBranch: string | null;
  headSha?: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
};

/** One room's binding, ready for the caller to write. */
export type PullRequestBinding = {
  capsuleId: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  /** Provider state at observation time; `open` is what keeps a room in review. */
  state: PullRequestObservation["state"];
};

/** Why a room could not be bound. Reported, never silently skipped. */
export type PullRequestBindingSkip = {
  capsuleId: string;
  reason:
    /** Already bound to the selected identity, or no full head permits replacement. */
    | "already-bound"
    /** No branch to resolve from — nothing to derive the answer out of. */
    | "no-head-branch"
    /** Branch is real but no observation covers it. Coverage gap, not a verdict. */
    | "no-observation-for-branch";
};

export type PullRequestBindingPlan = {
  bindings: PullRequestBinding[];
  skipped: PullRequestBindingSkip[];
};

/**
 * Pick the one observation that answers "what PR did this branch produce".
 *
 * A branch can carry several over its life: an earlier PR closed unmerged, then
 * a replacement. Precedence is open first, then merged, then closed, and within
 * a state the highest number, which is the newest. Deterministic, so the same
 * inputs always bind the same way and a re-run is a no-op rather than a flap.
 */
function chooseObservation(
  candidates: readonly PullRequestObservation[],
): PullRequestObservation | null {
  if (candidates.length === 0) return null;
  const rank = (state: PullRequestObservation["state"]): number =>
    state === "open" ? 0 : state === "merged" ? 1 : 2;
  return [...candidates].sort(
    (a, b) => rank(a.state) - rank(b.state) || b.number - a.number,
  )[0]!;
}

function branchKey(repositoryFullName: string, headBranch: string): string {
  return `${repositoryFullName}\u0000${headBranch}`;
}

/**
 * Resolve which rooms should be bound to which pull request.
 *
 * A replacement requires the room's full authored head to match the observation.
 * The caller journals the prior binding atomically so current identity can change
 * without rewriting delivery history. Legacy rooms without a full head retain it.
 * Every room that is not bound appears in `skipped` with the reason, so a caller
 * can report its own coverage instead of implying it looked everywhere.
 */
export function resolvePullRequestBindings(input: {
  rooms: readonly BindablePullRequestRoom[];
  observations: readonly PullRequestObservation[];
}): PullRequestBindingPlan {
  const byBranch = new Map<string, PullRequestObservation[]>();
  for (const observation of input.observations) {
    const key = branchKey(observation.repositoryFullName, observation.headBranch);
    const bucket = byBranch.get(key);
    if (bucket) bucket.push(observation);
    else byBranch.set(key, [observation]);
  }

  const bindings: PullRequestBinding[] = [];
  const skipped: PullRequestBindingSkip[] = [];

  for (const room of [...input.rooms].sort((a, b) => a.capsuleId.localeCompare(b.capsuleId))) {
    const exactHead = /^[a-f0-9]{40}$/i.test(room.headSha ?? "");
    if (!exactHead && room.pullRequestNumber != null && room.pullRequestUrl) {
      skipped.push({ capsuleId: room.capsuleId, reason: "already-bound" });
      continue;
    }
    if (!room.headBranch || !room.repositoryFullName) {
      skipped.push({ capsuleId: room.capsuleId, reason: "no-head-branch" });
      continue;
    }
    const chosen = chooseObservation(
      (byBranch.get(branchKey(room.repositoryFullName, room.headBranch)) ?? []).filter(
        (observation) =>
          (!room.headSha || observation.headSha.toLowerCase() === room.headSha.toLowerCase()) &&
          (exactHead || room.pullRequestNumber == null || observation.number === room.pullRequestNumber) &&
          (exactHead || !room.pullRequestUrl || observation.url === room.pullRequestUrl),
      ),
    );
    if (!chosen) {
      skipped.push({ capsuleId: room.capsuleId, reason: "no-observation-for-branch" });
      continue;
    }
    if (room.pullRequestNumber === chosen.number && room.pullRequestUrl === chosen.url) {
      skipped.push({ capsuleId: room.capsuleId, reason: "already-bound" });
      continue;
    }
    bindings.push({
      capsuleId: room.capsuleId,
      pullRequestNumber: chosen.number,
      pullRequestUrl: chosen.url,
      state: chosen.state,
    });
  }

  return { bindings, skipped };
}

/**
 * One honest sentence about what a binding pass covered.
 *
 * A sweep that reports only what it bound reads as complete coverage. Naming the
 * rooms it could not answer for is what keeps the number usable as evidence.
 */
export function describePullRequestBindingPlan(plan: PullRequestBindingPlan): string {
  const counts = plan.skipped.reduce<Record<string, number>>((acc, skip) => {
    acc[skip.reason] = (acc[skip.reason] ?? 0) + 1;
    return acc;
  }, {});
  const parts = [`bound ${plan.bindings.length}`];
  if (counts["already-bound"]) parts.push(`${counts["already-bound"]} already bound`);
  if (counts["no-head-branch"]) parts.push(`${counts["no-head-branch"]} with no branch`);
  if (counts["no-observation-for-branch"]) {
    parts.push(`${counts["no-observation-for-branch"]} whose branch has no observed PR`);
  }
  return parts.join(", ");
}

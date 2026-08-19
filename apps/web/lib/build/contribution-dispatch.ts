// Dispatch decision for contribute_to_hive: given the current flag + config,
// returns what the PR target repos look like and what prep work is needed
// before calling createBranchAndPR. Pure function — no side effects, no I/O
// — so the dispatch contract is unit-testable independent of the surrounding
// contribute_to_hive control flow.
//
// See docs/superpowers/specs/2026-04-23-public-contribution-mode-design.md §"contribute_to_hive — model dispatch"

import { isContributionModelEnabled } from "@/lib/flags/contribution-model";

export type ContributionDispatchInput = {
  contributionModel: string | null;
  upstreamOwner: string;
  upstreamRepo: string;
  contributorForkOwner: string | null;
  contributorForkRepo: string | null;
  forkVerifiedAt: Date | null;
  /** Injected for deterministic unit tests; defaults to Date.now(). */
  now?: Date;
};

export type ContributionDispatchResult =
  | {
      kind: "direct";
      headOwner: string;
      headRepo: string;
      baseOwner: string;
      baseRepo: string;
    }
  | {
      kind: "fork";
      headOwner: string;
      headRepo: string;
      baseOwner: string;
      baseRepo: string;
      /** True when forkVerifiedAt is stale or missing — caller must re-verify before proceeding. */
      needsForkReverification: boolean;
      /** True for fork-pr — caller must sync the fork's base from upstream before pushing. */
      needsMergeUpstream: true;
    }
  | { kind: "error"; error: string };

/**
 * 24 h staleness threshold. Past this, the dispatcher signals re-verification
 * so contribute_to_hive catches forks that have been deleted or renamed since
 * setup.
 */
const FORK_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export function resolveContributionDispatch(
  input: ContributionDispatchInput,
): ContributionDispatchResult {
  const { contributionModel, upstreamOwner, upstreamRepo } = input;

  // Flag off — existing direct-push behavior, regardless of contributionModel.
  // The flag is the kill switch: phases 1-3 can live on main with zero
  // runtime change until operations is ready to flip it.
  if (!isContributionModelEnabled()) {
    return {
      kind: "direct",
      headOwner: upstreamOwner,
      headRepo: upstreamRepo,
      baseOwner: upstreamOwner,
      baseRepo: upstreamRepo,
    };
  }

  // Flag on — contributionModel must be explicitly configured.
  if (contributionModel === null) {
    return {
      kind: "error",
      error:
        "Contribution model is not configured. Open Admin > Platform Development and configure the contribution model before running contribute_to_hive.",
    };
  }

  if (contributionModel === "maintainer-direct") {
    return {
      kind: "direct",
      headOwner: upstreamOwner,
      headRepo: upstreamRepo,
      baseOwner: upstreamOwner,
      baseRepo: upstreamRepo,
    };
  }

  if (contributionModel === "fork-pr") {
    const { contributorForkOwner, contributorForkRepo, forkVerifiedAt } = input;
    if (!contributorForkOwner || !contributorForkRepo) {
      return {
        kind: "error",
        error:
          "Fork-pr contribution model selected but no fork is configured. Open Admin > Platform Development and run fork setup before retrying.",
      };
    }
    const now = input.now ?? new Date();
    const needsReverification =
      !forkVerifiedAt ||
      now.getTime() - forkVerifiedAt.getTime() > FORK_VERIFICATION_TTL_MS;
    return {
      kind: "fork",
      headOwner: contributorForkOwner,
      headRepo: contributorForkRepo,
      baseOwner: upstreamOwner,
      baseRepo: upstreamRepo,
      needsForkReverification: needsReverification,
      needsMergeUpstream: true,
    };
  }

  return {
    kind: "error",
    error: `Unrecognized contributionModel: ${JSON.stringify(contributionModel)}. Expected "maintainer-direct" or "fork-pr".`,
  };
}

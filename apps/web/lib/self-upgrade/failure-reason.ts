/**
 * Human-readable explanations for a self-upgrade run's `failed` status.
 *
 * The sibling of skip-reason.ts, and it exists for the same reason: a status
 * with no words is a silent no-op the Upgrade Center must never show. Skips
 * have had this since they were built; failures never did. `failRun` recorded
 * only `failureLog`, so a failed run offered the operator raw Docker output
 * behind a tooltip and nothing else.
 *
 * Measured on this install before the fix: 55 of 55 failed runs carried no
 * reason at all. Two multi-day outages hid in that gap — four consecutive daily
 * failures (2026-07-26..29) and the Git-LFS breakage (2026-08-29), each
 * invisible until someone opened a build log.
 *
 * Keys are `BuildFailureClass` values from build-failure-classifier.ts plus the
 * pipeline's own structured wrappers. An unmapped reason degrades to a generic
 * explanation rather than showing the raw key — but it still shows SOMETHING,
 * which is the whole point.
 */

export type FailureReasonExplanation = {
  /** Short label, e.g. "The server ran out of memory". */
  title: string;
  /** One-sentence plain-English explanation of what went wrong. */
  detail: string;
  /** Whether the operator can sensibly just retry. */
  retryable: boolean;
};

const EXPLANATIONS: Readonly<Record<string, FailureReasonExplanation>> = {
  "host-out-of-memory": {
    title: "The server ran out of memory",
    detail:
      "The update was built on this server and there wasn't enough memory to finish. Nothing was installed and the platform kept running the version you already had.",
    retryable: true,
  },
  "pnpm-install-failure": {
    title: "A software download failed",
    detail:
      "The update couldn't fetch one of the components it needs. This is usually a temporary network problem rather than anything wrong with the update.",
    retryable: true,
  },
  "lfs-unmaterialized": {
    title: "Part of the update didn't download",
    detail:
      "A large file the update needs arrived as a placeholder instead of the real thing, so the build stopped before installing anything.",
    retryable: true,
  },
  "merge-conflict": {
    title: "Your changes clashed with the update",
    detail:
      "Changes made on this install overlap with the update, so it paused rather than overwrite your work. Someone needs to decide how to combine them.",
    retryable: false,
  },
  "promoter-readiness-failed": {
    title: "The updater wasn't ready",
    detail:
      "The component that installs updates couldn't start. Nothing was installed and the platform is untouched.",
    retryable: true,
  },
  "doctools-prepull-failed": {
    title: "The update's document reader didn't download",
    detail:
      "The update brings a new version of the tool that reads Word, Excel and PDF files, and it couldn't be downloaded before switching over. Nothing was installed and the platform kept running the version you already had. This is usually a temporary network problem.",
    retryable: true,
  },
  "dirty-tree": {
    title: "Uncommitted changes are in the way",
    detail:
      "There are unsaved local edits on this install, so the update stopped rather than risk losing them.",
    retryable: false,
  },
  "turbopack-nft-duplicate-asset": {
    title: "The update's build produced conflicting files",
    detail:
      "While packaging the new version, the build wrote two different files to the same name and stopped. Nothing was installed and the platform kept running the version you already had. This usually clears on the next version, so retrying is worth a try.",
    retryable: true,
  },
  "host-docker-hoist-divergence": {
    title: "The update was missing one of its components",
    detail:
      "The build couldn't find a piece of software it needed, so it stopped before installing anything. This one needs a developer — retrying on its own is unlikely to help.",
    retryable: false,
  },
  "bundle-boundary-static-import": {
    title: "The update mixed up two parts of the platform",
    detail:
      "Code that is only meant to run behind the scenes got pulled into the part of the platform that serves pages, and the build stopped. Nothing was installed. A developer needs to separate them.",
    retryable: false,
  },
  "database-unreachable": {
    title: "The database couldn't be reached",
    detail:
      "The update couldn't contact the platform's database to apply its changes. This is usually temporary — the platform kept running the version you already had.",
    retryable: true,
  },
  "promoter-timeout": {
    title: "The update took too long and was stopped",
    detail:
      "The installer exceeded its time limit and was halted deliberately. Nothing was installed and the platform is untouched.",
    retryable: true,
  },
  "no-target": {
    title: "No update could be identified",
    detail:
      "The platform couldn't work out which version to install, so it did nothing.",
    retryable: true,
  },
};

const GENERIC: FailureReasonExplanation = {
  title: "The update didn't finish",
  detail:
    "The update stopped partway through. Nothing was installed and the platform kept running the version you already had.",
  retryable: true,
};

/**
 * Map a persisted `reason` to a plain-English explanation.
 *
 * Accepts both a bare class (`host-out-of-memory`) and the `class: detail`
 * shape the pipeline's wrappers use (`promoter-readiness-failed: …`), matching
 * how skip reasons are written.
 */
export function describeFailureReason(
  reason: string | null | undefined,
): FailureReasonExplanation | null {
  if (!reason || !reason.trim()) return null;
  const key = reason.split(":")[0]?.trim() ?? "";
  return EXPLANATIONS[key] ?? GENERIC;
}

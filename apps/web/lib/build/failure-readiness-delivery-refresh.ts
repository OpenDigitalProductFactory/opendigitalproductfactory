import type { GithubPrObservation, GithubPrReadiness } from "./github-pr-readiness";

/** The required check that reads the platform-published `dpf/failure-readiness` status. */
export const FAILURE_READINESS_CHECK_NAME = "Failure Readiness";
/** The commit status itself, which GitHub lists beside the checks. */
export const FAILURE_READINESS_STATUS_CONTEXT = "dpf/failure-readiness";
const readinessSignal = (name: string) => name === FAILURE_READINESS_CHECK_NAME || name === FAILURE_READINESS_STATUS_CONTEXT;

export type FailureReadinessRefresh = {
  /** The readiness to act on: unchanged, or withheld when no publishable review exists. */
  readiness: GithubPrReadiness;
  /** True when failed check runs were re-run, so the PR must be observed again before acting. */
  observeAgain: boolean;
  refreshed: boolean;
  rerunRunIds: number[];
};

/**
 * Keep Failure Readiness current for a PR the room is about to deliver
 * (BI-4D0B2AAB). The check accepts a status for one hour, and the merge queue
 * re-checks it, so a review that passed earlier expires before the PR reaches
 * the queue. Delivery used to re-queue such a PR indefinitely (60 attempts on
 * WC-DD38BDB9) and left a PR whose only red check was that expired status alone.
 *
 * Republication is the server's own verdict for the room's current head, never
 * the client's artifact. Nothing is republished when the room has no
 * publishable review: a ready PR is then withheld instead of queued to fail.
 */
export async function refreshFailureReadinessForDelivery(input: {
  observation: GithubPrObservation;
  readiness: GithubPrReadiness;
  verdict: () => Promise<{ mayPublish: boolean; reason: string }>;
  publish: () => Promise<unknown>;
  rerun: (workflowRunId: number) => Promise<"accepted" | "not-rerunnable">;
}): Promise<FailureReadinessRefresh> {
  const unchanged = { readiness: input.readiness, observeAgain: false, refreshed: false, rerunRunIds: [] };
  if (!input.observation.checks.some(check => check.name === FAILURE_READINESS_CHECK_NAME)) return unchanged;
  const failing = input.observation.checks.filter(check => check.status.toUpperCase() === "COMPLETED"
    && check.conclusion?.toUpperCase() === "FAILURE");
  // Only a red check that is nothing but Failure Readiness can be cleared by republishing.
  const onlyReadinessRed = input.readiness.kind === "checking" && input.readiness.reason === "checks-failing"
    && failing.length > 0 && failing.every(check => readinessSignal(check.name));
  if (input.readiness.kind !== "ready" && !onlyReadinessRed) return unchanged;

  const verdict = await input.verdict();
  if (!verdict.mayPublish) {
    return input.readiness.kind === "ready"
      ? { ...unchanged, readiness: { kind: "checking", headSha: input.readiness.headSha,
          reason: `failure-readiness-not-publishable: ${verdict.reason}` } }
      : unchanged;
  }
  await input.publish();
  if (input.readiness.kind === "ready") return { ...unchanged, refreshed: true };

  const rerunRunIds: number[] = [];
  // The republished status replaces the red commit status; only the check run needs a re-run.
  for (const check of failing) {
    if (check.name !== FAILURE_READINESS_CHECK_NAME || typeof check.workflowRunId !== "number") continue;
    if (await input.rerun(check.workflowRunId) === "accepted") rerunRunIds.push(check.workflowRunId);
  }
  return { readiness: input.readiness, observeAgain: rerunRunIds.length > 0, refreshed: true, rerunRunIds };
}

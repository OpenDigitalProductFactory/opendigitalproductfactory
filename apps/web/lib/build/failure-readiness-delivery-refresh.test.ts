import { describe, expect, it, vi } from "vitest";
import { FAILURE_READINESS_CHECK_NAME, refreshFailureReadinessForDelivery } from "./failure-readiness-delivery-refresh";
import type { GithubCheckObservation, GithubPrObservation, GithubPrReadiness } from "./github-pr-readiness";

const check = (name: string, conclusion: string, workflowRunId: number | null = null): GithubCheckObservation =>
  ({ name, status: "COMPLETED", conclusion, workflowRunId });
const observation = (checks: GithubCheckObservation[]): GithubPrObservation => ({
  nodeId: "PR_node", number: 9, url: "https://github.com/o/r/pull/9", state: "OPEN", merged: false, headSha: "sha1",
  mergeStateStatus: "CLEAN", unresolvedReviewThreads: 0, reviewThreadsComplete: true, checksComplete: true, checks,
  autoMergeEnabled: false, mergeQueueEntry: false,
});
const ready: GithubPrReadiness = { kind: "ready", headSha: "sha1" };
const failing: GithubPrReadiness = { kind: "checking", headSha: "sha1", reason: "checks-failing" };

function deps(mayPublish = true) {
  return {
    verdict: vi.fn(async () => ({ mayPublish, reason: mayPublish ? "reviewed" : "No failure-analysis review exists for this final change." })),
    publish: vi.fn(async () => undefined),
    rerun: vi.fn(async () => "accepted" as const),
  };
}

describe("refreshFailureReadinessForDelivery (BI-4D0B2AAB)", () => {
  it("republishes the server verdict before a ready PR is queued, so the queue reads a fresh status", async () => {
    const d = deps();
    const result = await refreshFailureReadinessForDelivery({
      observation: observation([check(FAILURE_READINESS_CHECK_NAME, "SUCCESS"), check("CI", "SUCCESS")]), readiness: ready, ...d });
    expect(d.publish).toHaveBeenCalledOnce();
    expect(result).toEqual({ readiness: ready, observeAgain: false, refreshed: true, rerunRunIds: [] });
  });

  it("withholds a ready PR whose room has no publishable review instead of queueing it to fail", async () => {
    const d = deps(false);
    const result = await refreshFailureReadinessForDelivery({
      observation: observation([check(FAILURE_READINESS_CHECK_NAME, "SUCCESS")]), readiness: ready, ...d });
    expect(d.publish).not.toHaveBeenCalled();
    expect(result.readiness).toMatchObject({ kind: "checking", reason: expect.stringContaining("failure-readiness-not-publishable") });
  });

  it("clears a PR whose only red check is an expired Failure Readiness status: republish, re-run, observe again", async () => {
    const d = deps();
    const result = await refreshFailureReadinessForDelivery({
      observation: observation([check(FAILURE_READINESS_CHECK_NAME, "FAILURE", 41), check("CI", "SUCCESS", 42)]), readiness: failing, ...d });
    expect(d.publish).toHaveBeenCalledOnce();
    expect(d.rerun).toHaveBeenCalledWith(41);
    expect(d.rerun).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ observeAgain: true, refreshed: true, rerunRunIds: [41] });
  });

  it("treats a red dpf/failure-readiness commit status as the same signal, re-running only the check run", async () => {
    const d = deps();
    const result = await refreshFailureReadinessForDelivery({
      observation: observation([check(FAILURE_READINESS_CHECK_NAME, "FAILURE", 41), check("dpf/failure-readiness", "FAILURE")]),
      readiness: failing, ...d });
    expect(d.publish).toHaveBeenCalledOnce();
    expect(d.rerun).toHaveBeenCalledTimes(1);
    expect(result.rerunRunIds).toEqual([41]);
  });

  it("leaves every other red PR alone: another failing check, or no publishable review", async () => {
    const mixed = deps();
    await refreshFailureReadinessForDelivery({
      observation: observation([check(FAILURE_READINESS_CHECK_NAME, "FAILURE", 41), check("CI", "FAILURE", 42)]), readiness: failing, ...mixed });
    expect(mixed.verdict).not.toHaveBeenCalled();
    const unreviewed = deps(false);
    const result = await refreshFailureReadinessForDelivery({
      observation: observation([check(FAILURE_READINESS_CHECK_NAME, "FAILURE", 41)]), readiness: failing, ...unreviewed });
    expect(unreviewed.publish).not.toHaveBeenCalled();
    expect(unreviewed.rerun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ readiness: failing, observeAgain: false, refreshed: false });
  });

  it("does nothing for a PR without the Failure Readiness check, or one already queued or merged", async () => {
    for (const [checks, readiness] of [
      [[check("CI", "SUCCESS")], ready],
      [[check(FAILURE_READINESS_CHECK_NAME, "SUCCESS")], { kind: "queued", headSha: "sha1" }],
      [[check(FAILURE_READINESS_CHECK_NAME, "SUCCESS")], { kind: "merged", headSha: "sha1" }],
    ] as const) {
      const d = deps();
      const result = await refreshFailureReadinessForDelivery({ observation: observation([...checks]), readiness, ...d });
      expect(d.verdict).not.toHaveBeenCalled();
      expect(result).toMatchObject({ readiness, refreshed: false });
    }
  });

  it("does not report a re-run GitHub refused", async () => {
    const d = { ...deps(), rerun: vi.fn(async () => "not-rerunnable" as const) };
    const result = await refreshFailureReadinessForDelivery({
      observation: observation([check(FAILURE_READINESS_CHECK_NAME, "FAILURE", 41)]), readiness: failing, ...d });
    expect(result).toMatchObject({ observeAgain: false, refreshed: true, rerunRunIds: [] });
  });
});

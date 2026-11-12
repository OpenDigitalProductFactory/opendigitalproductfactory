// BI-8E1486FA — merge detection for squash and rebase merges, shared by the
// Workroom reaper and the drive's overseer duty. Split from
// work-capsule-reaper.test.ts, which sits at the module-size ceiling.

import { describe, expect, it } from "vitest";

import { annotateProviderDeliverySignals } from "./work-capsule-reaper";

const NOW = new Date("2026-08-05T15:00:00.000Z");

function capsule(overrides: Record<string, unknown> = {}) {
  return {
    capsuleId: "WC-X", title: "Something", status: "working", source: "external-adoption", executorKind: "claude-desktop",
    leaseExpiresAt: null, lastSyncedAt: null, updatedAt: NOW, pullRequestUrl: null, pullRequestNumber: null,
    repositoryFullName: null, headBranch: null, headSha: null, worktreePath: null, featureBuildId: null, ...overrides,
  };
}

// BI-8E1486FA: squash and rebase merges leave the room's recorded head off main,
// and many rooms never had their PR bound (WC-B9703CBC, WC-EC0E4382).
describe("annotateProviderDeliverySignals by branch (BI-8E1486FA)", () => {
  const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
  const pr = (over: Record<string, unknown>) => ({
    repositoryFullName: REPO, number: 6341, url: `https://github.com/${REPO}/pull/${String(over.number ?? 6341)}`, title: "t",
    headBranch: "feat/customer-intake-controller", headSha: "a".repeat(40), state: "merged", isDraft: false, mergeStateStatus: "CLEAN",
    mergeCommitSha: "b".repeat(40), mergedAt: "2026-08-05T14:00:00.000Z", providerUpdatedAt: "2026-08-05T14:00:00.000Z",
    observedAt: "2026-08-05T14:51:00.000Z", providerApiVersion: "github-rest/2022-11-28", observationFingerprint: "x", ...over,
  });
  const observe = async (...rows: Record<string, unknown>[]) => {
    const { createPullRequestObservation } = await import("../contributor-change-lanes/pull-request-observation");
    return rows.map((row) => createPullRequestObservation(row as never));
  };
  // The room recorded a head the squash commit does not contain, and no PR number.
  const room = (over: Record<string, unknown> = {}) => capsule({
    capsuleId: "WC-SQUASH", repositoryFullName: REPO, headBranch: "feat/customer-intake-controller", headSha: "c".repeat(40),
    baseSha: "1".repeat(40), pullRequestNumber: null, lastSyncedAt: new Date("2026-08-05T13:00:00.000Z"), ...over,
  }) as any;

  it("marks a squash-merged branch delivered when its newest PR merged after the room last recorded its head", async () => {
    const rows = [room()];
    await annotateProviderDeliverySignals(rows, await observe(pr({})), NOW);
    expect(rows[0].deliveredSignal).toEqual({ merged: true });
  });

  it("marks a room delivered when its bound PR merged, whatever head it recorded before the merge", async () => {
    const rows = [room({ pullRequestNumber: 6355 })];
    await annotateProviderDeliverySignals(rows, await observe(pr({ number: 6355 })), NOW);
    expect(rows[0].deliveredSignal).toEqual({ merged: true });
  });

  it("does not close a branch whose newest PR is open, even after an older one merged", async () => {
    const rows = [room()];
    const older = pr({ number: 6300, providerUpdatedAt: "2026-08-01T00:00:00.000Z", mergedAt: "2026-08-01T00:00:00.000Z" });
    const open = pr({ number: 6341, state: "open", mergeCommitSha: null, mergedAt: null });
    await annotateProviderDeliverySignals(rows, await observe(older, open), NOW);
    expect(rows[0].deliveredSignal).toBeUndefined();
    expect(rows[0].pullRequestObservation?.state).toBe("open");
  });

  it("stays unknown with no observation for the branch", async () => {
    const rows = [room()];
    await annotateProviderDeliverySignals(rows, await observe(pr({ headBranch: "feat/other" })), NOW);
    expect(rows[0].deliveredSignal).toBeUndefined();
    expect(rows[0].pullRequestObservation).toBeUndefined();
  });

  it("stays unknown when the room recorded its head after the merge: that head may not be in it", async () => {
    const rows = [room({ lastSyncedAt: new Date("2026-08-05T14:30:00.000Z") })];
    await annotateProviderDeliverySignals(rows, await observe(pr({})), NOW);
    expect(rows[0].deliveredSignal).toBeUndefined();
  });
});

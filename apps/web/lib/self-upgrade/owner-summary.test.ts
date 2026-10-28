import { describe, expect, it } from "vitest";
import { buildOwnerReleaseSummary, type OwnerReleaseInput } from "./owner-summary";
import type { LocalChangesResult } from "./local-changes-ledger";
import { getSelfUpgradeRecoveryState } from "./recovery-eligibility";

const NO_LOCAL_CHANGES: LocalChangesResult = { available: true, changes: [] };

function baseInput(overrides: Partial<OwnerReleaseInput> = {}): OwnerReleaseInput {
  return {
    enabled: true,
    support: {
      supported: true,
      targetKind: "git-source",
      reason: "enabled",
      message: null,
    },
    isFresh: true,
    targetSha: null,
    targetAvailability: "resolved",
    targetUnavailableReason: null,
    deployedSha: "abc1234def",
    nextWindowStart: null,
    blackoutUntil: null,
    blackoutName: null,
    platformVersion: { version: "1.2.0", gitSha: "abc1234" },
    recovery: getSelfUpgradeRecoveryState(null),
    latestRun: null,
    latestRunImpact: null,
    ...overrides,
  };
}

// Terms an owner should never have to decode on the summary card. The technical
// ledger keeps them behind the Advanced disclosure; this asserts the OWNER card
// stays plain-language (the cognitive-load acceptance for BI-8D87084D).
const JARGON = ["SUR-", "quiescence", "quiesce", "promoter", "targetSha", "deployedSha", "SHA", "Inngest", "admission lane"];

function allCopy(s: ReturnType<typeof buildOwnerReleaseSummary>): string {
  return [
    s.headline,
    s.currentVersion,
    s.availableVersion ?? "",
    s.recommendedAction.label,
    s.recommendedAction.detail,
    s.canKeepWorking.detail,
    s.keptLocally.detail,
    ...s.whatCouldGoWrong,
    s.rollback.detail,
    s.ifYouDoNothing,
    ...(s.riskNotice ? Object.values(s.riskNotice) : []),
  ].join(" \n ");
}

describe("buildOwnerReleaseSummary", () => {
  it("does not promise undo or universal automatic recovery when restoration is unavailable", () => {
    const summary = buildOwnerReleaseSummary(baseInput({ isFresh: false,
      targetSha: "f".repeat(40) }), NO_LOCAL_CHANGES);
    expect(summary.rollback.available).toBe(false);
    expect(allCopy(summary)).not.toMatch(/can be undone|restored automatically|restores the previous version on its own/i);
    expect(summary.riskNotice?.recovery).toBe("A prior version can be used only if it is compatible with the retained history.");
  });
  it("reports an unidentified install as unavailable instead of up to date", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        enabled: false,
        isFresh: false,
        targetSha: null,
        support: {
          supported: false,
          targetKind: "unknown",
          reason: "install-identity-unverified",
          message: "Automatic updates are unavailable until this install’s identity is verified.",
        },
      }),
      NO_LOCAL_CHANGES,
    );

    expect(s.state).toBe("unavailable");
    expect(s.tone).toBe("warning");
    expect(s.headline).toBe("Automatic updates are unavailable until this install’s identity is verified");
    expect(s.recommendedAction.label).toBe("No automatic update action");
    expect(s.ifYouDoNothing).toContain("current release keeps running");
    expect(s.riskNotice).toBeNull();
  });

  it("reports up-to-date when the build is fresh with no target", () => {
    const s = buildOwnerReleaseSummary(baseInput({ isFresh: true, targetSha: null }), NO_LOCAL_CHANGES);
    expect(s.state).toBe("up-to-date");
    expect(s.tone).toBe("success");
    expect(s.availableVersion).toBeNull();
    expect(s.riskNotice).toBeNull();
    expect(s.recommendedAction.label).toBe("No action needed");
  });

  it("reports registry discovery failure as unavailable instead of up to date", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        support: {
          supported: true,
          targetKind: "release-artifact",
          reason: "enabled",
          message: null,
        },
        isFresh: false,
        targetSha: null,
        targetAvailability: "unavailable",
        targetUnavailableReason: "registry-unavailable",
      }),
      NO_LOCAL_CHANGES,
    );

    expect(s.state).toBe("unavailable");
    expect(s.headline).toBe("Update availability could not be verified");
    expect(s.recommendedAction.label).toBe("No update action available");
    expect(s.ifYouDoNothing).toContain("current release keeps running");
  });

  it("does not surface a stale no-target skip after release discovery proves the install is current", () => {
    const sha = "f".repeat(40);
    const s = buildOwnerReleaseSummary(
      baseInput({
        support: {
          supported: true,
          targetKind: "release-artifact",
          reason: "enabled",
          message: null,
        },
        isFresh: true,
        targetSha: sha,
        deployedSha: sha,
        latestRun: {
          status: "skipped",
          reason: "no-target",
          targetSha: null,
        },
      }),
      NO_LOCAL_CHANGES,
    );

    expect(s.state).toBe("up-to-date");
    expect(s.recommendedAction.detail).toBe("You're running the latest version. Nothing to install.");
    expect(allCopy(s)).not.toContain("No target build could be resolved");
  });

  it("reports update-available with a consequence/reversibility risk notice", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({ isFresh: false, targetSha: "f".repeat(40) }),
      NO_LOCAL_CHANGES,
    );
    expect(s.state).toBe("update-available");
    expect(s.availableVersion).toContain("fffffff");
    // Risk copy must state all four contract fields before the action is offered.
    expect(s.riskNotice).not.toBeNull();
    expect(s.riskNotice?.consequence.length).toBeGreaterThan(0);
    expect(s.riskNotice?.reversibility.length).toBeGreaterThan(0);
    expect(s.riskNotice?.duration.length).toBeGreaterThan(0);
    expect(s.riskNotice?.recovery.length).toBeGreaterThan(0);
  });

  it("uses the immutable release tag as the owner-facing available version", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        support: {
          supported: true,
          targetKind: "release-artifact",
          reason: "enabled",
          message: null,
        },
        isFresh: false,
        targetSha: "f".repeat(40),
        targetTag: "v2026.08.24",
      }),
      NO_LOCAL_CHANGES,
    );

    expect(s.availableVersion).toBe("v2026.08.24");
  });

  it("prefers the merged-PR label over hex in both version labels (BI-5B1FDA09)", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        isFresh: false,
        targetSha: "f".repeat(40),
        runningMergePointLabel: "PR #3746",
        availableMergePointLabel: "PR #3747",
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.currentVersion).toContain("PR #3746");
    expect(s.currentVersion).not.toContain("abc1234");
    expect(s.availableVersion).toContain("PR #3747");
    expect(s.availableVersion).not.toContain("fffffff");
  });

  it("falls back to the short SHA when no merged PR could be resolved", () => {
    // A direct push, a shallow clone, or a missing host mount: the label is
    // absent and the previous hex identity must still render.
    const s = buildOwnerReleaseSummary(
      baseInput({ isFresh: false, targetSha: "f".repeat(40) }),
      NO_LOCAL_CHANGES,
    );
    expect(s.availableVersion).toContain("fffffff");
  });

  it("uses the impact headline as the available version when present", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        isFresh: false,
        targetSha: "f".repeat(40),
        latestRunImpact: {
          counts: { breaking: 0, feature: 3, fix: 2, performance: 0, other: 1, total: 6 },
          headline: "6 changes · 3 new · 2 fixes",
        },
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.availableVersion).toBe("6 changes · 3 new · 2 fixes");
  });

  it("flags higher-impact (breaking) changes in what-could-go-wrong", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        isFresh: false,
        targetSha: "f".repeat(40),
        latestRunImpact: {
          counts: { breaking: 2, feature: 0, fix: 0, performance: 0, other: 0, total: 2 },
          headline: null,
        },
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.whatCouldGoWrong.some((w) => w.includes("higher-impact"))).toBe(true);
  });

  it("describes prior-version recovery as conditional on compatible retained history", () => {
    const s = buildOwnerReleaseSummary(baseInput(), NO_LOCAL_CHANGES);
    expect(s.whatCouldGoWrong.at(-1)).toBe("A prior version can be used only if it is compatible with the retained history.");
  });

  it("reports in-progress while a run is queued/running/completing", () => {
    for (const status of ["queued", "pending", "running", "completing"]) {
      const s = buildOwnerReleaseSummary(
        baseInput({
          latestRun: { status, reason: null, targetSha: null },
        }),
        NO_LOCAL_CHANGES,
      );
      expect(s.state).toBe("in-progress");
      expect(s.riskNotice).toBeNull();
      expect(s.canKeepWorking.ok).toBe(true);
    }
  });

  it("reports failed without offering restoration just because a backup exists", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        isFresh: false,
        targetSha: "f".repeat(40),
        recovery: getSelfUpgradeRecoveryState({ status: "failed", completionEvidence: { recoveryPoint: {
          schemaVersion: 1, trigger: "pre-upgrade-recovery", status: "ok",
          members: [{ target: "postgres", runId: "BR-PG", status: "ok" }],
        } } }),
        latestRun: { status: "failed", reason: null, targetSha: null },
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.state).toBe("failed");
    expect(s.tone).toBe("danger");
    expect(s.rollback.available).toBe(false);
    expect(s.rollback.detail).toContain("review history can be preserved safely");
    expect(s.recommendedAction.detail).not.toContain("Restore the previous version");
  });

  it("explains unavailable restoration when no governed recovery point exists", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({ recovery: getSelfUpgradeRecoveryState({ status: "succeeded", completionEvidence: null }),
        latestRun: { status: "succeeded", reason: null, targetSha: null } }),
      NO_LOCAL_CHANGES,
    );
    expect(s.rollback.available).toBe(false);
    expect(s.rollback.detail).toContain("no governed recovery point");
  });

  it("counts kept local changes and explains they are preserved", () => {
    const local: LocalChangesResult = {
      available: true,
      changes: [
        { path: "apps/web/a.ts", added: 1, deleted: 0 },
        { path: "apps/web/b.ts", added: 2, deleted: 1 },
      ],
    };
    const s = buildOwnerReleaseSummary(baseInput(), local);
    expect(s.keptLocally.count).toBe(2);
    expect(s.keptLocally.detail).toContain("kept");
  });

  it("degrades gracefully when local changes could not be measured", () => {
    const s = buildOwnerReleaseSummary(baseInput(), {
      available: false,
      changes: [],
      note: "Ledger unavailable right now.",
    });
    expect(s.keptLocally.count).toBe(0);
    expect(s.keptLocally.detail).toBe("Ledger unavailable right now.");
  });

  it("explains do-nothing behaviour for a paused (blackout) schedule", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        isFresh: false,
        targetSha: "f".repeat(40),
        blackoutUntil: "2026-08-01T00:00:00.000Z",
        blackoutName: "Holiday freeze",
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.ifYouDoNothing).toContain("paused");
    expect(s.ifYouDoNothing).toContain("Holiday freeze");
  });

  it("explains do-nothing behaviour when automatic updates are off", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({ enabled: false, isFresh: false, targetSha: "f".repeat(40) }),
      NO_LOCAL_CHANGES,
    );
    expect(s.ifYouDoNothing).toContain("automatic updates are off");
  });

  it("keeps every owner-facing string free of runtime jargon", () => {
    const inputs: OwnerReleaseInput[] = [
      baseInput({ isFresh: true, targetSha: null }),
      baseInput({ isFresh: false, targetSha: "f".repeat(40) }),
      baseInput({ latestRun: { status: "running", reason: null, targetSha: null } }),
      baseInput({
        isFresh: false,
        targetSha: "f".repeat(40),
        latestRun: { status: "failed", reason: null, targetSha: null },
      }),
    ];
    for (const input of inputs) {
      const copy = allCopy(buildOwnerReleaseSummary(input, NO_LOCAL_CHANGES));
      for (const term of JARGON) {
        expect(copy).not.toContain(term);
      }
    }
  });
});

// ── The pending update must survive the run state machine ────────────────────
//
// Regression cover for the contradiction an operator hit on /ops/self-upgrade:
// the card's top tile read "Update ready: You're current" in success green
// while the banner below it read "Update available", and the "Upgrade now"
// button directly under the tile was enabled. `availableVersion` was gated on
// `state === "update-available"`, and state precedence puts in-progress and
// failed ahead of it — so a pending update vanished from the summary exactly
// when a run was working on it or had just failed to.
//
// The existing in-progress/failed tests asserted state, tone, rollback and
// canKeepWorking, and never asserted availableVersion. That is the gap.
describe("buildOwnerReleaseSummary — pending update vs run state", () => {
  const PENDING = {
    isFresh: false,
    targetSha: "f".repeat(40),
    targetAvailability: "resolved" as const,
    availableMergePointLabel: "PR #4854",
  };

  it("keeps the available build visible while a run is in flight", () => {
    for (const status of ["queued", "pending", "running", "completing"]) {
      const s = buildOwnerReleaseSummary(
        baseInput({ ...PENDING, latestRun: { status, reason: null, targetSha: null } }),
        NO_LOCAL_CHANGES,
      );
      expect(s.state).toBe("in-progress");
      expect(s.updatePending).toBe(true);
      expect(s.availableVersion).toContain("PR #4854");
      expect(s.availableVersionLabel).toBe("Installing now");
    }
  });

  it("keeps the available build visible after a run fails", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        ...PENDING,
        latestRun: { status: "failed", reason: null, targetSha: null },
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.state).toBe("failed");
    expect(s.updatePending).toBe(true);
    expect(s.availableVersion).toContain("PR #4854");
    expect(s.availableVersionLabel).toBe("Update still pending");
  });

  it("reports no pending update when the build is genuinely fresh", () => {
    const s = buildOwnerReleaseSummary(baseInput({ isFresh: true }), NO_LOCAL_CHANGES);
    expect(s.updatePending).toBe(false);
    expect(s.availableVersion).toBeNull();
  });

  it("reports no pending update when the target cannot be resolved", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        isFresh: false,
        targetAvailability: "unavailable",
        targetUnavailableReason: "registry-unreachable",
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.updatePending).toBe(false);
    expect(s.availableVersion).toBeNull();
  });

  it("reports no pending update when self-upgrade is unsupported on this install", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        ...PENDING,
        support: {
          supported: false,
          targetKind: "unknown",
          reason: "install-identity-unverified",
          message: "Automatic updates are unavailable.",
        },
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.updatePending).toBe(false);
    expect(s.availableVersion).toBeNull();
  });

  // The two halves of the page must never disagree: the banner in
  // SelfUpgradeClient renders "Update available" from `!isFresh` directly, so
  // updatePending has to track the same fact for every run status.
  it("agrees with the freshness flag the technical banner reads, whatever the run is doing", () => {
    for (const status of [null, "queued", "running", "failed", "skipped", "succeeded"]) {
      const s = buildOwnerReleaseSummary(
        baseInput({
          ...PENDING,
          latestRun: status ? { status, reason: null, targetSha: null } : null,
        }),
        NO_LOCAL_CHANGES,
      );
      expect(s.updatePending).toBe(true);
    }
  });
});

// A failed run must say WHAT went wrong. "Check the details below" used to
// point at a raw Docker log — the only place the cause existed, which is how
// four consecutive daily failures (2026-07-26..29) and the Git-LFS breakage
// (2026-08-29) stayed invisible to the operator.
describe("buildOwnerReleaseSummary — a failure explains itself", () => {
  const FAILED = {
    isFresh: false,
    targetSha: "f".repeat(40),
    targetAvailability: "resolved" as const,
  };

  it("names the cause in the headline and the risk list", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        ...FAILED,
        latestRun: { status: "failed", reason: "host-out-of-memory", targetSha: null },
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.state).toBe("failed");
    expect(s.headline).toContain("ran out of memory");
    expect(s.whatCouldGoWrong.join(" ")).toContain("ran out of memory");
  });

  it("tells the operator when a retry will not help", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        ...FAILED,
        recovery: getSelfUpgradeRecoveryState(null),
        latestRun: { status: "failed", reason: "merge-conflict: 3 files", targetSha: null },
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.recommendedAction.label).toBe("Needs a decision");
    expect(s.recommendedAction.detail).toContain("won't fix itself");
  });

  // Historical rows (and any future unclassified failure) have no reason. The
  // card must degrade to the old copy rather than render an empty sentence.
  it("falls back cleanly when no reason was recorded", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        ...FAILED,
        latestRun: { status: "failed", reason: null, targetSha: null },
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.headline).toBe("The last update didn't finish");
    expect(s.whatCouldGoWrong.join(" ")).toContain("didn't finish");
  });

  it("keeps the failure copy free of operator jargon", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        ...FAILED,
        latestRun: { status: "failed", reason: "pnpm-install-failure", targetSha: null },
      }),
      NO_LOCAL_CHANGES,
    );
    const copy = [s.headline, s.recommendedAction.detail, ...s.whatCouldGoWrong].join(" ");
    for (const term of JARGON) expect(copy).not.toContain(term);
  });
});

// SUR-90C34FAC: a swap retry reported a completed drain as failure after the
// target was already running. Freshness alone must never hide real failures.
describe("buildOwnerReleaseSummary - landed swap reporting", () => {
  const target = "a".repeat(40);
  const replayReason = "admission-reopened-before-swap: the drain already ended (completed)";

  it("reports current only for the known replay failure whose target is actually running", () => {
    const summary = buildOwnerReleaseSummary(baseInput({
      targetSha: target,
      deployedSha: target.toUpperCase(),
      latestRun: { status: "failed", reason: replayReason, targetSha: target },
    }), NO_LOCAL_CHANGES);
    expect(summary.state).toBe("up-to-date");
    expect(summary.tone).toBe("success");
    expect(summary.recommendedAction.label).toBe("No action needed");
    expect(summary.whatCouldGoWrong.join(" ")).not.toContain("didn't finish");
    expect(summary.ifYouDoNothing).not.toContain("previous version");
  });

  it.each([null, "b".repeat(40)])("keeps the replay failure visible without matching runtime identity: %s", (deployedSha) => {
    const summary = buildOwnerReleaseSummary(baseInput({
      targetSha: target,
      deployedSha,
      latestRun: { status: "failed", reason: replayReason, targetSha: target },
    }), NO_LOCAL_CHANGES);
    expect(summary.state).toBe("failed");
    expect(summary.tone).toBe("danger");
  });

  it("recognizes the deployed merge identity when upstream lineage differs", () => {
    const summary = buildOwnerReleaseSummary(baseInput({
      targetSha: "b".repeat(40),
      deployedSha: target,
      latestRun: { status: "failed", reason: replayReason, targetSha: "b".repeat(40), deployedSha: target },
    }), NO_LOCAL_CHANGES);
    expect(summary.state).toBe("up-to-date");
    expect(summary.recommendedAction.label).toBe("No action needed");
  });

  it("does not substitute matching lineage for a different expected deployed identity", () => {
    const summary = buildOwnerReleaseSummary(baseInput({
      targetSha: target,
      deployedSha: target,
      latestRun: { status: "failed", reason: replayReason, targetSha: target, deployedSha: "b".repeat(40) },
    }), NO_LOCAL_CHANGES);
    expect(summary.state).toBe("failed");
    expect(summary.tone).toBe("danger");
  });

  it("preserves a genuine failure when the deployed merge identity is running", () => {
    const summary = buildOwnerReleaseSummary(baseInput({
      targetSha: "b".repeat(40),
      deployedSha: target,
      latestRun: { status: "failed", reason: "host-out-of-memory", targetSha: "b".repeat(40), deployedSha: target },
    }), NO_LOCAL_CHANGES);
    expect(summary.state).toBe("failed");
    expect(summary.headline).toContain("ran out of memory");
    expect(summary.recommendedAction.detail).toContain("version is running");
    expect(allCopy(summary)).not.toContain("Nothing was installed");
  });
  it("requires the failed run's target, not the current update target, to match", () => {
    const summary = buildOwnerReleaseSummary(baseInput({
      targetSha: target,
      deployedSha: target,
      latestRun: { status: "failed", reason: replayReason, targetSha: null },
    }), NO_LOCAL_CHANGES);
    expect(summary.state).toBe("failed");
  });

  it.each([null, "unclassified-failure", "host-out-of-memory"])("preserves a genuine or unknown failure on the running target: %s", (reason) => {
    const summary = buildOwnerReleaseSummary(baseInput({
      targetSha: target,
      deployedSha: target,
      latestRun: { status: "failed", reason, targetSha: target },
    }), NO_LOCAL_CHANGES);
    expect(summary.state).toBe("failed");
    expect(summary.tone).toBe("danger");
    expect(summary.recommendedAction.detail).toContain("version is running");
    expect(summary.ifYouDoNothing).not.toContain("previous version");
    expect(allCopy(summary)).not.toContain("Nothing was installed");
    expect(allCopy(summary)).not.toContain("kept running the version you already had");
    if (reason === "host-out-of-memory") expect(summary.headline).toContain("ran out of memory");
  });

  it("keeps a newer update visible after the earlier target landed", () => {
    const summary = buildOwnerReleaseSummary(baseInput({
      isFresh: false,
      targetSha: "c".repeat(40),
      deployedSha: target,
      latestRun: { status: "failed", reason: replayReason, targetSha: target },
    }), NO_LOCAL_CHANGES);
    expect(summary.state).toBe("update-available");
    expect(summary.updatePending).toBe(true);
    expect(summary.availableVersion).toContain("ccccccc");
    expect(summary.availableVersionLabel).toBe("Update ready");
  });

  it("does not imply current status when update discovery is unavailable", () => {
    const summary = buildOwnerReleaseSummary(baseInput({
      targetAvailability: "unavailable",
      targetSha: null,
      deployedSha: target,
      latestRun: { status: "failed", reason: replayReason, targetSha: target },
    }), NO_LOCAL_CHANGES);
    expect(summary.state).toBe("unavailable");
    expect(summary.recommendedAction.label).toBe("No update action available");
  });
});
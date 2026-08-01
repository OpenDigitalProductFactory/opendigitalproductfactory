import { describe, expect, it } from "vitest";
import {
  buildOwnerReleaseSummary,
  conciseFailureReason,
  type OwnerReleaseInput,
} from "./owner-summary";
import type { LocalChangesResult } from "./local-changes-ledger";

const NO_LOCAL_CHANGES: LocalChangesResult = { available: true, changes: [] };

function baseInput(overrides: Partial<OwnerReleaseInput> = {}): OwnerReleaseInput {
  return {
    enabled: true,
    isFresh: true,
    targetSha: null,
    deployedSha: "abc1234def",
    nextWindowStart: null,
    blackoutUntil: null,
    blackoutName: null,
    platformVersion: { version: "1.2.0", gitSha: "abc1234" },
    rollbackAvailable: false,
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
    s.failureReason ?? "",
  ].join(" \n ");
}

describe("buildOwnerReleaseSummary", () => {
  it("reports up-to-date when the build is fresh with no target", () => {
    const s = buildOwnerReleaseSummary(baseInput({ isFresh: true, targetSha: null }), NO_LOCAL_CHANGES);
    expect(s.state).toBe("up-to-date");
    expect(s.tone).toBe("success");
    expect(s.availableVersion).toBeNull();
    expect(s.riskNotice).toBeNull();
    expect(s.recommendedAction.label).toBe("No action needed");
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
    expect(s.riskNotice?.authority.length).toBeGreaterThan(0);
    expect(s.riskNotice?.recovery.length).toBeGreaterThan(0);
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

  it("always includes the automatic-restore safety net", () => {
    const s = buildOwnerReleaseSummary(baseInput(), NO_LOCAL_CHANGES);
    expect(s.whatCouldGoWrong.at(-1)).toContain("restores the previous version");
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

  it("reports failed and points at recovery when a run failed with a recovery point", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        isFresh: false,
        targetSha: "f".repeat(40),
        rollbackAvailable: true,
        latestRun: {
          status: "failed",
          reason: null,
          targetSha: null,
          failureLog:
            "[build-failure-class] health-check-failed\nHealth checks did not pass.",
        },
      }),
      NO_LOCAL_CHANGES,
    );
    expect(s.state).toBe("failed");
    expect(s.tone).toBe("danger");
    expect(s.rollback.available).toBe(true);
    expect(s.recommendedAction.detail).toContain("Restore the previous version");
    expect(s.failureReason).toBe("Health checks did not pass.");
  });

  it("reports a truthful blocked state instead of contradicting the unavailable control", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        isFresh: false,
        targetSha: "f".repeat(40),
        blockerReason: "The update worker is unavailable.",
      }),
      NO_LOCAL_CHANGES,
    );

    expect(s.state).toBe("blocked");
    expect(s.tone).toBe("warning");
    expect(s.headline).toContain("needs attention");
    expect(s.recommendedAction.detail).toContain("worker is unavailable");
    expect(s.riskNotice).toBeNull();
  });

  it("does not invent an update when the install is current but automatic updates are off", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        enabled: false,
        isFresh: true,
        targetSha: null,
        blockerReason: "Automatic platform updates are disabled.",
      }),
      NO_LOCAL_CHANGES,
    );

    expect(s.state).toBe("up-to-date");
    expect(s.availableVersion).toBeNull();
  });

  it("fails closed when status itself is unavailable", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({
        statusAvailable: false,
        isFresh: true,
        targetSha: null,
        blockerReason: "Update status is temporarily unavailable.",
      }),
      NO_LOCAL_CHANGES,
    );

    expect(s.state).toBe("blocked");
    expect(s.availableVersion).toBeNull();
  });

  it("marks rollback unavailable (with a reassuring detail) when no governed recovery point exists", () => {
    const s = buildOwnerReleaseSummary(
      baseInput({ rollbackAvailable: false, latestRun: { status: "succeeded", reason: null, targetSha: null } }),
      NO_LOCAL_CHANGES,
    );
    expect(s.rollback.available).toBe(false);
    expect(s.rollback.detail).toContain("saved automatically");
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

describe("conciseFailureReason", () => {
  it("prefers the classified human summary", () => {
    expect(
      conciseFailureReason(
        "[build-failure-class] docker-mount-denied\n[build-failure-class] Docker Desktop refused to share /root/.dpf.",
      ),
    ).toBe("Docker Desktop refused to share /root/.dpf.");
  });
});

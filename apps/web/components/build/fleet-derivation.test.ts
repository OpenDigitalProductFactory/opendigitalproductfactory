// apps/web/components/build/fleet-derivation.test.ts
//
// Pin the conservative defaults for fleet-state derivation. Concurrency-
// thread dispatcher will eventually supply real queue positions; until
// then these tests lock in the phase-based fallback contract so the
// fleet rail's UX doesn't silently drift.

import { describe, expect, it } from "vitest";

import {
  deriveCoworkerActivityCount,
  deriveFleetCounts,
  deriveNeedsAttention,
  deriveQueueState,
  formatOperatorFocusHeader,
  formatFleetHeader,
  isBuildStalled,
  isOperatorFocusEntry,
} from "./fleet-derivation";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "row-1",
    buildId: "FB-AAAAAAAA",
    title: "Sample",
    description: null,
    portfolioId: null,
    originatingBacklogItemId: null,
    brief: null,
    plan: null,
    phase: "ideate",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: null,
    digitalProductId: null,
    product: null,
    createdById: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    draftApprovedAt: null,
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: null,
    acceptanceMet: null,
    scoutFindings: null,
    uxTestResults: null,
    uxVerificationStatus: null,
    accountableEmployeeId: null,
    claimedByAgentId: null,
    claimedAt: null,
    claimStatus: null,
    buildExecState: null,
    deliberationSummary: null,
    happyPathState: normalizeHappyPathState(null),
    originator: null,
    phaseHandoffs: [],
    ...overrides,
  };
}

describe("deriveQueueState", () => {
  it("counts ideate / plan as running in-flight, ship / complete as idle (BI-5939B62F)", () => {
    // ideate/plan are active in-flight phases — they must not read as idle, or
    // the fleet/queue counters show 0 while builds are genuinely in progress.
    expect(deriveQueueState(makeBuild({ phase: "ideate" }))).toEqual({ kind: "running", stepLabel: "Ideating" });
    expect(deriveQueueState(makeBuild({ phase: "plan" }))).toEqual({ kind: "running", stepLabel: "Planning" });
    // ship/complete are terminal-ish → still idle.
    expect(deriveQueueState(makeBuild({ phase: "ship" }))).toEqual({ kind: "idle" });
    expect(deriveQueueState(makeBuild({ phase: "complete" }))).toEqual({ kind: "idle" });
  });

  it("returns blocked for terminal failure", () => {
    const state = deriveQueueState(makeBuild({ phase: "failed" }));
    expect(state.kind).toBe("blocked");
    expect(state.kind === "blocked" && state.reason).toMatch(/failed/i);
  });

  it("returns running with humanized step label when phase=build + step set", () => {
    const state = deriveQueueState(
      makeBuild({
        phase: "build",
        buildExecState: { step: "code_generated" } as unknown as FeatureBuildRow["buildExecState"],
      }),
    );
    expect(state).toEqual({ kind: "running", stepLabel: "Generating code" });
  });

  it("returns blocked when phase=build but exec carries an error", () => {
    const state = deriveQueueState(
      makeBuild({
        phase: "build",
        buildExecState: { step: "code_generated", error: "sandbox died unexpectedly" } as unknown as FeatureBuildRow["buildExecState"],
      }),
    );
    expect(state.kind).toBe("blocked");
    expect(state.kind === "blocked" && state.reason).toBe("sandbox died unexpectedly");
  });

  it("returns running with null stepLabel when phase=build + no exec yet", () => {
    const state = deriveQueueState(makeBuild({ phase: "build", buildExecState: null }));
    expect(state).toEqual({ kind: "running", stepLabel: null });
  });

  it("returns running when phase=review (verification & review in flight)", () => {
    const state = deriveQueueState(makeBuild({ phase: "review" }));
    expect(state).toEqual({ kind: "running", stepLabel: "Verification & review" });
  });

  it("truncates very long error messages to keep tooltips bounded", () => {
    const longErr = "x".repeat(500);
    const state = deriveQueueState(
      makeBuild({
        phase: "build",
        buildExecState: { error: longErr } as unknown as FeatureBuildRow["buildExecState"],
      }),
    );
    expect(state.kind === "blocked" && state.reason.length).toBe(140);
  });

  it("falls back to raw step name for unknown step ids", () => {
    const state = deriveQueueState(
      makeBuild({
        phase: "build",
        buildExecState: { step: "unknown_phase_xyz" } as unknown as FeatureBuildRow["buildExecState"],
      }),
    );
    expect(state).toEqual({ kind: "running", stepLabel: "unknown phase xyz" });
  });
});

describe("deriveNeedsAttention", () => {
  it("is true when phase=failed", () => {
    expect(deriveNeedsAttention(makeBuild({ phase: "failed" }))).toBe(true);
  });

  it("is true when build phase carries an exec error", () => {
    expect(
      deriveNeedsAttention(
        makeBuild({
          phase: "build",
          buildExecState: { error: "deps install failed" } as unknown as FeatureBuildRow["buildExecState"],
        }),
      ),
    ).toBe(true);
  });

  it("is true when designReview decision=fail", () => {
    expect(
      deriveNeedsAttention(
        makeBuild({
          phase: "plan",
          designReview: { decision: "fail" } as unknown as FeatureBuildRow["designReview"],
        }),
      ),
    ).toBe(true);
  });

  it("is true when planReview decision=fail", () => {
    expect(
      deriveNeedsAttention(
        makeBuild({
          phase: "plan",
          planReview: { decision: "fail" } as unknown as FeatureBuildRow["planReview"],
        }),
      ),
    ).toBe(true);
  });

  it("is true when phase=ship + acceptanceMet is null (operator decision pending)", () => {
    expect(
      deriveNeedsAttention(makeBuild({ phase: "ship", acceptanceMet: null })),
    ).toBe(true);
  });

  it("is true when claim is abandoned", () => {
    expect(
      deriveNeedsAttention(makeBuild({ phase: "build", claimStatus: "abandoned" as FeatureBuildRow["claimStatus"] })),
    ).toBe(true);
  });

  it("is false for a healthy in-flight build (phase=build, no error, no failed reviews)", () => {
    expect(
      deriveNeedsAttention(
        makeBuild({
          phase: "build",
          buildExecState: { step: "code_generated" } as unknown as FeatureBuildRow["buildExecState"],
        }),
      ),
    ).toBe(false);
  });

  it("is false for an idle ideate build", () => {
    expect(deriveNeedsAttention(makeBuild({ phase: "ideate" }))).toBe(false);
  });
});

describe("deriveFleetCounts", () => {
  it("counts running, queued, and blocked states; ignores idle", () => {
    const counts = deriveFleetCounts([
      { kind: "running", stepLabel: null },
      { kind: "running", stepLabel: "x" },
      { kind: "queued", position: 1, reason: "capacity", ahead: 0 },
      { kind: "blocked", reason: "x" },
      { kind: "idle" },
      { kind: "idle" },
    ]);
    expect(counts).toEqual({ runningCount: 2, queuedCount: 1, blockedCount: 1 });
  });

  it("returns zeros for an empty list", () => {
    expect(deriveFleetCounts([])).toEqual({
      runningCount: 0,
      queuedCount: 0,
      blockedCount: 0,
    });
  });
});

describe("isOperatorFocusEntry", () => {
  it("keeps idle ideation work out of the operator focus queue", () => {
    const build = makeBuild({ buildId: "FB-IDLE", phase: "ideate" });

    expect(
      isOperatorFocusEntry(
        {
          build,
          queueState: { kind: "idle" },
          needsAttention: false,
        },
        null,
      ),
    ).toBe(false);
  });

  it("keeps quiet ideate/plan OUT of focus even though they now derive to running (BI-5939B62F)", () => {
    // deriveQueueState(ideate/plan) is now "running" so the fleet counters count
    // them, but a non-selected, non-attention ideate/plan build stays out of the
    // operator focus queue.
    for (const phase of ["ideate", "plan"] as const) {
      expect(
        isOperatorFocusEntry(
          {
            build: makeBuild({ buildId: `FB-${phase}`, phase }),
            queueState: { kind: "running", stepLabel: phase === "ideate" ? "Ideating" : "Planning" },
            needsAttention: false,
          },
          null,
        ),
      ).toBe(false);
    }
  });

  it("keeps the selected build visible even when it is otherwise parked", () => {
    const build = makeBuild({ buildId: "FB-SELECTED", phase: "plan" });

    expect(
      isOperatorFocusEntry(
        {
          build,
          queueState: { kind: "idle" },
          needsAttention: false,
        },
        "FB-SELECTED",
      ),
    ).toBe(true);
  });

  it("keeps running, queued, blocked, and attention-needing builds visible", () => {
    const base = makeBuild({ buildId: "FB-FOCUS", phase: "build" });

    expect(
      isOperatorFocusEntry(
        {
          build: base,
          queueState: { kind: "running", stepLabel: "Generating code" },
          needsAttention: false,
        },
        null,
      ),
    ).toBe(true);
    expect(
      isOperatorFocusEntry(
        {
          build: base,
          queueState: { kind: "queued", position: 1, reason: "capacity", ahead: 0 },
          needsAttention: false,
        },
        null,
      ),
    ).toBe(true);
    expect(
      isOperatorFocusEntry(
        {
          build: base,
          queueState: { kind: "blocked", reason: "Plan review failed" },
          needsAttention: false,
        },
        null,
      ),
    ).toBe(true);
    expect(
      isOperatorFocusEntry(
        {
          build: base,
          queueState: { kind: "idle" },
          needsAttention: true,
        },
        null,
      ),
    ).toBe(true);
  });
});

describe("formatFleetHeader", () => {
  it("keeps the legacy formatter on the operator-focus language", () => {
    expect(formatFleetHeader(2, 3, 4)).toBe("Needs you: 0 · Working: 2 · Waiting: 4 · Parked: 0");
    expect(formatFleetHeader(0, 5, 0)).toBe("Needs you: 0 · Working: 0 · Parked: 0");
  });
});

describe("formatOperatorFocusHeader", () => {
  it("summarizes the human-facing queue without in-flight jargon", () => {
    expect(
      formatOperatorFocusHeader({
        needsYouCount: 1,
        workingCount: 2,
        parkedCount: 8,
      }),
    ).toBe("Needs you: 1 · Working: 2 · Parked: 8");
  });

  it("omits the Coworker segment when no coworker-custody work is active", () => {
    expect(
      formatOperatorFocusHeader({ needsYouCount: 0, workingCount: 0, parkedCount: 3, coworkerCount: 0 }),
    ).toBe("Needs you: 0 · Working: 0 · Parked: 3");
  });

  it("shows a distinct Coworker segment (between Working and Parked) when > 0", () => {
    expect(
      formatOperatorFocusHeader({ needsYouCount: 0, workingCount: 0, parkedCount: 1, coworkerCount: 2 }),
    ).toBe("Needs you: 0 · Working: 0 · Coworker: 2 · Parked: 1");
  });
});

describe("deriveCoworkerActivityCount", () => {
  it("counts only ideate/plan builds (the coworker's off-rail custody), not build/review/idle", () => {
    const builds = [
      { phase: "ideate" as const },
      { phase: "plan" as const },
      { phase: "plan" as const },
      { phase: "build" as const },
      { phase: "review" as const },
      { phase: "ship" as const },
      { phase: "complete" as const },
      { phase: "failed" as const },
    ];
    expect(deriveCoworkerActivityCount(builds)).toBe(3);
    expect(deriveCoworkerActivityCount([])).toBe(0);
  });
});

describe("stall detection (BI-46204009) — status reflects activity freshness", () => {
  const now = new Date("2026-07-18T00:00:00Z").getTime();
  const fresh = new Date(now - 5 * 60 * 1000); // 5 min ago — healthy checkpoint cadence
  const stale = new Date(now - 3 * 60 * 60 * 1000); // 3h ago — frozen

  it("flags a build- or review-phase build with no recent update as stalled", () => {
    expect(isBuildStalled(makeBuild({ phase: "build", updatedAt: stale }), now)).toBe(true);
    expect(isBuildStalled(makeBuild({ phase: "review", updatedAt: stale }), now)).toBe(true);
  });

  it("does not flag a freshly-updated build as stalled", () => {
    expect(isBuildStalled(makeBuild({ phase: "build", updatedAt: fresh }), now)).toBe(false);
  });

  it("never flags off-rail (ideate/plan) or terminal phases, even when stale", () => {
    for (const phase of ["ideate", "plan", "ship", "complete"] as const) {
      expect(isBuildStalled(makeBuild({ phase, updatedAt: stale }), now)).toBe(false);
    }
  });

  it("reports a stalled build as blocked (not an animated running/Working badge)", () => {
    const state = deriveQueueState(makeBuild({ phase: "build", updatedAt: stale }), now);
    expect(state.kind).toBe("blocked");
    if (state.kind === "blocked") expect(state.reason).toMatch(/^Stalled/);
  });

  it("keeps a fresh build-phase build as running", () => {
    const state = deriveQueueState(
      makeBuild({ phase: "build", updatedAt: fresh, buildExecState: null }),
      now,
    );
    expect(state.kind).toBe("running");
  });

  it("routes a stalled build to Needs-you, and leaves a fresh one alone", () => {
    expect(deriveNeedsAttention(makeBuild({ phase: "build", updatedAt: stale }), now)).toBe(true);
    expect(deriveNeedsAttention(makeBuild({ phase: "build", updatedAt: fresh }), now)).toBe(false);
  });
});

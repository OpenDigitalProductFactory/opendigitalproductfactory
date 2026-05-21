// apps/web/components/build/fleet-derivation.test.ts
//
// Pin the conservative defaults for fleet-state derivation. Concurrency-
// thread dispatcher will eventually supply real queue positions; until
// then these tests lock in the phase-based fallback contract so the
// fleet rail's UX doesn't silently drift.

import { describe, expect, it } from "vitest";

import {
  deriveFleetCounts,
  deriveNeedsAttention,
  deriveQueueState,
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
  it("returns idle for ideate / plan / ship / complete phases", () => {
    expect(deriveQueueState(makeBuild({ phase: "ideate" }))).toEqual({ kind: "idle" });
    expect(deriveQueueState(makeBuild({ phase: "plan" }))).toEqual({ kind: "idle" });
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

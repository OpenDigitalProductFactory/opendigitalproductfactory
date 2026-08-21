import { describe, expect, it } from "vitest";

import { deriveBuildAttention, isBuildStalled, STALL_THRESHOLD_MS } from "./build-attention";
import type { BuildStudioCustomerStatus } from "./customer-status-projection";
import type { FeatureBuildRow } from "@/lib/feature-build-types";

const NOW = new Date("2026-08-21T12:00:00.000Z").getTime();

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "cuid-1",
    buildId: "FB-0001",
    title: "Tenant API key rotation",
    phase: "build",
    updatedAt: new Date(NOW - 60_000),
    buildExecState: null,
    designReview: null,
    planReview: null,
    acceptanceMet: null,
    claimStatus: null,
    ...overrides,
  } as unknown as FeatureBuildRow;
}

function makeStatus(overrides: Partial<BuildStudioCustomerStatus> = {}): BuildStudioCustomerStatus {
  return {
    whatIsBeingBuilt: "Tenant API key rotation",
    lifecyclePosition: "Building the change",
    worker: "Build Studio is working on this change",
    evidence: "This work is actively executing.",
    nextAction: "continue implementation until verification evidence is ready.",
    owner: "Build Studio build agent",
    needsYou: false,
    ...overrides,
  };
}

describe("isBuildStalled", () => {
  it("is true for build/review with no update past the threshold", () => {
    const stale = new Date(NOW - STALL_THRESHOLD_MS - 1000);
    expect(isBuildStalled(makeBuild({ phase: "build", updatedAt: stale }), NOW)).toBe(true);
    expect(isBuildStalled(makeBuild({ phase: "review", updatedAt: stale }), NOW)).toBe(true);
  });

  it("is false inside the threshold", () => {
    expect(isBuildStalled(makeBuild({ phase: "build" }), NOW)).toBe(false);
  });

  it("only build/review can stall — other phases are off-rail or terminal", () => {
    const stale = new Date(NOW - STALL_THRESHOLD_MS - 1000);
    for (const phase of ["ideate", "plan", "ship", "complete", "failed"] as const) {
      expect(isBuildStalled(makeBuild({ phase, updatedAt: stale }), NOW)).toBe(false);
    }
  });

  it("does not treat an unparseable updatedAt as stalled", () => {
    expect(
      isBuildStalled(makeBuild({ updatedAt: "not-a-date" as unknown as Date }), NOW),
    ).toBe(false);
  });
});

describe("deriveBuildAttention — the reason is never discarded", () => {
  it("names the stall duration rather than only that attention is needed", () => {
    const stale = new Date(NOW - 45 * 60_000);
    const a = deriveBuildAttention(makeBuild({ phase: "build", updatedAt: stale }), null, NOW);
    expect(a.state).toBe("blocked");
    expect(a.needsOwner).toBe(true);
    expect(a.reason).toMatch(/45 minutes/);
    expect(a.fromRuntimeSignal).toBe(true);
  });

  it("surfaces the exec error text as the reason", () => {
    const a = deriveBuildAttention(
      makeBuild({
        phase: "build",
        buildExecState: { error: "deps install failed" } as unknown as FeatureBuildRow["buildExecState"],
      }),
      null,
      NOW,
    );
    expect(a.state).toBe("blocked");
    expect(a.reason).toContain("deps install failed");
  });

  it("names the release decision on a ship build with no acceptance recorded", () => {
    const a = deriveBuildAttention(makeBuild({ phase: "ship", acceptanceMet: null }), null, NOW);
    expect(a.state).toBe("waiting-owner");
    expect(a.reason).toMatch(/release decision/i);
  });

  it("names which review failed", () => {
    const design = deriveBuildAttention(
      makeBuild({ phase: "plan", designReview: { decision: "fail" } as never }),
      null,
      NOW,
    );
    expect(design.reason).toMatch(/design review/i);

    const plan = deriveBuildAttention(
      makeBuild({ phase: "plan", planReview: { decision: "fail" } as never }),
      null,
      NOW,
    );
    expect(plan.reason).toMatch(/plan review/i);
  });
});

describe("deriveBuildAttention — union with the canonical projection", () => {
  it("prefers the canonical status when it has an opinion", () => {
    const a = deriveBuildAttention(
      makeBuild({ phase: "build" }),
      makeStatus({
        needsYou: true,
        lifecyclePosition: "Waiting for your decision",
        nextAction: "answer the requested decision so the work can continue.",
      }),
      NOW,
    );
    expect(a.state).toBe("waiting-owner");
    expect(a.reason).toContain("answer the requested decision");
    expect(a.fromRuntimeSignal).toBe(false);
  });

  it("still surfaces a stall even when the capsule looks healthy", () => {
    // The reason the local heuristic was kept rather than deleted: a dead
    // watchdog leaves a healthy-looking capsule behind.
    const stale = new Date(NOW - STALL_THRESHOLD_MS - 60_000);
    const a = deriveBuildAttention(
      makeBuild({ phase: "build", updatedAt: stale }),
      makeStatus({ needsYou: false }),
      NOW,
    );
    expect(a.state).toBe("blocked");
    expect(a.fromRuntimeSignal).toBe(true);
  });

  it("stays quiet on a healthy in-flight build", () => {
    const a = deriveBuildAttention(makeBuild({ phase: "build" }), makeStatus(), NOW);
    expect(a.needsOwner).toBe(false);
    expect(a.reason).toBeNull();
  });
});

describe("deriveBuildAttention — needsOwner is derived, never independent", () => {
  it("cannot claim the owner is needed while naming no reason", () => {
    // This is the defect that started this work: the rail said "Needs you"
    // while the Next card said no action was needed, and nothing said why.
    const cases: Array<[FeatureBuildRow, BuildStudioCustomerStatus | null]> = [
      [makeBuild({ phase: "ship", acceptanceMet: null }), null],
      [makeBuild({ phase: "failed" }), null],
      [makeBuild({ phase: "build", updatedAt: new Date(NOW - 40 * 60_000) }), null],
      [makeBuild({ phase: "plan", planReview: { decision: "fail" } as never }), null],
      [
        makeBuild({ phase: "build" }),
        makeStatus({ needsYou: true, lifecyclePosition: "Waiting for your decision" }),
      ],
    ];
    for (const [build, status] of cases) {
      const a = deriveBuildAttention(build, status, NOW);
      expect(a.needsOwner).toBe(true);
      expect(a.reason, `${build.phase} must name a reason`).toBeTruthy();
    }
  });

  it("never reports needsOwner for a working or complete state", () => {
    for (const status of [makeStatus(), makeStatus({ lifecyclePosition: "Done", worker: "Finished" })]) {
      const a = deriveBuildAttention(makeBuild({ phase: "build" }), status, NOW);
      expect(a.needsOwner).toBe(false);
    }
  });
});

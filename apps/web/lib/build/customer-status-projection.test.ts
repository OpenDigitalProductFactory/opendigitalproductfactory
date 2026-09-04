import { describe, expect, it } from "vitest";

import { projectBuildStudioCustomerStatus } from "./customer-status-projection";
import { reconcileBuildStudioCustomerStatus } from "./owner-status-reconciliation";
import type { BuildProgressVisibility } from "./progress-visibility";
import { STALLED_BUILD_REAP_MS } from "./inert-build-reaper";
import { createBuildPrDeliveryState, writeBuildPrDeliveryState } from "./build-pr-delivery-state";

const build = { title: "Add a dark-mode toggle", phase: "build" as const, updatedAt: new Date("2026-07-20T00:00:00Z") };

describe("projectBuildStudioCustomerStatus (BI-BB13B599)", () => {
  it.each([
    ["checking", "Checking the pull request", false],
    ["updating", "Finalizing against the latest platform", false],
    ["queued", "Merge queued", false],
    ["awaiting-release", "Waiting for governed release", false],
    ["deployed", "Deployed", false],
    ["escalated", "Needs your decision", true],
    ["closed", "Needs your decision", true],
  ] as const)("projects delivery state %s honestly", (deliveryStatus, label, needsYou) => {
    const delivery = {
      ...createBuildPrDeliveryState({
        repository: "o/r",
        prNumber: 42,
        prUrl: "https://github.com/o/r/pull/42",
      }),
      status: deliveryStatus,
      lastError: deliveryStatus === "escalated" ? "true-merge-conflict" : null,
    };
    const status = projectBuildStudioCustomerStatus({
      build: { ...build, phase: "ship" },
      capsule: {
        capsuleId: "WC-1",
        status: "working",
        workspaceState: writeBuildPrDeliveryState({}, delivery),
      },
    });
    expect(status.lifecyclePosition).toBe(label);
    expect(status.needsYou).toBe(needsYou);
  });

  it("derives a plain customer status from the linked capsule (blocked → automated work, needs you)", () => {
    const status = projectBuildStudioCustomerStatus({
      build,
      capsule: { capsuleId: "WC-1", status: "blocked" },
    });
    expect(status.whatIsBeingBuilt).toBe("Add a dark-mode toggle");
    expect(status.lifecyclePosition).toBe("Automated work in progress");
    expect(status.worker).toBe("Automated build in progress");
    expect(status.evidence).toContain("blocked on a system");
    expect(status.nextAction).toContain("clear the system or runtime blocker");
    expect(status.owner).toBe("Build Studio / operator");
    expect(status.needsYou).toBe(true);
  });

  it("maps an active capsule to plain in-progress language, no attention needed", () => {
    const status = projectBuildStudioCustomerStatus({
      build,
      capsule: { capsuleId: "WC-1", status: "working" },
    });
    expect(status.lifecyclePosition).toBe("In progress");
    expect(status.worker).toBe("Work in progress");
    expect(status.nextAction).toContain("continue implementation");
    expect(status.owner).toBe("Build Studio build agent");
    expect(status.needsYou).toBe(false);
  });

  it("maps a completed capsule to Done / Finished", () => {
    const status = projectBuildStudioCustomerStatus({
      build,
      capsule: { capsuleId: "WC-1", status: "complete" },
    });
    expect(status.lifecyclePosition).toBe("Done");
    expect(status.worker).toBe("Finished");
    expect(status.nextAction).toContain("review the completed work");
    expect(status.owner).toBe("reviewer");
    expect(status.needsYou).toBe(false);
  });

  it("maps a verifying capsule to checking-the-work", () => {
    const status = projectBuildStudioCustomerStatus({
      build,
      capsule: { capsuleId: "WC-1", status: "verifying" },
    });
    expect(status.lifecyclePosition).toBe("Checking the work");
    expect(status.worker).toBe("Reviewing the work");
  });

  it("falls back to a phase-only plain status when no capsule is linked", () => {
    const status = projectBuildStudioCustomerStatus({ build, capsule: null });
    expect(status.lifecyclePosition).toBe("Building it");
    expect(status.worker).toBe("Work in progress");
    expect(status.evidence).toBe("Build Studio phase is build.");
    expect(status.nextAction).toContain("continue implementation");
    expect(status.owner).toBe("Build Studio build agent");
    expect(status.needsYou).toBe(false);
  });

  it("surfaces needs-you on a failed phase-only build", () => {
    const status = projectBuildStudioCustomerStatus({
      build: { title: "x", phase: "failed", updatedAt: new Date("2026-07-20T00:00:00Z") },
      capsule: null,
    });
    expect(status.needsYou).toBe(true);
    expect(status.worker).toBe("Hit a problem");
    expect(status.nextAction).toContain("resolve the failure");
    expect(status.owner).toBe("Build Studio / operator");
  });

  it("is business-safe by construction — never leaks an executor name to the customer", () => {
    for (const status of ["working", "blocked", "verifying", "complete", "ready", "draft", "abandoned"]) {
      const out = projectBuildStudioCustomerStatus({ build, capsule: { capsuleId: "WC-1", status } });
      const combined = `${out.whatIsBeingBuilt} ${out.lifecyclePosition} ${out.worker}`;
      expect(combined).not.toMatch(/claude|codex|grok|opencode/i);
    }
  });

  describe("activity-freshness stall override (BI-46204009)", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const recent = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
    const stale = new Date(now.getTime() - STALLED_BUILD_REAP_MS - 60_000); // just past the threshold

    it("stays 'Working' (phase-only) when BuildActivity is recent", () => {
      const status = projectBuildStudioCustomerStatus({
        build: { title: "x", phase: "build", updatedAt: recent },
        capsule: null,
        activity: { lastActivityAt: recent, now },
      });
      expect(status.lifecyclePosition).toBe("Building it");
      expect(status.needsYou).toBe(false);
    });

    it("stays 'In progress' (capsule-active) when BuildActivity is recent", () => {
      const status = projectBuildStudioCustomerStatus({
        build: { title: "x", phase: "review", updatedAt: recent },
        capsule: { capsuleId: "WC-1", status: "working" },
        activity: { lastActivityAt: recent, now },
      });
      expect(status.lifecyclePosition).toBe("In progress");
      expect(status.needsYou).toBe(false);
    });

    it("flips to 'Stalled / needs attention' and routes to needs-you when BuildActivity is stale (phase-only path)", () => {
      const status = projectBuildStudioCustomerStatus({
        build: { title: "Backlog autopilot pipeline", phase: "build", updatedAt: stale },
        capsule: null,
        activity: { lastActivityAt: stale, now },
      });
      expect(status.lifecyclePosition).toBe("Stalled / needs attention");
      expect(status.needsYou).toBe(true);
      expect(status.evidence).toContain("No build activity since");
      expect(status.whatIsBeingBuilt).toBe("Backlog autopilot pipeline");
    });

    it("flips to stalled even with a linked capsule reporting 'working'", () => {
      const status = projectBuildStudioCustomerStatus({
        build: { title: "x", phase: "review", updatedAt: stale },
        capsule: { capsuleId: "WC-1", status: "working" },
        activity: { lastActivityAt: stale, now },
      });
      expect(status.lifecyclePosition).toBe("Stalled / needs attention");
      expect(status.needsYou).toBe(true);
    });

    it("falls back to build.updatedAt when there is no BuildActivity at all", () => {
      const status = projectBuildStudioCustomerStatus({
        build: { title: "x", phase: "build", updatedAt: stale },
        capsule: null,
        activity: { lastActivityAt: null, now },
      });
      expect(status.lifecyclePosition).toBe("Stalled / needs attention");
      expect(status.needsYou).toBe(true);
    });

    it("does not override a phase already outside build/review (e.g. ship)", () => {
      const status = projectBuildStudioCustomerStatus({
        build: { title: "x", phase: "ship", updatedAt: stale },
        capsule: null,
        activity: { lastActivityAt: stale, now },
      });
      expect(status.lifecyclePosition).not.toBe("Stalled / needs attention");
    });

    it("does not override a state already needs-you (e.g. failed phase-only)", () => {
      const status = projectBuildStudioCustomerStatus({
        build: { title: "x", phase: "failed", updatedAt: stale },
        capsule: null,
        activity: { lastActivityAt: stale, now },
      });
      expect(status.worker).toBe("Hit a problem");
      expect(status.needsYou).toBe(true);
    });

    it("skips the stall check entirely when no activity signal is supplied (back-compat)", () => {
      const status = projectBuildStudioCustomerStatus({
        build: { title: "x", phase: "build", updatedAt: stale },
        capsule: null,
      });
      expect(status.lifecyclePosition).toBe("Building it");
      expect(status.needsYou).toBe(false);
    });
  });
});

describe("reconcileBuildStudioCustomerStatus — canonical owner state", () => {
  const base = projectBuildStudioCustomerStatus({
    build,
    capsule: { capsuleId: "WC-1", status: "working" },
  });

  function progress(
    overrides: Partial<BuildProgressVisibility> = {},
  ): BuildProgressVisibility {
    return {
      buildId: "FB-OWNER",
      generatedAt: "2026-08-12T12:10:00.000Z",
      statusHeading: { operatorAction: "Monitor build progress", failureAxis: null },
      progress: {
        primary: { source: "db-task-results", completed: 0, total: 0, observedAt: null },
        conflicts: [],
      },
      tasks: {
        completedTasks: 0,
        totalTasks: 0,
        source: { source: "db-task-results", completed: 0, total: 0, observedAt: null },
        tasks: [],
      },
      staleChatSnapshots: [],
      sandbox: null,
      dispatchHistory: [],
      verification: null,
      quietAgent: {
        quiet: false,
        minutesQuiet: 0,
        lastObservableSignalAt: "2026-08-12T12:09:30.000Z",
      },
      inferenceFailure: { failed: false, kind: null, observedAt: null },
      phaseRuns: [],
      ...overrides,
    };
  }

  // BI-CE1AB982 — live repro FB-615DE356 on the Pet Rescue consumer install:
  // approve_start recorded, ideate_dispatch skipped for want of an eligible
  // engine, zero BuildDispatchAttempt rows — and the owner panel reported
  // "Build Studio is working on this change" for 30+ minutes.
  it("renders a refused-before-start dispatch as blocked, never as working", () => {
    const status = reconcileBuildStudioCustomerStatus({
      phase: "ideate",
      status: base,
      progress: progress({
        dispatchBlock: {
          blocked: true,
          reason: "Connect, provision, or wait for one allowed Build Studio engine, then retry.",
          observedAt: "2026-08-12T12:00:00.000Z",
        },
      }),
    });

    expect(status.ownerState).toBe("blocked");
    expect(status.needsYou).toBe(true);
    expect(status.worker).not.toMatch(/working on this change/i);
    expect(status.owner).toBe("platform administrator");
    expect(status.technicalEvidence).toContain("allowed Build Studio engine");
  });

  it("clears the refusal once a fresher dispatch proves the pipeline moved on", () => {
    // deriveDispatchBlock owns the self-clearing rule; an already-cleared signal
    // must not resurrect the blocked state here.
    const status = reconcileBuildStudioCustomerStatus({
      phase: "ideate",
      status: base,
      progress: progress({
        dispatchBlock: { blocked: false, reason: null, observedAt: null },
      }),
    });

    expect(status.ownerState).not.toBe("blocked");
  });

  // Corrects BI-CE1AB982's over-generalisation. ideate and plan never write
  // BuildDispatchAttempt rows, so "no dispatch rows" says nothing about them —
  // live repro FB-41EA43C5 reported "No research step has started" on a build
  // whose ideate had already produced, reviewed, repaired and passed a design.
  it("does not claim ideate has not started merely because it records no dispatch rows", () => {
    const status = reconcileBuildStudioCustomerStatus({
      phase: "ideate",
      status: base,
      progress: progress(),
    });

    expect(status.ownerState).not.toBe("not-started");
    expect(status.worker).not.toMatch(/no research step has started/i);
  });

  it("still reports not-started for build, which does record dispatch rows", () => {
    const status = reconcileBuildStudioCustomerStatus({
      phase: "build",
      status: base,
      progress: progress(),
    });

    expect(status.ownerState).toBe("not-started");
    expect(status.worker).toMatch(/no implementation task has started/i);
  });

  // The case the generalisation was reaching for is still covered — by the
  // durable refusal signal, not by inferring from absent rows.
  it("still renders a refused ideate dispatch as blocked", () => {
    const status = reconcileBuildStudioCustomerStatus({
      phase: "ideate",
      status: base,
      progress: progress({
        dispatchBlock: {
          blocked: true,
          reason: "Connect, provision, or wait for one allowed Build Studio engine, then retry.",
          observedAt: "2026-08-12T12:00:00.000Z",
        },
      }),
    });

    expect(status.ownerState).toBe("blocked");
  });

  it("shows a real in-flight dispatch with persisted elapsed time and a bounded expectation", () => {
    const status = reconcileBuildStudioCustomerStatus({
      phase: "build",
      status: base,
      progress: progress({
        dispatchHistory: [{
          id: "attempt-1",
          buildId: "FB-OWNER",
          taskTitle: "Build the owner state",
          specialist: "software-engineer",
          providerId: "chatgpt",
          model: "gpt-5.3-codex",
          attemptNumber: 1,
          startedAt: "2026-08-12T12:01:00.000Z",
          completedAt: null,
          durationMs: null,
          exitCode: null,
          success: false,
          failureAxis: "unknown",
          stdoutExcerpt: null,
          stderrExcerpt: null,
          rootCauseSummary: null,
          rootCauseHash: null,
        }],
      }),
    });

    expect(status.ownerState).toBe("working");
    expect(status.lifecyclePosition).toBe("Building the change");
    expect(status.elapsedLabel).toBe("Working for 9 minutes");
    expect(status.expectation).toMatch(/several minutes/i);
    expect(status.expectation).toMatch(/leave this page/i);
    expect(status.needsYou).toBe(false);
  });

  it("distinguishes provider capacity from generic work and preserves the retry action", () => {
    const status = reconcileBuildStudioCustomerStatus({
      phase: "ideate",
      status: base,
      progress: progress({
        inferenceFailure: {
          failed: true,
          kind: "provider-unavailable",
          observedAt: "2026-08-12T12:08:00.000Z",
        },
      }),
    });

    expect(status.ownerState).toBe("waiting-capacity");
    expect(status.lifecyclePosition).toBe("Waiting for AI capacity");
    expect(status.evidence).not.toMatch(/providerId|engine|dispatch/i);
    expect(status.nextAction).toMatch(/retry/i);
    expect(status.needsYou).toBe(true);
  });

  it("does not call a zero-task, never-dispatched build active execution", () => {
    const status = reconcileBuildStudioCustomerStatus({
      phase: "build",
      status: base,
      progress: progress(),
    });

    expect(status.ownerState).toBe("not-started");
    expect(status.lifecyclePosition).toBe("Preparing the build");
    expect(status.evidence).toMatch(/has not dispatched implementation work/i);
    expect(`${status.lifecyclePosition} ${status.worker} ${status.evidence}`).not.toMatch(/actively executing/i);
  });

  it("keeps an abandoned capsule terminal when the FeatureBuild phase and dispatch history are stale", () => {
    const status = reconcileBuildStudioCustomerStatus({
      phase: "build",
      status: {
        ...base,
        lifecyclePosition: "Stopped",
        worker: "Stopped",
        evidence: "Work capsule was abandoned.",
        nextAction: "restart the work only if the business priority still stands.",
        owner: "owner",
        needsYou: false,
      },
      progress: progress({
        dispatchHistory: [{
          id: "stale-attempt",
          buildId: "FB-OWNER",
          taskTitle: "Old work",
          specialist: "software-engineer",
          providerId: "chatgpt",
          model: "gpt-5.3-codex",
          attemptNumber: 1,
          startedAt: "2026-08-12T12:01:00.000Z",
          completedAt: null,
          durationMs: null,
          exitCode: null,
          success: false,
          failureAxis: "unknown",
          stdoutExcerpt: null,
          stderrExcerpt: null,
          rootCauseSummary: null,
          rootCauseHash: null,
        }],
      }),
    });

    expect(status.ownerState).toBe("failed");
    expect(status.lifecyclePosition).toBe("Stopped");
    expect(status.evidence).toBe("This work was stopped.");
    expect(status.evidence).not.toMatch(/capsule/i);
    expect(status.nextAction).toMatch(/restart the work/i);
    expect(status.worker).not.toMatch(/working/i);
  });

  it.each([
    ["config", "blocked", true],
    ["empty-response", "inconclusive", true],
  ] as const)("maps %s inference failure to %s", (kind, ownerState, needsYou) => {
    const status = reconcileBuildStudioCustomerStatus({
      phase: "plan",
      status: base,
      progress: progress({
        inferenceFailure: { failed: true, kind, observedAt: "2026-08-12T12:08:00.000Z" },
      }),
    });

    expect(status.ownerState).toBe(ownerState);
    expect(status.needsYou).toBe(needsYou);
  });
});

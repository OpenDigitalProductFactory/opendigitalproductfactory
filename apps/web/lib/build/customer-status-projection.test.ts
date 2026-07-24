import { describe, expect, it } from "vitest";

import { projectBuildStudioCustomerStatus } from "./customer-status-projection";
import { STALLED_BUILD_REAP_MS } from "./inert-build-reaper";

const build = { title: "Add a dark-mode toggle", phase: "build" as const, updatedAt: new Date("2026-07-20T00:00:00Z") };

describe("projectBuildStudioCustomerStatus (BI-BB13B599)", () => {
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

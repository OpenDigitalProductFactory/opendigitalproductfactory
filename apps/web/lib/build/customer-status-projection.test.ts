import { describe, expect, it } from "vitest";

import { projectBuildStudioCustomerStatus } from "./customer-status-projection";

const build = { title: "Add a dark-mode toggle", phase: "build" as const };

describe("projectBuildStudioCustomerStatus (BI-BB13B599)", () => {
  it("derives a plain customer status from the linked capsule (blocked → automated work, needs you)", () => {
    const status = projectBuildStudioCustomerStatus({
      build,
      capsule: { capsuleId: "WC-1", status: "blocked" },
    });
    expect(status.whatIsBeingBuilt).toBe("Add a dark-mode toggle");
    expect(status.lifecyclePosition).toBe("Automated work in progress");
    expect(status.worker).toBe("Automated build in progress");
    expect(status.needsYou).toBe(true);
  });

  it("maps an active capsule to plain in-progress language, no attention needed", () => {
    const status = projectBuildStudioCustomerStatus({
      build,
      capsule: { capsuleId: "WC-1", status: "working" },
    });
    expect(status.lifecyclePosition).toBe("In progress");
    expect(status.worker).toBe("Work in progress");
    expect(status.needsYou).toBe(false);
  });

  it("maps a completed capsule to Done / Finished", () => {
    const status = projectBuildStudioCustomerStatus({
      build,
      capsule: { capsuleId: "WC-1", status: "complete" },
    });
    expect(status.lifecyclePosition).toBe("Done");
    expect(status.worker).toBe("Finished");
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
    expect(status.needsYou).toBe(false);
  });

  it("surfaces needs-you on a failed phase-only build", () => {
    const status = projectBuildStudioCustomerStatus({
      build: { title: "x", phase: "failed" },
      capsule: null,
    });
    expect(status.needsYou).toBe(true);
    expect(status.worker).toBe("Hit a problem");
  });

  it("is business-safe by construction — never leaks an executor name to the customer", () => {
    for (const status of ["working", "blocked", "verifying", "complete", "ready", "draft", "abandoned"]) {
      const out = projectBuildStudioCustomerStatus({ build, capsule: { capsuleId: "WC-1", status } });
      const combined = `${out.whatIsBeingBuilt} ${out.lifecyclePosition} ${out.worker}`;
      expect(combined).not.toMatch(/claude|codex|grok|opencode/i);
    }
  });
});

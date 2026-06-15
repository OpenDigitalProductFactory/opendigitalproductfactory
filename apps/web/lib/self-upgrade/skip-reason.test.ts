import { describe, it, expect } from "vitest";
import { describeSkipReason } from "./skip-reason";

describe("describeSkipReason", () => {
  it("returns null for empty / missing reasons", () => {
    expect(describeSkipReason(null)).toBeNull();
    expect(describeSkipReason(undefined)).toBeNull();
    expect(describeSkipReason("")).toBeNull();
    expect(describeSkipReason("   ")).toBeNull();
  });

  it("explains activity-in-flight with a humanised, de-duplicated surface and an override remedy", () => {
    const e = describeSkipReason(
      "activity-in-flight: build-studio.phase.build, build-studio.phase.build",
    );
    expect(e).not.toBeNull();
    expect(e!.title).toBe("Work in progress");
    // Two identical build-studio surfaces collapse to one phrase, not "×2".
    expect(e!.detail).toContain("a Build Studio build phase");
    expect(e!.detail).not.toContain("build-studio.phase.build,");
    expect(e!.remedy).toContain("Emergency override");
  });

  it("joins multiple distinct activity surfaces readably", () => {
    const e = describeSkipReason(
      "activity-in-flight: build-studio.phase.build, coworker.reasoning-loop",
    );
    expect(e!.detail).toContain("a Build Studio build phase and an AI coworker working");
  });

  it("explains the cooldown backoff", () => {
    const e = describeSkipReason("cooldown: 2026-06-15T00:13:22.503Z");
    expect(e!.title).toBe("Cooling down");
    expect(e!.remedy).toContain("Emergency override");
  });

  it("distinguishes outside-window (scheduled-only gate) from a manual path", () => {
    const e = describeSkipReason("outside-window");
    expect(e!.title).toBe("Outside the upgrade window");
    expect(e!.remedy).toContain("Upgrade now");
  });

  it("explains promoter-unavailable and names the missing image", () => {
    const e = describeSkipReason("promoter-unavailable: dpf-promoter");
    expect(e!.title).toBe("Upgrade engine not ready");
    expect(e!.detail).toContain("dpf-promoter");
  });

  it("treats up-to-date as a correct no-op with no remedy", () => {
    const e = describeSkipReason("up-to-date: d9531b7eb836");
    expect(e!.title).toBe("Already up to date");
    expect(e!.detail).toContain("d9531b7eb836");
    expect(e!.remedy).toBeUndefined();
  });

  it("explains active-run, interval-not-elapsed, no-target, and disabled", () => {
    expect(describeSkipReason("active-run: SUR-ABC")!.title).toBe("Another run is active");
    expect(describeSkipReason("interval-not-elapsed")!.title).toBe("Checked recently");
    expect(describeSkipReason("no-target")!.title).toBe("No upgrade target");
    expect(describeSkipReason("disabled")!.title).toBe("Self-upgrade disabled");
  });

  it("falls back to surfacing the raw reason for an unknown key rather than a blank skip", () => {
    const e = describeSkipReason("some-future-reason: extra detail");
    expect(e!.title).toBe("Upgrade skipped");
    expect(e!.detail).toBe("some-future-reason: extra detail");
  });

  it("handles a bare key with no extra detail", () => {
    const e = describeSkipReason("up-to-date");
    expect(e!.title).toBe("Already up to date");
    expect(e!.detail).not.toContain("(");
  });
});

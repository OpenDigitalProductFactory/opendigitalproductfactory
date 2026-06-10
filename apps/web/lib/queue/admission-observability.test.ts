// apps/web/lib/queue/admission-observability.test.ts
import { describe, expect, it } from "vitest";
import { summarizeAdmission, buildAdmissionSnapshot } from "./admission-observability";

const line = (surface: string, count: number) => ({
  surface,
  label: surface,
  kind: "hard" as const,
  count,
  estimatedWaitMs: null,
});

describe("summarizeAdmission", () => {
  it("notes the cap and that nothing is holding when idle", () => {
    expect(summarizeAdmission(4, 0, 0)).toBe(
      "Build-pipeline lane capped at 4 concurrent; nothing holding capacity.",
    );
  });

  it("hints at the env var when the lane is uncapped", () => {
    expect(summarizeAdmission(null, 0, 0)).toContain("DPF_BUILD_PIPELINE_CONCURRENCY");
  });

  it("reports build phases and other surfaces holding capacity", () => {
    expect(summarizeAdmission(4, 2, 3)).toBe(
      "Build-pipeline lane capped at 4 concurrent; 2 build phases + 1 other surface holding capacity.",
    );
  });

  it("singularises a single build phase", () => {
    expect(summarizeAdmission(2, 1, 1)).toContain("1 build phase holding");
  });
});

describe("buildAdmissionSnapshot", () => {
  it("counts build-pipeline holders separately from the total", () => {
    const snap = buildAdmissionSnapshot(4, [
      line("build-studio.phase.plan", 1),
      line("build-studio.phase.build", 1),
      line("coworker.reasoning-loop", 2),
    ]);
    expect(snap.lane).toEqual({ enabled: true, limit: 4, key: "dpf-build-pipeline" });
    expect(snap.buildHolders).toBe(2);
    expect(snap.totalHolders).toBe(4);
    expect(snap.summary).toContain("2 build phases + 2 other surfaces");
  });

  it("reports lane disabled when limit is null", () => {
    const snap = buildAdmissionSnapshot(null, []);
    expect(snap.lane.enabled).toBe(false);
    expect(snap.buildHolders).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

describe("explore barrel export", () => {
  it("exports backlog utilities", async () => {
    const mod = await import("./backlog");
    expect(mod).toHaveProperty("EPIC_STATUSES");
    expect(mod).toHaveProperty("validateBacklogInput");
  });

  it("exports feature-build types", async () => {
    const mod = await import("./feature-build-types");
    expect(mod).toHaveProperty("VISIBLE_PHASES");
    // checkPhaseGate lives in the matrix; the barrel re-exports it from there.
    expect(await import("./build-process-matrix")).toHaveProperty("checkPhaseGate");
  });

  it("exports EA types", async () => {
    const mod = await import("./ea-types");
    expect(mod).toHaveProperty("layerFromNeoLabel");
    expect(mod).toHaveProperty("LAYER_COLOURS");
  });

  it("exports complexity assessment", async () => {
    const mod = await import("./complexity-assessment");
    expect(mod).toHaveProperty("assessComplexity");
  });
});

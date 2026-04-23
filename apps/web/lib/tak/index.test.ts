import { describe, expect, it } from "vitest";

describe("tak barrel export", () => {
  it("loads agent-action-types without runtime exports", async () => {
    const mod = await import("./agent-action-types");
    expect(Object.keys(mod)).toEqual([]);
  });

  it("exports agent-sensitivity", async () => {
    const mod = await import("./agent-sensitivity");
    expect(mod).toHaveProperty("getRouteSensitivity");
  });

  it("exports mcp-catalog-types", async () => {
    const mod = await import("./mcp-catalog-types");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it("exports task-classifier", async () => {
    const mod = await import("./task-classifier");
    expect(mod).toHaveProperty("classifyTask");
  });
});

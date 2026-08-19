import { describe, expect, it } from "vitest";

describe("integrate barrel export", () => {
  it("exports build pipeline", async () => {
    const mod = await import("./build-pipeline");
    expect(mod).toHaveProperty("getResumeStep");
    expect(mod).toHaveProperty("nextStep");
  });

  it("exports git utils", async () => {
    const mod = await import("./git-utils");
    expect(mod).toHaveProperty("inferCommitType");
    expect(mod).toHaveProperty("formatCommitMessage");
  });

  it("exports manifest generator", async () => {
    const mod = await import("./manifest-generator");
    expect(mod).toHaveProperty("parseDependencies");
  });

  it("exports codebase tools", async () => {
    const mod = await import("./codebase-tools");
    expect(mod).toHaveProperty("isPathAllowedSync");
  });
});

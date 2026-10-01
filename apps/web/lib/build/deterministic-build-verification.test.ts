// BI-BD483DF0 (live, 2026-09-25): FB-D671B016's QA reply was "Both the full-repo typecheck and
// test runs are in progress in the background", parsed as typecheckPassed=false
// at low confidence, and the build->review gate blocked a correct build.
import { describe, expect, it, vi } from "vitest";

import { resolveQaVerification, runDeterministicBuildVerification } from "./deterministic-build-verification";

const deps = (overrides: Partial<Parameters<typeof runDeterministicBuildVerification>[0]["deps"]> = {}) => ({
  containerId: "dpf-sandbox-1",
  workdir: "/workspace/.builds/FB-D671B016",
  baseRef: "client/abc",
  exec: vi.fn().mockResolvedValue("packages/db/src/seed-wiki-kernel.ts\npackages/db/src/seed-wiki-kernel.test.ts\n"),
  runTests: vi.fn().mockResolvedValue({ passed: true, typeCheckPassed: true, testOutput: "57 passed", typeCheckOutput: "", scope: "scoped", scopedTestsRun: 1 }),
  ...overrides,
});

describe("runDeterministicBuildVerification", () => {
  it("reads the changed files from git in the build's worktree and runs the scoped checks there", async () => {
    const d = deps();
    const result = await runDeterministicBuildVerification({ changedFiles: [], deps: d });

    expect(d.exec).toHaveBeenCalledWith("dpf-sandbox-1", expect.stringContaining("cd '/workspace/.builds/FB-D671B016'"));
    expect(d.exec).toHaveBeenCalledWith("dpf-sandbox-1", expect.stringContaining("git merge-base HEAD 'client/abc'"));
    expect(d.runTests).toHaveBeenCalledWith("dpf-sandbox-1", {
      changedFiles: ["packages/db/src/seed-wiki-kernel.ts", "packages/db/src/seed-wiki-kernel.test.ts"],
      workdir: "/workspace/.builds/FB-D671B016",
    });
    expect(result.verification).toEqual({
      typecheckPassed: true, testsPassed: 1, testsFailed: 0, parseConfidence: "high", source: "deterministic-scoped", scope: "scoped",
    });
  });

  it("records a real failure as a failure", async () => {
    const d = deps({ runTests: vi.fn().mockResolvedValue({ passed: false, typeCheckPassed: true, testOutput: "1 failed", typeCheckOutput: "", scope: "scoped" }) });
    const result = await runDeterministicBuildVerification({ changedFiles: ["a.ts"], deps: d });
    expect(d.exec).not.toHaveBeenCalled();
    expect(result.verification.testsFailed).toBe(1);
  });
});

describe("resolveQaVerification", () => {
  it("keeps a readable QA verdict and runs nothing", async () => {
    const run = vi.fn();
    const out = await resolveQaVerification({
      parsed: { typecheckPassed: true, testsPassed: 12, testsFailed: 0, parseConfidence: "high" },
      qaContent: "12 tests passed, typecheck passed", changedFiles: ["a.ts"], runDeterministic: run,
    });
    expect(run).not.toHaveBeenCalled();
    expect(out.verification.testsPassed).toBe(12);
  });

  it("replaces an unreadable verdict with the deterministic checks and their files", async () => {
    const run = vi.fn().mockResolvedValue({
      verification: { typecheckPassed: true, testsPassed: 1, testsFailed: 0, parseConfidence: "high", source: "deterministic-scoped", scope: "scoped" },
      changedFiles: ["packages/db/src/seed-wiki-kernel.ts"], output: "Deterministic scoped verification",
    });
    const out = await resolveQaVerification({
      parsed: { typecheckPassed: false, testsPassed: 0, testsFailed: 0, parseConfidence: "low" },
      qaContent: "Both runs are in progress in the background.", changedFiles: [], runDeterministic: run,
    });
    expect(run).toHaveBeenCalledWith([]);
    expect(out.verification).toMatchObject({ typecheckPassed: true, parseConfidence: "high", source: "deterministic-scoped" });
    expect(out.changedFiles).toEqual(["packages/db/src/seed-wiki-kernel.ts"]);
    expect(out.content).toContain("Deterministic scoped verification");
  });

  it("keeps the unreadable verdict when the deterministic run cannot happen", async () => {
    const out = await resolveQaVerification({
      parsed: { typecheckPassed: false, testsPassed: 0, testsFailed: 0, parseConfidence: "low" },
      qaContent: "?", changedFiles: [], runDeterministic: vi.fn().mockRejectedValue(new Error("sandbox down")),
    });
    expect(out.verification.parseConfidence).toBe("low");
  });
});

// BI-BD483DF0 (live, 2026-09-25): FB-D671B016's QA reply was "Both the full-repo typecheck and
// test runs are in progress in the background", parsed as typecheckPassed=false
// at low confidence, and the build->review gate blocked a correct build.
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listBuildChangedFiles, resolveQaVerification, runDeterministicBuildVerification } from "./deterministic-build-verification";

const deps = (overrides: Partial<Parameters<typeof runDeterministicBuildVerification>[0]["deps"]> = {}) => ({
  containerId: "dpf-sandbox-1",
  workdir: "/workspace/.builds/FB-D671B016",
  baseRef: "client/abc",
  exec: vi.fn().mockImplementation(async (_id, command) => command.startsWith("node -e ") ? "a".repeat(64) : "packages/db/src/seed-wiki-kernel.ts\npackages/db/src/seed-wiki-kernel.test.ts\n"),
  runTests: vi.fn().mockResolvedValue({ passed: true, typeCheckPassed: true, testOutput: "Tests 57 passed", typeCheckOutput: "", scope: "scoped", scopedTestsRun: 1,
    testsPassed: 57, testsFailed: 0, testsExecuted: true, testsApplicable: true, testCommandPassed: true, testSummariesComplete: true }),
  ...overrides,
});

describe("BI-57AF5162: observed execution and unresolved QA", () => {
  const noTests = (overrides = {}) => deps({
    exec: vi.fn().mockImplementation(async (_id, command) => command.startsWith("node -e ") ? "a".repeat(64) : ""),
    runTests: vi.fn().mockResolvedValue({
      passed: true, typeCheckPassed: true, scope: "none", scopedTestsRun: 0,
      testOutput: "No tests ran.", typeCheckOutput: "Typecheck clean.",
      testsExecuted: false, testsApplicable: false, testsPassed: 0, testsFailed: 0,
      ...overrides,
    }),
  });

  it("records zero executed passes for an established no-test exemption", async () => {
    const out = await runDeterministicBuildVerification({ changedFiles: [], deps: noTests() });
    expect(out.verification).toMatchObject({
      typecheckPassed: true, testsPassed: 0, testsFailed: 0, scope: "none",
      testsExecuted: false, testsApplicable: false, testsQualified: true,
    });
    expect(out.output).toContain("No tests ran.");
  });

  it("does not invent a failed test when only typecheck failed", async () => {
    const out = await runDeterministicBuildVerification({
      changedFiles: [], deps: noTests({ passed: false, typeCheckPassed: false }),
    });
    expect(out.verification).toMatchObject({ typecheckPassed: false, testsPassed: 0, testsFailed: 0 });
  });

  it("keeps the runner's observed case counts instead of converting a Boolean to one test", async () => {
    const out = await runDeterministicBuildVerification({
      changedFiles: ["apps/web/lib/example.test.ts"],
      deps: noTests({ passed: false, scope: "scoped", scopedTestsRun: 1,
        testsExecuted: true, testsApplicable: true, testCommandPassed: false, testSummariesComplete: true,
        testsPassed: 9, testsFailed: 2, testOutput: "9 passed, 2 failed" }),
    });
    expect(out.verification).toMatchObject({ testsPassed: 9, testsFailed: 2, testsExecuted: true });
  });

  it("preserves a reported failure and its full provenance when no test rerun resolves it", async () => {
    const qaContent = `99 passed and 3 failed. ${"retained QA detail ".repeat(300)}END-OF-ORIGINAL-QA`;
    const det = await runDeterministicBuildVerification({ changedFiles: [], deps: noTests() });
    const out = await resolveQaVerification({
      parsed: { typecheckPassed: true, testsPassed: 99, testsFailed: 3, parseConfidence: "high" },
      qaContent, changedFiles: [], runDeterministic: async () => det,
    });
    expect(out.verification.testsPassed).toBe(0);
    expect(out.verification).toMatchObject({
      testsQualified: false, testEvidenceConflict: true, parseConfidence: "low",
      reportedQa: { testsPassed: 99, testsFailed: 3, content: qaContent },
    });
  });

  it("does not qualify unknown applicability as a no-test exemption", async () => {
    const out = await runDeterministicBuildVerification({
      changedFiles: [], deps: noTests({ testsApplicable: null, passed: false }),
    });
    expect(out.verification).toMatchObject({
      testsPassed: 0, testsFailed: 0, testsApplicable: null,
      testsExecuted: false, testsQualified: false, parseConfidence: "low",
    });
  });

  it("retains an unidentified reported failure even when an unrelated scoped test passes", async () => {
    const det = await runDeterministicBuildVerification({ changedFiles: [], deps: deps() });
    const out = await resolveQaVerification({ parsed: { typecheckPassed: true, testsPassed: 99, testsFailed: 3, parseConfidence: "high" },
      qaContent: "99 passed and 3 failed; failing files unavailable", changedFiles: [], runDeterministic: async () => det });
    expect(out.verification).toMatchObject({ testsQualified: false, testEvidenceConflict: true });
  });

  it("retains prose-only failures even with a plausible complete summary and named rerun", async () => {
    const det = await runDeterministicBuildVerification({ changedFiles: [], deps: deps({
      runTests: vi.fn().mockResolvedValue({ passed: true, typeCheckPassed: true, testOutput: "Tests 57 passed", typeCheckOutput: "",
        scope: "scoped", testsPassed: 57, testsFailed: 0, testsExecuted: true, testsApplicable: true, testCommandPassed: true, testSummariesComplete: true,
        testCommands: ['cd /isolated/packages/db && { pnpm exec vitest run "src/seed-wiki-kernel.test.ts"; }'] }),
    }) });
    const out = await resolveQaVerification({ parsed: { typecheckPassed: true, testsPassed: 99, testsFailed: 3, parseConfidence: "high" },
      qaContent: "FAIL packages/db/src/seed-wiki-kernel.test.ts\nTest Files 1 failed (1)\nTests 3 failed (3)", changedFiles: [], runDeterministic: async () => det });
    expect(out.verification).toMatchObject({ testsQualified: false, testEvidenceConflict: true, reportedQa: { testsFailed: 3 } });
  });

  it("does not treat a partial list of named failing files as the whole report", async () => {
    const det = await runDeterministicBuildVerification({ changedFiles: [], deps: deps({
      runTests: vi.fn().mockResolvedValue({ passed: true, typeCheckPassed: true, testOutput: "Tests 2 passed", typeCheckOutput: "",
        scope: "scoped", testsPassed: 2, testsFailed: 0, testsExecuted: true, testsApplicable: true, testCommandPassed: true, testSummariesComplete: true,
        testCommands: ['cd /isolated/packages/db && { pnpm exec vitest run "src/seed-wiki-kernel.test.ts"; }'] }),
    }) });
    const out = await resolveQaVerification({ parsed: { typecheckPassed: true, testsPassed: 99, testsFailed: 3, parseConfidence: "high" },
      qaContent: "FAIL packages/db/src/seed-wiki-kernel.test.ts\nOther failure details unavailable\nTests 3 failed", changedFiles: [], runDeterministic: async () => det });
    expect(out.verification).toMatchObject({ testsQualified: false, testEvidenceConflict: true, reportedQa: { testsFailed: 3 } });
  });
});

describe("BI-57AF5162: isolated Git source discovery", () => {
  async function fixture(run: (root: string, git: (...args: string[]) => string) => Promise<void>) {
    const root = mkdtempSync(join(tmpdir(), "dpf-verification-scope-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git("init", "--quiet");
      git("config", "user.name", "Isolated Test Fixture");
      git("config", "user.email", "fixture@example.invalid");
      writeFileSync(join(root, "tracked.ts"), "baseline\n");
      git("add", "."); git("commit", "-qm", "fixture baseline");
      git("branch", "fixture-base");
      await run(root, git);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  const discoveryDeps = (root: string, baseRef = "fixture-base") => ({
    containerId: "no-container", workdir: root, baseRef,
    exec: async (_container: string, command: string) => execFileSync("sh", ["-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  });

  it("includes committed, staged, unstaged and untracked source in the isolated tree", async () => {
    await fixture(async (root, git) => {
      writeFileSync(join(root, "committed.ts"), "committed\n"); git("add", "."); git("commit", "-qm", "fixture change");
      writeFileSync(join(root, "staged.ts"), "staged\n"); git("add", "staged.ts");
      writeFileSync(join(root, "tracked.ts"), "unstaged\n");
      writeFileSync(join(root, "untracked.ts"), "untracked\n");
      expect((await listBuildChangedFiles(discoveryDeps(root))).sort()).toEqual([
        "committed.ts", "staged.ts", "tracked.ts", "untracked.ts",
      ]);
    });
  });

  it("does not qualify tests if intended WIP changes while the runner executes", async () => {
    await fixture(async (root) => {
      writeFileSync(join(root, "untracked.ts"), "before\n");
      const out = await runDeterministicBuildVerification({ changedFiles: [], deps: {
        ...discoveryDeps(root), runTests: async () => {
          writeFileSync(join(root, "untracked.ts"), "after\n");
          return { passed: true, typeCheckPassed: true, testOutput: "Tests 2 passed", typeCheckOutput: "",
            testsPassed: 2, testsFailed: 0, testsExecuted: true, testsApplicable: true, testCommandPassed: true, testSummariesComplete: true };
        },
      } });
      expect(out.verification).toMatchObject({ typecheckPassed: null, testsPassed: 2, testsQualified: false, verificationSource: { unchanged: false } });
    });
  });

  it("distinguishes an observed empty diff from an unreadable base", async () => {
    await fixture(async (root) => {
      expect(await listBuildChangedFiles(discoveryDeps(root))).toEqual([]);
      await expect(listBuildChangedFiles(discoveryDeps(root, "missing-fixture-base"))).rejects.toThrow();
    });
  });

  it("refuses unrelated source when the resolved workdir is on another build's branch", async () => {
    await fixture(async (root) => {
      await expect(listBuildChangedFiles({ ...discoveryDeps(root), expectedBranch: "build/OTHER" })).rejects.toThrow();
    });
  });
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
      changedFilesKnown: true,
    });
    expect(result.verification).toMatchObject({
      typecheckPassed: true, testsPassed: 57, testsFailed: 0, parseConfidence: "high", source: "deterministic-scoped", scope: "scoped",
      testsExecuted: true, testsQualified: true,
    });
  });

  it("records a real failure as a failure", async () => {
    const d = deps({ runTests: vi.fn().mockResolvedValue({ passed: false, typeCheckPassed: true, testOutput: "Tests 1 failed", typeCheckOutput: "", scope: "scoped",
      testsPassed: 0, testsFailed: 1, testsExecuted: true, testsApplicable: true, testCommandPassed: false, testSummariesComplete: true }) });
    const result = await runDeterministicBuildVerification({ changedFiles: ["a.ts"], deps: d });
    expect(d.exec).toHaveBeenCalled();
    expect(result.verification.testsFailed).toBe(1);
  });
});

describe("resolveQaVerification", () => {
  // BI-E0931D5C (live, 2026-10-08): FB-91774D92's QA reply was "`pnpm exec tsc --noEmit`
  // in `apps/web` finished with no errors". The parser's /tsc.*error/ matched the
  // negation and returned typecheckPassed=false at HIGH confidence, so no check ran
  // and the build->review gate held a clean build. Prose never decides the verdict.
  it("decides a readable QA verdict by the platform's own checks, not the prose", async () => {
    const run = vi.fn().mockResolvedValue({
      verification: { typecheckPassed: true, testsPassed: 1, testsFailed: 0, parseConfidence: "high", source: "deterministic-scoped", scope: "scoped" },
      changedFiles: ["apps/web/lib/routing/anthropic-cache.ts"], output: "Deterministic scoped verification",
    });
    const out = await resolveQaVerification({
      parsed: { typecheckPassed: false, testsPassed: 0, testsFailed: 0, parseConfidence: "high" },
      qaContent: "- **Typecheck:** `pnpm exec tsc --noEmit` in `apps/web` finished with no errors.",
      changedFiles: [], runDeterministic: run,
    });
    expect(run).toHaveBeenCalledWith([]);
    expect(out.verification).toMatchObject({ typecheckPassed: true, source: "deterministic-scoped" });
    expect(out.content).toContain("QA specialist reported (not an execution record):");
  });

  it("retains readable QA without promoting prose when the platform's checks cannot run", async () => {
    const out = await resolveQaVerification({
      parsed: { typecheckPassed: true, testsPassed: 12, testsFailed: 0, parseConfidence: "high" },
      qaContent: "12 tests passed, typecheck passed", changedFiles: ["a.ts"],
      runDeterministic: vi.fn().mockRejectedValue(new Error("sandbox down")),
    });
    expect(out.verification).toMatchObject({ typecheckPassed: null, testsPassed: 0, parseConfidence: "low",
      testsQualified: false, reportedQa: { testsPassed: 12, content: "12 tests passed, typecheck passed" } });
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

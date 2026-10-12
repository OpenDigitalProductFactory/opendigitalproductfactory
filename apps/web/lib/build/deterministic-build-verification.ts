// apps/web/lib/build/deterministic-build-verification.ts
//
// BI-BD483DF0: when the QA specialist's prose cannot be read as a verdict, run the checks.
// On 2026-09-25 FB-D671B016's QA task hit its 15-minute cap running the whole
// monorepo suite, its retry backgrounded the commands and replied "in progress",
// and parseQAVerification recorded typecheckPassed=false at low confidence. The
// build->review gate then blocked a build whose own tests (57/57) and typecheck
// passed. An unread verdict is not a failing one: the platform runs the scoped
// checks itself, in the build's own worktree, and records what it observed.

import type { SandboxTestResult } from "./coding-agent";

export type DeterministicVerification = {
  typecheckPassed: boolean;
  testsPassed: number;
  testsFailed: number;
  parseConfidence: "high";
  source: "deterministic-scoped";
  /** "none": no test file covers the changed files, so only the typecheck ran (BI-CEE688D6). */
  scope: "scoped" | "full" | "none";
};

export type DeterministicVerificationDeps = {
  containerId: string;
  workdir: string;
  baseRef: string;
  exec: (containerId: string, command: string) => Promise<string>;
  runTests: (containerId: string, opts: { changedFiles: string[]; workdir: string }) => Promise<SandboxTestResult>;
};

/** Files the build changed relative to the branch it was cut from, read from git in its worktree. */
export async function listBuildChangedFiles(deps: Pick<DeterministicVerificationDeps, "containerId" | "workdir" | "baseRef" | "exec">): Promise<string[]> {
  const out = await deps.exec(
    deps.containerId,
    `cd '${deps.workdir}' && git diff --name-only "$(git merge-base HEAD '${deps.baseRef}')" HEAD 2>/dev/null || true`,
  );
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function runDeterministicBuildVerification(input: {
  changedFiles: string[];
  deps: DeterministicVerificationDeps;
}): Promise<{ verification: DeterministicVerification; changedFiles: string[]; output: string }> {
  const changedFiles = input.changedFiles.length > 0 ? input.changedFiles : await listBuildChangedFiles(input.deps);
  const result = await input.deps.runTests(input.deps.containerId, { changedFiles, workdir: input.deps.workdir });
  return {
    verification: {
      typecheckPassed: result.typeCheckPassed,
      testsPassed: result.passed ? 1 : 0,
      testsFailed: result.passed ? 0 : 1,
      parseConfidence: "high",
      source: "deterministic-scoped",
      scope: result.scope ?? "full",
    },
    changedFiles,
    output: [
      `Deterministic scoped verification (${result.scope ?? "full"}${result.scopedTestsRun ? `, ${result.scopedTestsRun} test file(s)` : ""}) in ${input.deps.workdir}.`,
      `Typecheck: ${result.typeCheckPassed ? "passed" : "failed"}. Tests: ${result.passed ? "passed" : "failed"}.`,
      result.testOutput.slice(-1500),
    ].join("\n"),
  };
}

/** Production wiring: the build's worktree, its client branch, the real sandbox exec and test runner. */
export async function runDeterministicBuildVerificationFor(buildId: string, changedFiles: string[]) {
  const [{ execInSandbox }, { runSandboxTests }, { resolveBuildWorkdir, getClientIdentity }] = await Promise.all([
    import("@/lib/sandbox"),
    import("./coding-agent"),
    import("./sandbox/build-branch"),
  ]);
  const { clientBranch } = await getClientIdentity();
  return runDeterministicBuildVerification({
    changedFiles,
    deps: {
      containerId: process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1",
      workdir: resolveBuildWorkdir(buildId),
      baseRef: clientBranch,
      exec: execInSandbox,
      runTests: runSandboxTests,
    },
  });
}

type ParsedQa = { typecheckPassed: boolean; testsPassed: number; testsFailed: number; parseConfidence: "high" | "low" };

/**
 * The gate verdict comes from checks the platform actually ran in the build's
 * worktree. The QA specialist's prose is kept for the record and used only when
 * those checks cannot run; an unreadable prose verdict then stands at low
 * confidence, so the gate still refuses to advance on it. A "readable" prose
 * verdict is not evidence: FB-91774D92's "tsc finished with no errors" parsed as a
 * typecheck failure at high confidence (BI-E0931D5C).
 */
export async function resolveQaVerification(input: {
  parsed: ParsedQa;
  qaContent: string;
  changedFiles: string[];
  runDeterministic: (changedFiles: string[]) => Promise<{ verification: DeterministicVerification; changedFiles: string[]; output: string }>;
}): Promise<{ verification: ParsedQa & Partial<Pick<DeterministicVerification, "source" | "scope">>; changedFiles: string[]; content: string }> {
  try {
    const det = await input.runDeterministic(input.changedFiles);
    return { verification: det.verification, changedFiles: det.changedFiles, content: `${det.output}\n\nQA specialist said: ${input.qaContent.slice(0, 500)}` };
  } catch (err) {
    console.warn("[deterministic-verification] could not run scoped checks:", (err as Error)?.message);
    return { verification: input.parsed, changedFiles: input.changedFiles, content: input.qaContent };
  }
}

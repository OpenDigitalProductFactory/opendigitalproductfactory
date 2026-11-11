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
import { verificationFromSandboxResult, type TestExecutionFacts } from "./verification-output";
import { shellQuote } from "../platform/platform-dev-config-core";

export type DeterministicVerification = Omit<ReturnType<typeof verificationFromSandboxResult>, "typecheckPassed"> & { typecheckPassed: boolean | null } & TestExecutionFacts;

export type DeterministicVerificationDeps = {
  containerId: string;
  workdir: string;
  baseRef: string;
  expectedBranch?: string;
  exec: (containerId: string, command: string) => Promise<string>;
  runTests: (containerId: string, opts: { changedFiles: string[]; workdir: string; changedFilesKnown?: boolean }) => Promise<SandboxTestResult>;
};

/** Files the build changed relative to the branch it was cut from, read from git in its worktree. */
export async function listBuildChangedFiles(deps: Pick<DeterministicVerificationDeps, "containerId" | "workdir" | "baseRef" | "exec" | "expectedBranch">): Promise<string[]> {
  const out = await deps.exec(
    deps.containerId,
    `set -e; cd ${shellQuote(deps.workdir)}; `
      + (deps.expectedBranch ? `test "$(git branch --show-current)" = ${shellQuote(deps.expectedBranch)}; ` : "")
      + `base=$(git merge-base HEAD ${shellQuote(deps.baseRef)}); git diff --name-only -z "$base"; git ls-files --others --exclude-standard -z`,
  );
  return [...new Set(out.split(out.includes("\0") ? "\0" : "\n").filter(Boolean))];
}

/** Read-only identity of HEAD and intended committed/WIP bytes; never stages or commits. */
async function readVerificationSource(deps: DeterministicVerificationDeps): Promise<string | null> {
  const script = `const {execFileSync}=require('node:child_process');
const {lstatSync,readFileSync,readlinkSync}=require('node:fs');
const {createHash}=require('node:crypto');
process.chdir(${JSON.stringify(deps.workdir)});
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
${deps.expectedBranch ? `if(git('branch','--show-current').trim()!==${JSON.stringify(deps.expectedBranch)})throw Error('Unexpected build branch');` : ""}
const base=git('merge-base','HEAD',${JSON.stringify(deps.baseRef)}).trim();
const paths=[...new Set((git('diff','--name-only','-z',base)+git('ls-files','--others','--exclude-standard','-z')).split('\\0').filter(Boolean))].sort();
const hash=createHash('sha256').update(git('rev-parse','HEAD')).update(base);
for(const path of paths){hash.update(JSON.stringify(path));try{const stat=lstatSync(path);hash.update(String(stat.mode));hash.update(stat.isSymbolicLink()?readlinkSync(path):readFileSync(path));}catch(error){if(error.code!=='ENOENT')throw error;hash.update('deleted');}}
process.stdout.write(hash.digest('hex'));`;
  try {
    const digest = (await deps.exec(deps.containerId, `node -e ${shellQuote(script)}`)).trim();
    return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
  } catch { return null; }
}

export async function runDeterministicBuildVerification(input: {
  changedFiles: string[];
  deps: DeterministicVerificationDeps;
}): Promise<{ verification: DeterministicVerification; changedFiles: string[]; output: string; result: SandboxTestResult }> {
  const before = await readVerificationSource(input.deps);
  const changedFiles = await listBuildChangedFiles(input.deps);
  const result = await input.deps.runTests(input.deps.containerId, { changedFiles, workdir: input.deps.workdir, changedFilesKnown: true });
  const after = await readVerificationSource(input.deps);
  const unchanged = before !== null && before === after;
  const verification = { ...verificationFromSandboxResult(result),
    typecheckPassed: unchanged ? result.typeCheckPassed : null,
    verificationSource: { workdir: input.deps.workdir, baseRef: input.deps.baseRef, digest: before, unchanged, checkedAt: new Date().toISOString() },
    ...(!unchanged ? { testsQualified: false, parseConfidence: "low" as const } : {}),
  };
  return {
    result,
    verification,
    changedFiles,
    output: [
      `Deterministic scoped verification (${result.scope ?? "full"}${result.scopedTestsRun ? `, ${result.scopedTestsRun} test file(s)` : ""}) in ${input.deps.workdir}.`,
      `Typecheck: ${result.typeCheckPassed ? "passed" : "not passed"}. Observed tests: ${verification.testsPassed} passed, ${verification.testsFailed} failed; ${verification.testsExecuted ? "executed" : "no executed tests observed"}.`,
      result.testOutput.slice(-1500),
      ...(!unchanged ? ["Current source could not be bound to these checks; execution counts are retained without qualification."] : []),
    ].join("\n"),
  };
}

/** Production wiring: the build's worktree, its client branch, the real sandbox exec and test runner. */
export async function runDeterministicBuildVerificationFor(buildId: string, changedFiles: string[], containerId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1") {
  const [{ execInSandbox }, { runSandboxTests }, { resolveBuildWorkdir, getClientIdentity }] = await Promise.all([
    import("@/lib/sandbox"),
    import("./coding-agent"),
    import("./sandbox/build-branch"),
  ]);
  const { clientBranch } = await getClientIdentity();
  return runDeterministicBuildVerification({
    changedFiles,
    deps: {
      containerId,
      workdir: resolveBuildWorkdir(buildId),
      baseRef: clientBranch,
      expectedBranch: `build/${buildId}`,
      exec: execInSandbox,
      runTests: runSandboxTests,
    },
  });
}

type ParsedQa = { typecheckPassed: boolean; testsPassed: number; testsFailed: number; parseConfidence: "high" | "low" };

/**
 * The gate verdict comes from checks the platform actually ran in the build's
 * worktree. The QA specialist's full report is retained independently. A
 * failed or unavailable execution never turns that report into execution. A "readable" prose
 * verdict is not evidence: FB-91774D92's "tsc finished with no errors" parsed as a
 * typecheck failure at high confidence (BI-E0931D5C).
 */
export async function resolveQaVerification(input: {
  parsed: ParsedQa;
  qaContent: string;
  changedFiles: string[];
  runDeterministic: (changedFiles: string[]) => Promise<{ verification: DeterministicVerification; changedFiles: string[]; output: string }>;
}): Promise<{ verification: Omit<ParsedQa, "typecheckPassed"> & { typecheckPassed: boolean | null } & TestExecutionFacts & Partial<Pick<DeterministicVerification, "source" | "scope">>; changedFiles: string[]; content: string }> {
  const reportedQa = { testsPassed: input.parsed.testsPassed, testsFailed: input.parsed.testsFailed, content: input.qaContent };
  try {
    const det = await input.runDeterministic(input.changedFiles);
    // A scoped execution is required to resolve a reported failure. An exemption
    // does not establish which source or tests produced the earlier report.
    // Only named failure files actually rerun on unchanged source can resolve
    // the earlier report. Unknown failure identity cannot be cleared by an
    // unrelated green scoped run. Report text selects scope; it never supplies
    // passing counts or the command verdict.
    const failedFiles = [...input.qaContent.matchAll(/(?:^|\n)\s*FAIL\s+((?:apps|packages)\/[^\s]+\.(?:test|spec)\.[tj]sx?)(?=\s|$)/g)].map((match) => match[1]!);
    const rerunCoversReport = failedFiles.length > 0 && det.verification.testsQualified === true
      && det.verification.verificationSource?.unchanged === true
      && failedFiles.every((file) => (det.verification.testCommands ?? []).some((command) => {
        const segments = file.split('/'); const pkg = segments.slice(0, 2).join('/'); const relative = segments.slice(2).join('/');
        return command.includes(`/${pkg} &&`) && command.includes(`"${relative}"`);
      }));
    const testEvidenceConflict = input.parsed.testsFailed > 0 && !rerunCoversReport;
    return { verification: { ...det.verification, reportedQa, testEvidenceConflict,
      ...(testEvidenceConflict ? { testsQualified: false, parseConfidence: "low" as const } : {}) },
      changedFiles: det.changedFiles, content: `${det.output}\n\nQA specialist reported (not an execution record): ${input.qaContent.slice(0, 500)}` };
  } catch (err) {
    console.warn("[deterministic-verification] could not run scoped checks:", (err as Error)?.message);
    return { verification: { typecheckPassed: null, testsPassed: 0, testsFailed: 0,
      parseConfidence: "low", testsExecuted: false, testsApplicable: null, testsQualified: false,
      testEvidenceConflict: input.parsed.testsFailed > 0, reportedQa },
      changedFiles: input.changedFiles, content: `Deterministic verification unavailable: ${(err as Error)?.message}\nQA report is retained but is not executed verification.\n${input.qaContent}` };
  }
}

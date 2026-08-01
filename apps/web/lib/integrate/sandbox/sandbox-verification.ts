// Sandbox verification gate: runs `pnpm --filter web typecheck` and
// `pnpm --filter web build` inside the build's sandbox container, returns
// structured pass/fail + truncated output tails.
//
// Used in two places:
//   1. build-orchestrator.ts — per-task gate. If a specialist reports DONE
//      but the sandbox is red, override the task outcome to BLOCKED so the
//      next iteration sees the failure instead of silently proceeding.
//   2. build-review-verification.ts — pre-ship gate. Persist results on
//      FeatureBuild.sandboxVerification so checkPhaseGate can block the
//      review → ship transition when either check is red.

import { execInSandbox } from "./sandbox";

export type SandboxCheckName = "typecheck" | "build";

export type SandboxCheckResult = {
  name: SandboxCheckName;
  command: string;
  passed: boolean;
  exitCode: number | null;
  stdoutTail: string;
  durationMs: number;
  skipped?: boolean;
};

export type SandboxGateResult = {
  typecheck: SandboxCheckResult;
  build: SandboxCheckResult;
  allPassed: boolean;
  ranAt: string;
};

// Default working dir when a build is not running in its own worktree.
const VERIFY_WORKSPACE_DEFAULT = "/workspace";

// Typecheck/build gate commands for a build's working directory: the build's own
// worktree when isolation is on, else /workspace (default — byte-identical to the
// prior string constants). BI-98B723C0 Phase 2c.
export function sandboxTypecheckCommand(workdir: string = VERIFY_WORKSPACE_DEFAULT): string {
  return `cd ${workdir} && NODE_OPTIONS=--max-old-space-size=16384 pnpm --filter web typecheck 2>&1`;
}
// The sandbox container ships with NODE_ENV=development so the in-container Next
// dev server behaves like local dev. Production builds must NOT inherit that:
// Next.js emits a "non-standard NODE_ENV" warning and then crashes prerendering
// `/_global-error` with `Cannot read properties of null (reading 'useContext')`
// when client-component code is run through the dev-mode React runtime during
// the prerender pass. Force NODE_ENV=production for the build gate only — the
// dev-server launch in sandbox.ts is unaffected.
export function sandboxBuildCommand(workdir: string = VERIFY_WORKSPACE_DEFAULT): string {
  return `cd ${workdir} && NODE_ENV=production NODE_OPTIONS=--max-old-space-size=16384 pnpm --filter web build 2>&1`;
}
// Back-compat string constants (default /workspace) for non-per-build callers.
export const SANDBOX_TYPECHECK_COMMAND = sandboxTypecheckCommand();
export const SANDBOX_BUILD_COMMAND = sandboxBuildCommand();

const OUTPUT_TAIL_LIMIT = 15_000;

export function truncateOutput(raw: string, limit: number = OUTPUT_TAIL_LIMIT): string {
  if (raw.length <= limit) return raw;
  const errorLines = raw
    .split("\n")
    .filter((l) =>
      /error\s+TS\d|ERROR|FAIL|Error:|Cannot find|not assignable|does not exist|Module.*not found/i.test(
        l,
      ),
    );
  if (errorLines.length > 0 && errorLines.length < 200) {
    const errorSummary = errorLines.join("\n");
    if (errorSummary.length <= limit) {
      return `[${raw.split("\n").length} total lines, showing ${errorLines.length} error lines]\n${errorSummary}`;
    }
  }
  return `[output truncated — last ${limit} chars of ${raw.length}]\n...${raw.slice(-limit)}`;
}

type ExecImpl = (containerId: string, command: string) => Promise<string>;

async function runCheck(
  containerId: string,
  name: SandboxCheckName,
  command: string,
  impl: ExecImpl,
): Promise<SandboxCheckResult> {
  const start = Date.now();
  try {
    const output = await impl(containerId, command);
    return {
      name,
      command,
      passed: true,
      exitCode: 0,
      stdoutTail: truncateOutput(output),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    const raw = (e.stdout ?? "") + (e.stderr ?? "");
    const output = raw || e.message || "Command failed with no output.";
    return {
      name,
      command,
      passed: false,
      exitCode: typeof e.code === "number" ? e.code : null,
      stdoutTail: truncateOutput(output),
      durationMs: Date.now() - start,
    };
  }
}

// Typecheck runs first. If typecheck fails, build is short-circuited: the TS
// error would cascade into the build anyway, and build is the slower command.
// The caller still sees both results (build marked skipped) so persistence
// and UI remain uniform.
export async function runSandboxTypecheckBuildGate(
  containerId: string,
  exec: ExecImpl = execInSandbox,
  workdir: string = VERIFY_WORKSPACE_DEFAULT,
): Promise<SandboxGateResult> {
  const ranAt = new Date().toISOString();
  const typecheckCommand = sandboxTypecheckCommand(workdir);
  const buildCommand = sandboxBuildCommand(workdir);
  const typecheck = await runCheck(containerId, "typecheck", typecheckCommand, exec);
  const build: SandboxCheckResult = typecheck.passed
    ? await runCheck(containerId, "build", buildCommand, exec)
    : {
        name: "build",
        command: buildCommand,
        passed: false,
        exitCode: null,
        stdoutTail: "Build skipped — typecheck failed. Fix typecheck errors first.",
        durationMs: 0,
        skipped: true,
      };
  return {
    typecheck,
    build,
    allPassed: typecheck.passed && build.passed,
    ranAt,
  };
}

// Format a human-readable summary for embedding into specialist task context
// when the gate fails. Kept short so it doesn't blow up the next LLM call's
// context window.
export function formatGateFailureForContext(gate: SandboxGateResult): string {
  const lines: string[] = [];
  lines.push("SANDBOX VERIFICATION GATE FAILED — the task's diff produced a red sandbox.");
  lines.push("");
  if (!gate.typecheck.passed) {
    lines.push(`TYPECHECK FAILED (exit ${gate.typecheck.exitCode ?? "?"}):`);
    lines.push(gate.typecheck.stdoutTail);
  }
  if (!gate.build.passed && !gate.build.skipped) {
    lines.push("");
    lines.push(`BUILD FAILED (exit ${gate.build.exitCode ?? "?"}):`);
    lines.push(gate.build.stdoutTail);
  }
  return lines.join("\n");
}

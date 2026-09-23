#!/usr/bin/env node
// Invoke the workspace's TypeScript compiler with an enlarged V8 old-space heap
// so `tsc --noEmit` does not abort (Abort trap: 6 / OOM) on macOS under Node
// 26.x's default heap ceiling (BI-CD7706B5). This is the narrowest complete fix:
// baking it into the package `typecheck` script means the pre-commit hook, the
// pregate/local-ci-runner, and a manual `pnpm --filter web typecheck` all inherit
// it. Chosen over an inline `NODE_OPTIONS=` prefix (breaks Windows cmd.exe) and
// over `cross-env` (a new dependency): this resolves `tsc` via Node's own module
// resolution, so it is agnostic to how pnpm hoists `typescript`, and forwards any
// extra args (e.g. `--noEmit`, `-p tsconfig.scripts.json`) straight through.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve relative to the caller's cwd (the package dir) so the workspace's
// pinned TypeScript is found whether it is hoisted to the worktree root or
// linked locally.
const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const tscEntry = requireFromCwd.resolve("typescript/bin/tsc");

const result = spawnSync(
  process.execPath,
  ["--max-old-space-size=8192", tscEntry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`[run-tsc] failed to launch tsc: ${result.error.message}`);
  process.exit(1);
}

// BI-27D3DCCD: a compiler the OS killed did not reach a verdict about anyone's
// code, and must not be reported as one.
//
// `spawnSync` sets `status: null` and names the signal when the child is
// terminated. Collapsing that to `exit 1` produced the worst possible output:
// both typecheck programs printed success, the stage exited 1 with zero
// diagnostics in 36 seconds, and the gate failed a branch containing no
// TypeScript at all. The only clue was an exit code that reads as "your types
// are broken".
//
// 88 is this stage's own code for "I ran and reached no verdict". It is NOT 86:
// that is already EXIT_VITEST_RUNNER_TERMINATION, and reusing it would make a
// killed compiler indistinguishable from a terminated test runner — trading one
// ambiguity for another.
// Not exported: this file runs tsc on import, so nothing may import it. The
// runner carries the same number with a comment pointing back here.
const TSC_TERMINATED_EXIT_CODE = 88;

if (result.signal || result.status === null) {
  console.error(
    `[run-tsc] tsc was terminated by ${result.signal ?? "an unknown signal"} before it could report. `
      + "This is NOT a verdict on the code: nothing was compiled to completion. "
      + "The usual cause is the host or container reclaiming memory from the compiler.",
  );
  process.exit(TSC_TERMINATED_EXIT_CODE);
}
process.exit(result.status);

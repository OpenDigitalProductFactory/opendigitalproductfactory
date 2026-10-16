#!/usr/bin/env node
// The one way DPF type-checks. Every package `typecheck` script, the pre-commit
// hook, the pregate/local-ci-runner and CI reach the compiler through this file,
// and forward their args (e.g. `--noEmit`, `-p tsconfig.scripts.json`) straight
// through.
//
// The compiler is TypeScript 7, the Go-native checker (BI-2B8D67A9). `DPF_TSC=6`
// runs the workspace's TypeScript 6 instead, as the parity reference; that path
// keeps the enlarged V8 heap TS6 needs for apps/web (BI-CD7706B5). Selection and
// resolution live in scripts/lib/tsc-compiler.mjs, because this file runs tsc on
// import and so cannot be imported by a test.
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolveTs6Entry, resolveTs7Exe, selectTscCompiler } from "./lib/tsc-compiler.mjs";

let compiler;
try {
  compiler = await selectTscCompiler({
    env: process.env,
    cwd: process.cwd(),
    execPath: process.execPath,
    forwardedArgs: process.argv.slice(2),
    resolveTs6Entry,
    resolveTs7Exe,
  });
} catch (error) {
  console.error(`[run-tsc] cannot select a compiler: ${error.message}`);
  process.exit(1);
}
console.error(`[run-tsc] checking with TypeScript ${compiler.version}`);

// Plan 2026-09-08 M11 step 4: with DPF_TSC_PROGRAM_REPORT=<file>, the same
// compile also records what it checked (`--listFiles --extendedDiagnostics`)
// into <file>, for scripts/sbom/check-typecheck-baseline.mjs. CI's Typecheck
// job sets it so the ratchet costs no second compile. The file list is kept
// out of the log; every other line (diagnostics, errors) passes through.
// Parsing and judging stay in the checker: this file only records.
const programReportPath = process.env.DPF_TSC_PROGRAM_REPORT;
const result = programReportPath
  ? await runWithProgramReport(programReportPath)
  : spawnSync(compiler.command, compiler.args, { stdio: "inherit" });

async function runWithProgramReport(reportPath) {
  const child = spawn(compiler.command, [...compiler.args, "--listFiles", "--extendedDiagnostics"], {
    stdio: ["inherit", "pipe", "inherit"],
  });
  const files = [];
  const output = [];
  // tsc prints each program file as a bare absolute path on its own line.
  const listedFile = /^(?:\/|[A-Za-z]:[\\/]).+\.(?:[cm]?[jt]sx?|json)$/;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (listedFile.test(line)) {
      files.push(line);
      return;
    }
    output.push(line);
    process.stdout.write(`${line}\n`);
  });
  const [status, signal, error] = await new Promise((settle) => {
    child.on("error", (err) => settle([null, null, err]));
    child.on("close", (code, sig) => settle([code, sig, undefined]));
  });
  if (!error && !signal && status !== null) {
    writeFileSync(
      reportPath,
      `${JSON.stringify({ schema: 1, compilerVersion: compiler.version, cwd: process.cwd(), args: process.argv.slice(2), exitCode: status, files, output }, null, 2)}\n`,
    );
    process.stdout.write(`[run-tsc] program report (${files.length} files) written to ${reportPath}\n`);
  }
  return { status, signal, error };
}

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

#!/usr/bin/env node
import { gitTextOrNull } from "./lib/git.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createObservedProcessRunner } from "./lib/local-ci-process-observer.mjs";
import {
  classifyPriorStage,
  createStageReceiptWriter,
  markStageReceiptReused,
  readStageReceipt,
  reusablePassedStage,
} from "./lib/local-ci-stage-receipt.mjs";

function resolveGit(ref) {
  return gitTextOrNull(["rev-parse", "--verify", ref], { cwd: process.cwd() });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The exit code scripts/run-tsc.mjs uses when the compiler itself was killed by
 * a signal, and this stage's own code for reaching no verdict (BI-27D3DCCD).
 *
 * Deliberately NOT 86. That is already EXIT_VITEST_RUNNER_TERMINATION in
 * sandbox-freshness.mjs, and both runners are commands in the same integration
 * plan — so reusing it would make a killed compiler indistinguishable from a
 * terminated test runner, and any rule written for one would silently move the
 * other. One number, one meaning.
 */
export const TSC_TERMINATED_EXIT_CODE = 88;

/**
 * A real tsc failure names at least one diagnostic, and every diagnostic
 * carries its code. Matching the code rather than the phrase "error TS" keeps
 * this working whatever tsc puts around it (`--pretty`, a summary line, a
 * localized prefix).
 */
const TS_DIAGNOSTIC = /\bTS\d{4,5}\b/;

export function classifyTypecheckResult(result) {
  if (result.status === 0) return "passed";
  if (result.error || result.status === null || result.status === -1 || result.status === 4294967295) {
    return "runner-termination";
  }
  // BI-27D3DCCD: the inner compiler was killed. Both typecheck programs can
  // print success and the stage still exit non-zero, because pnpm propagates
  // run-tsc's code. Without this the stage said "failed" about code it never
  // finished reading.
  if (result.status === TSC_TERMINATED_EXIT_CODE) return "runner-termination";
  // A tsc run that failed without emitting a single diagnostic did not grade
  // anything: zero errors and a non-zero exit cannot both be true of a real
  // compile. Treat it as infrastructure rather than as a verdict, so it is
  // re-run instead of being reported as the author's defect. `outputTail` is
  // captured by the observer; when there is none to read, fall back to the
  // honest "failed" rather than excusing a failure on no evidence.
  if (typeof result.outputTail === "string"
    && result.outputTail.length > 0
    && !TS_DIAGNOSTIC.test(result.outputTail)) {
    return "failed-without-diagnostics";
  }
  return "failed";
}

/** Classifications that say "this stage reached no verdict", not "your code is wrong". */
export function isInconclusiveTypecheck(classification) {
  return classification === "runner-termination" || classification === "failed-without-diagnostics";
}

export async function runTypecheckStage({
  receiptPath,
  resolveGitImpl = resolveGit,
  isProcessAlive = processAlive,
  runObservedProcess,
} = {}) {
  const identity = {
    integrationTreeSha: resolveGitImpl("HEAD^{tree}"),
    // BOTH web TypeScript programs. The M11 split (BI-0A3B155F) moved
    // *.test.ts(x) out of `typecheck` into `typecheck:tests`, which silently
    // took test files out of this gate: PR #5285 passed the local gate and
    // then failed CI on three test-only type errors. `typecheck:all` runs the
    // production program and the test program, so the gate sees what CI sees.
    command: "pnpm --filter web typecheck:all",
    nodeOptions: process.env.NODE_OPTIONS ?? "",
  };
  const priorReceipt = readStageReceipt(receiptPath);
  if (reusablePassedStage({ receipt: priorReceipt, stage: "web-typecheck", identity })) {
    markStageReceiptReused({ path: receiptPath, receipt: priorReceipt });
    process.stdout.write(`[local-ci-typecheck] reusing exact-tree passed receipt ${receiptPath}\n`);
    return { status: 0, classification: "passed", reused: true };
  }

  const priorDisposition = classifyPriorStage({ receipt: priorReceipt, isProcessAlive });
  const receipt = createStageReceiptWriter({
    path: receiptPath,
    stage: "web-typecheck",
    identity,
  });
  receipt.start({
    bi: "BI-872CB1BF",
    recoveredFrom: priorDisposition === "externally-terminated"
      ? {
          hostPid: priorReceipt.hostPid ?? null,
          lastHeartbeatAt: priorReceipt.lastHeartbeatAt ?? null,
        }
      : null,
  });

  const observedRunner = runObservedProcess ?? createObservedProcessRunner({
    onProgress: (progress) => receipt.heartbeat(progress),
  });

  const result = await observedRunner({
    command: "pnpm",
    args: ["--filter", "web", "typecheck:all"],
    observation: { stage: "web-typecheck" },
  });
  const classification = classifyTypecheckResult(result);
  receipt.complete(classification, {
    childPid: result.childPid,
    statusCode: result.status,
    signal: result.signal,
    error: result.error
      ? { name: result.error.name, code: result.error.code, message: result.error.message }
      : null,
    outputTail: result.outputTail,
    hostSamples: result.hostSamples,
  });
  process.stdout.write(
    `[local-ci-typecheck] classification=${classification} diagnostics=${receiptPath}\n`,
  );
  // BI-27D3DCCD: say it in the log, not only in a receipt nobody opens. The
  // observed cost of staying quiet was two gate attempts read as a code defect.
  if (isInconclusiveTypecheck(classification)) {
    process.stdout.write(
      "[local-ci-typecheck] this stage reached NO verdict on your changes"
        + `${result.signal ? ` (child terminated by ${result.signal})` : ""}`
        + `${classification === "failed-without-diagnostics"
          ? " (exited non-zero without emitting a single TypeScript diagnostic)"
          : ""}`
        + " — re-run it; do not read this as a type error.\n",
    );
  }
  return {
    status: isInconclusiveTypecheck(classification) ? TSC_TERMINATED_EXIT_CODE : (result.status ?? 1),
    classification,
    reused: false,
  };
}

async function main() {
  const metadataPath = process.env.DPF_LOCAL_CI_METADATA_FILE ?? "";
  const receiptPath = resolve(
    process.env.DPF_LOCAL_CI_TYPECHECK_RECEIPT_FILE
      || (metadataPath ? `${metadataPath}.typecheck.json` : ".dpf-local-ci-typecheck.json"),
  );
  const result = await runTypecheckStage({ receiptPath });
  process.exit(result.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`[local-ci-typecheck] supervisor failed: ${error.stack || error.message}\n`);
    process.exit(86);
  });
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runVitestWithRecovery } from "./lib/local-ci-vitest-supervisor.mjs";
import { createObservedProcessRunner } from "./lib/local-ci-process-observer.mjs";
import {
  classifyPriorStage,
  createStageReceiptWriter,
  markStageReceiptReused,
  readStageReceipt,
  reusablePassedStage,
} from "./lib/local-ci-stage-receipt.mjs";

function valueAfter(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveGit(ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", ref], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function lastCompletedTestLine(outputTail) {
  return outputTail
    .split(/\r?\n/)
    .reverse()
    .find((line) => /(?:^|\s)(?:✓|×|❯)\s/.test(line))
    ?.trim() ?? null;
}

export function selectVitestRecoveryPlan({
  priorDisposition,
  initialWorkers,
  retryWorkers,
}) {
  const recoveringPriorTermination = priorDisposition === "externally-terminated";
  return {
    initialWorkers: recoveringPriorTermination ? retryWorkers : initialWorkers,
    retryWorkers,
    allowRetry: !recoveringPriorTermination,
    recoveringPriorTermination,
  };
}

export function createAttemptRunner({
  spawnImpl,
  sampleHost,
  stdout = process.stdout,
  stderr = process.stderr,
  sampleIntervalMs = 5_000,
  onProgress = () => {},
} = {}) {
  const runObservedProcess = createObservedProcessRunner({
    spawnImpl,
    sampleHost,
    stdout,
    stderr,
    sampleIntervalMs,
    onProgress: (progress) => onProgress({
      ...progress,
      lastCompletedTest: lastCompletedTestLine(progress.outputTail ?? ""),
    }),
  });
  return function runAttempt({ workers, attempt }) {
    const args = [
        "--filter", "web", "exec", "vitest", "run",
        `--maxWorkers=${workers}`,
        "--reporter=verbose",
      ];
    return runObservedProcess({
      command: "pnpm",
      args,
      observation: { attempt, workers },
    }).then((result) => ({
      ...result,
      lastCompletedTest: lastCompletedTestLine(result.outputTail),
    }));
  };
}

async function main() {
  const initialWorkers = positiveInteger(valueAfter("--initial-workers", "4"), 4);
  const retryWorkers = positiveInteger(valueAfter("--retry-workers", "2"), 2);
  const metadataPath = process.env.DPF_LOCAL_CI_METADATA_FILE ?? "";
  const diagnosticsPath = resolve(
    process.env.DPF_LOCAL_CI_VITEST_DIAGNOSTICS_FILE
      || (metadataPath ? `${metadataPath}.vitest.json` : ".dpf-local-ci-vitest.json"),
  );
  const startedAt = new Date().toISOString();
  let latestAttempts = [];
  const identity = {
    integrationTreeSha: resolveGit("HEAD^{tree}"),
    command: `pnpm --filter web exec vitest run --maxWorkers=${initialWorkers} --reporter=verbose`,
  };
  const priorReceipt = readStageReceipt(diagnosticsPath);
  if (reusablePassedStage({
    receipt: priorReceipt,
    stage: "exhaustive-vitest",
    identity,
  })) {
    markStageReceiptReused({ path: diagnosticsPath, receipt: priorReceipt });
    process.stdout.write(
      `[local-ci-vitest] reusing exact-tree passed receipt ${diagnosticsPath}\n`,
    );
    return;
  }
  const priorDisposition = classifyPriorStage({
    receipt: priorReceipt,
    isProcessAlive: processAlive,
  });
  const receipt = createStageReceiptWriter({
    path: diagnosticsPath,
    stage: "exhaustive-vitest",
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

  const recoveryPlan = selectVitestRecoveryPlan({
    priorDisposition,
    initialWorkers,
    retryWorkers,
  });

  const result = await runVitestWithRecovery({
    initialWorkers: recoveryPlan.initialWorkers,
    retryWorkers: recoveryPlan.retryWorkers,
    allowRetry: recoveryPlan.allowRetry,
    runAttempt: createAttemptRunner({
      onProgress: (progress) => receipt.heartbeat(progress),
    }),
    onAttempt: async (attempt) => {
      latestAttempts = [...latestAttempts, attempt];
      receipt.heartbeat({
        attempt: attempt.attempt,
        workers: attempt.workers,
        classification: attempt.classification,
        childPid: attempt.childPid,
        lastCompletedTest: attempt.lastCompletedTest,
      });
      if (recoveryPlan.allowRetry && attempt.classification === "runner-termination" && attempt.attempt === 1) {
        process.stderr.write(
          `[local-ci-vitest] runner termination detected (status=${attempt.status}, signal=${attempt.signal ?? "none"}); retrying the same exhaustive suite once with ${retryWorkers} workers\n`,
        );
      }
    },
  });
  const recovered = result.recovered
    || (recoveryPlan.recoveringPriorTermination && result.classification === "passed");

  receipt.complete(result.classification, {
    recovered,
    recoveryPlan,
    startedAt,
    attempts: result.attempts,
  });
  process.stdout.write(
    `[local-ci-vitest] classification=${result.classification} attempts=${result.attempts.length} recovered=${recovered} diagnostics=${diagnosticsPath}\n`,
  );
  process.exit(result.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const metadataPath = process.env.DPF_LOCAL_CI_METADATA_FILE ?? "";
    const diagnosticsPath = resolve(
      process.env.DPF_LOCAL_CI_VITEST_DIAGNOSTICS_FILE
        || (metadataPath ? `${metadataPath}.vitest.json` : ".dpf-local-ci-vitest.json"),
    );
    process.stderr.write(`[local-ci-vitest] supervisor failed: ${error.stack || error.message}\n`);
    process.exit(86);
  });
}

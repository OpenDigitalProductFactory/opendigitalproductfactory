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
  stageIdentityMatches,
} from "./lib/local-ci-stage-receipt.mjs";

const DEFAULT_VITEST_MAX_DURATION_MS = 30 * 60 * 1_000;

function valueAfter(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveVitestMaxDurationMs(env = process.env) {
  return positiveInteger(
    env.DPF_LOCAL_CI_VITEST_MAX_DURATION_MS,
    DEFAULT_VITEST_MAX_DURATION_MS,
  );
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
  priorExecutionProfile = null,
  initialWorkers,
  retryWorkers,
}) {
  const recoveringPriorTermination = priorDisposition === "externally-terminated"
    || priorDisposition === "retry-exhausted";
  const exhausted = priorDisposition === "retry-exhausted"
    || (
      recoveringPriorTermination
      && priorExecutionProfile?.mode === "differentiated-recovery"
      && priorExecutionProfile?.workers === retryWorkers
    );
  const executionProfile = recoveringPriorTermination
    ? { mode: "differentiated-recovery", workers: retryWorkers }
    : { mode: "initial", workers: initialWorkers };
  return {
    initialWorkers: recoveringPriorTermination ? retryWorkers : initialWorkers,
    retryWorkers,
    allowRetry: !recoveringPriorTermination,
    recoveringPriorTermination,
    exhausted,
    executionProfile,
  };
}

function latestExecutionProfile(receipt) {
  const observations = Array.isArray(receipt?.observations)
    ? receipt.observations
    : [];
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    if (observations[index]?.executionProfile) {
      return observations[index].executionProfile;
    }
  }
  return receipt?.executionProfile ?? null;
}

export function recoveryReceiptForIdentity({ receipt, identity }) {
  return receipt?.stage === "exhaustive-vitest"
    && stageIdentityMatches(receipt.identity, identity)
    ? receipt
    : null;
}

export function createAttemptRunner({
  spawnImpl,
  sampleHost,
  stdout = process.stdout,
  stderr = process.stderr,
  sampleIntervalMs = 5_000,
  onProgress = () => {},
  maxDurationMs = resolveVitestMaxDurationMs(),
  terminationGraceMs = 10_000,
  closeGraceMs = 10_000,
  terminateProcessTreeImpl,
  setTimeoutImpl,
  clearTimeoutImpl,
  now,
} = {}) {
  const runObservedProcess = createObservedProcessRunner({
    spawnImpl,
    sampleHost,
    stdout,
    stderr,
    sampleIntervalMs,
    maxDurationMs,
    terminationGraceMs,
    closeGraceMs,
    ...(terminateProcessTreeImpl ? { terminateProcessTreeImpl } : {}),
    ...(setTimeoutImpl ? { setTimeoutImpl } : {}),
    ...(clearTimeoutImpl ? { clearTimeoutImpl } : {}),
    ...(now ? { now } : {}),
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
  const maxDurationMs = resolveVitestMaxDurationMs();
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
    maxDurationMs,
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
  const matchingPriorReceipt = recoveryReceiptForIdentity({
    receipt: priorReceipt,
    identity,
  });
  const priorDisposition = matchingPriorReceipt?.retryExhausted === true
    ? "retry-exhausted"
    : classifyPriorStage({
        receipt: matchingPriorReceipt,
        isProcessAlive: processAlive,
      });
  const recoveryPlan = selectVitestRecoveryPlan({
    priorDisposition,
    priorExecutionProfile: latestExecutionProfile(matchingPriorReceipt),
    initialWorkers,
    retryWorkers,
  });
  const receipt = createStageReceiptWriter({
    path: diagnosticsPath,
    stage: "exhaustive-vitest",
    identity,
  });
  receipt.start({
    bi: "BI-872CB1BF",
    maxDurationMs,
    executionProfile: recoveryPlan.executionProfile,
    recoveredFrom: recoveryPlan.recoveringPriorTermination
      ? {
          hostPid: matchingPriorReceipt.hostPid ?? null,
          lastHeartbeatAt: matchingPriorReceipt.lastHeartbeatAt ?? null,
          executionProfile: latestExecutionProfile(matchingPriorReceipt),
        }
      : null,
  });

  if (recoveryPlan.exhausted) {
    receipt.complete("runner-termination", {
      retryExhausted: true,
      recoveryPlan,
      priorTermination: {
        hostPid: matchingPriorReceipt.hostPid ?? null,
        lastHeartbeatAt: matchingPriorReceipt.lastHeartbeatAt ?? null,
        executionProfile: latestExecutionProfile(matchingPriorReceipt),
      },
    });
    process.stderr.write(
      "[local-ci-vitest] differentiated recovery already terminated; recording terminal runner evidence without another child\n",
    );
    process.exit(86);
  }

  const observedAttempt = createAttemptRunner({
    maxDurationMs,
    onProgress: (progress) => receipt.heartbeat(progress),
  });

  const result = await runVitestWithRecovery({
    initialWorkers: recoveryPlan.initialWorkers,
    retryWorkers: recoveryPlan.retryWorkers,
    allowRetry: recoveryPlan.allowRetry,
    runAttempt: ({ workers, attempt }) => {
      receipt.heartbeat({
        attempt,
        workers,
        executionProfile: {
          mode: workers === retryWorkers && (attempt > 1 || recoveryPlan.recoveringPriorTermination)
            ? "differentiated-recovery"
            : "initial",
          workers,
        },
      });
      return observedAttempt({ workers, attempt });
    },
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
    retryExhausted: result.classification === "runner-termination"
      && result.attempts.some((attempt) => attempt.workers === retryWorkers),
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
    process.stderr.write(
      `[local-ci-vitest] supervisor failed: ${error.stack || error.message} diagnostics=${diagnosticsPath}\n`,
    );
    process.exit(86);
  });
}

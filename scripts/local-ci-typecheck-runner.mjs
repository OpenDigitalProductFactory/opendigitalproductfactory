#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

export function classifyTypecheckResult(result) {
  if (result.status === 0) return "passed";
  if (result.error || result.status === null || result.status === -1 || result.status === 4294967295) {
    return "runner-termination";
  }
  return "failed";
}

export async function runTypecheckStage({
  receiptPath,
  resolveGitImpl = resolveGit,
  isProcessAlive = processAlive,
  runObservedProcess,
} = {}) {
  const identity = {
    integrationTreeSha: resolveGitImpl("HEAD^{tree}"),
    command: "pnpm --filter web typecheck",
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
    args: ["--filter", "web", "typecheck"],
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
  return {
    status: classification === "runner-termination" ? 86 : (result.status ?? 1),
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

#!/usr/bin/env node
import { parseArgs as utilParseArgs } from "node:util";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LOCAL_SEMANTIC_REVIEW_GATE_SCHEMA_VERSION, readGitDiffDigest, validateLocalSemanticReviewGate } from "./lib/semantic-review-gate.mjs";
import { gitText } from "./lib/git.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(join(here, "semantic-review-policy.json"), "utf8"));

const git = (...args) => gitText(args, { cwd: process.cwd() });

function option(name) {
  // strict: false keeps the old tolerance: flags this script does not read are ignored.
  const { values } = utilParseArgs({
    args: process.argv.slice(2),
    strict: false,
    allowPositionals: true,
    options: { "receipt-file": { type: "string" }, "evidence-id": { type: "string" } },
  });
  const value = values[name.replace(/^--/, "")];
  return value === undefined ? null : typeof value === "string" ? value : undefined;
}

function currentIdentity(receipt = null) {
  const branch = git("branch", "--show-current");
  const sha = git("rev-parse", "HEAD");
  const mergeBase = git("merge-base", "HEAD", "origin/main");
  const baseTreeHash = git("rev-parse", `${mergeBase}^{tree}`);
  const headTreeHash = git("rev-parse", "HEAD^{tree}");
  const diffDigest = readGitDiffDigest(mergeBase);
  return {
    branch,
    sha,
    capsuleId: receipt?.capsuleId ?? "",
    baseTreeHash,
    headTreeHash,
    diffDigest,
    policyVersion: policy.policyVersion,
    reviewerVersion: policy.reviewerVersion,
    specialistIds: receipt?.specialistIds ?? [],
  };
}

const stateFile = git("rev-parse", "--git-path", "dpf-semantic-review-gate.json");
const command = process.argv[2] ?? "validate";

if (command === "record") {
  const receiptFile = option("--receipt-file");
  const evidenceId = option("--evidence-id");
  if (!receiptFile || !evidenceId) throw new Error("record requires --receipt-file and --evidence-id");
  const payload = JSON.parse(readFileSync(receiptFile, "utf8"));
  const receipt = payload?.data?.receipt ?? payload?.receipt ?? payload;
  const current = currentIdentity(receipt);
  const exact = receipt.schemaVersion === policy.receiptSchemaVersion &&
    receipt.baseTreeHash === current.baseTreeHash &&
    receipt.headTreeHash === current.headTreeHash &&
    receipt.diffDigest === current.diffDigest &&
    receipt.policyVersion === current.policyVersion &&
    receipt.reviewerVersion === current.reviewerVersion;
  if (!exact) throw new Error("receipt identity does not match the current committed diff and policy");
  writeFileSync(stateFile, `${JSON.stringify({
    schemaVersion: LOCAL_SEMANTIC_REVIEW_GATE_SCHEMA_VERSION,
    ...current,
    receiptDecision: receipt.result?.decision,
    receiptDisposition: receipt.disposition,
    evidenceId,
    recordedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(`[semantic-review-gate] recorded ${receipt.result?.decision} receipt for ${current.branch}@${current.sha}`);
  process.exit(0);
}

if (command !== "validate") throw new Error(`unknown command: ${command}`);
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
const current = currentIdentity(state);
const result = validateLocalSemanticReviewGate(state, current);
if (result.valid) {
  console.log(`[semantic-review-gate] fresh receipt for ${current.branch}@${current.sha}`);
  process.exit(0);
}
const message = `[semantic-review-gate] ${result.reason} for ${current.branch}@${current.sha}`;
if (policy.mode === "shadow") {
  console.warn(`${message} (shadow observation; publication remains allowed)`);
  process.exit(0);
}
console.error(`${message}; run review_semantic_change on the exact committed tree and record its receipt before publication`);
process.exit(1);

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  collectToolchainFingerprint,
  createLocalIntegrationPlan,
  resolveCommandInvocation,
  resolveGitRevision,
} from "./lib/local-integration-ci.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
}

const candidateBranch = valueAfter("--candidate");
const baseRef = valueAfter("--base-ref") || "origin/main";
const candidateSha = valueAfter("--candidate-sha");
const baseSha = valueAfter("--base-sha");
const metadataOut = valueAfter("--metadata-out");
const evidencePlanOut = valueAfter("--evidence-plan-out")
  || (metadataOut ? join(dirname(metadataOut), "dpf-ci-evidence-plan.json") : "");
const mode = valueAfter("--mode") || "single-branch";
const buildStrategy = valueAfter("--build-strategy");
const fetchBase = process.argv.includes("--fetch-base");
const siblingBranches = process.argv
  .filter((arg) => arg.startsWith("--sibling="))
  .map((arg) => arg.slice("--sibling=".length));

if (!candidateBranch) {
  console.error("Usage: node scripts/local-integration-ci.mjs --candidate BRANCH [--base-ref REF] [--candidate-sha SHA] [--base-sha SHA] [--metadata-out PATH] [--evidence-plan-out PATH] [--fetch-base] [--mode single-branch|sibling-set|post-merge-main] [--sibling=BRANCH] [--migrate-deploy]");
  process.exit(2);
}

const plan = createLocalIntegrationPlan({
  candidateBranch,
  baseRef,
  mode,
  siblingBranches,
  buildStrategy: buildStrategy || undefined,
  fetchBase,
  evidencePlanOutput: evidencePlanOut || undefined,
  includeMigrateDeploy: process.argv.includes("--migrate-deploy"),
});
const startedAt = new Date().toISOString();
for (const command of plan.commands) {
  console.log(`[local-integration-ci] ${command.join(" ")}`);
  const invocation = resolveCommandInvocation(command);
  const result = spawnSync(invocation.command, invocation.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: invocation.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (metadataOut) {
  const evidencePlan = evidencePlanOut
    ? JSON.parse(readFileSync(evidencePlanOut, "utf8"))
    : null;
  const payload = {
    schemaVersion: 1,
    bi: "BI-76551B2D",
    mode,
    candidateRef: candidateBranch,
    candidateSha: candidateSha || resolveGitRevision(candidateBranch),
    baseRef,
    fetchBase,
    baseSha: baseSha || resolveGitRevision(baseRef),
    integrationBranch: plan.integrationBranch,
    integrationCommitSha: resolveGitRevision("HEAD"),
    synthesizedTreeSha: resolveGitRevision("HEAD^{tree}"),
    buildStrategy: plan.buildStrategy,
    evidencePlan: evidencePlan ? {
      path: evidencePlanOut,
      digest: evidencePlan.digest,
      plannerVersion: evidencePlan.plannerVersion,
      policyVersion: evidencePlan.policyVersion,
      evidenceTier: evidencePlan.evidenceTier,
      fullSuite: evidencePlan.fullSuite,
    } : null,
    ...collectToolchainFingerprint({ buildStrategy: plan.buildStrategy }),
    commands: plan.commands.map((command) => command.join(" ")),
    startedAt,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(metadataOut, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[local-integration-ci] metadata ${metadataOut}`);
}

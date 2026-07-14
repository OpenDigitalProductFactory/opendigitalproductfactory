#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { collectToolchainFingerprint, createLocalIntegrationPlan } from "./lib/local-integration-ci.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
}

const candidateBranch = valueAfter("--candidate");
const baseRef = valueAfter("--base-ref") || "origin/main";
const candidateSha = valueAfter("--candidate-sha");
const baseSha = valueAfter("--base-sha");
const metadataOut = valueAfter("--metadata-out");
const mode = valueAfter("--mode") || "single-branch";
const buildStrategy = valueAfter("--build-strategy");
const siblingBranches = process.argv
  .filter((arg) => arg.startsWith("--sibling="))
  .map((arg) => arg.slice("--sibling=".length));

if (!candidateBranch) {
  console.error("Usage: node scripts/local-integration-ci.mjs --candidate BRANCH [--base-ref REF] [--candidate-sha SHA] [--base-sha SHA] [--metadata-out PATH] [--fetch-base] [--mode single-branch|sibling-set|post-merge-main] [--sibling=BRANCH] [--migrate-deploy]");
  process.exit(2);
}

const plan = createLocalIntegrationPlan({
  candidateBranch,
  baseRef,
  mode,
  siblingBranches,
  buildStrategy: buildStrategy || undefined,
  fetchBase: process.argv.includes("--fetch-base"),
  includeMigrateDeploy: process.argv.includes("--migrate-deploy"),
});
const startedAt = new Date().toISOString();
for (const command of plan.commands) {
  console.log(`[local-integration-ci] ${command.join(" ")}`);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (metadataOut) {
  const revParse = (ref) => {
    const result = spawnSync("git", ["rev-parse", "--verify", ref], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      throw new Error(`failed to resolve ${ref}: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
  };
  const payload = {
    schemaVersion: 1,
    bi: "BI-76551B2D",
    mode,
    candidateRef: candidateBranch,
    candidateSha: candidateSha || revParse(candidateBranch),
    baseRef,
    baseSha: baseSha || revParse(baseRef),
    integrationBranch: plan.integrationBranch,
    integrationCommitSha: revParse("HEAD"),
    synthesizedTreeSha: revParse("HEAD^{tree}"),
    buildStrategy: plan.buildStrategy,
    ...collectToolchainFingerprint({ buildStrategy: plan.buildStrategy }),
    commands: plan.commands.map((command) => command.join(" ")),
    startedAt,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(metadataOut, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[local-integration-ci] metadata ${metadataOut}`);
}

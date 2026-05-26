#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createLocalIntegrationPlan } from "./lib/local-integration-ci.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
}

const candidateBranch = valueAfter("--candidate");
const mode = valueAfter("--mode") || "single-branch";
const buildStrategy = valueAfter("--build-strategy");
const siblingBranches = process.argv
  .filter((arg) => arg.startsWith("--sibling="))
  .map((arg) => arg.slice("--sibling=".length));

if (!candidateBranch) {
  console.error("Usage: node scripts/local-integration-ci.mjs --candidate BRANCH [--mode single-branch|sibling-set|post-merge-main] [--sibling=BRANCH]");
  process.exit(2);
}

const plan = createLocalIntegrationPlan({
  candidateBranch,
  mode,
  siblingBranches,
  buildStrategy: buildStrategy || undefined,
});
for (const command of plan.commands) {
  console.log(`[local-integration-ci] ${command.join(" ")}`);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

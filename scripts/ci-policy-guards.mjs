#!/usr/bin/env node

import { appendFileSync, writeFileSync } from "node:fs";

import {
  POLICY_GUARD_PROFILES,
  formatRunSummary,
  runPolicyProfile,
} from "./lib/ci-policy-guards.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function markdown(profile, result) {
  const rows = result.entries.map(
    (entry) =>
      `| ${entry.status === "passed" ? "pass" : "FAIL"} | ${entry.name} | ${(entry.durationMs / 1000).toFixed(1)}s |`,
  );
  return [
    `## CI policy guards: ${profile}`,
    "",
    "| Result | Guard | Duration |",
    "| --- | --- | ---: |",
    ...rows,
    "",
  ].join("\n");
}

export async function main() {
  const profile = argument("--profile");
  const entries = POLICY_GUARD_PROFILES[profile];
  if (!entries) {
    throw new Error(
      `--profile must be one of: ${Object.keys(POLICY_GUARD_PROFILES).join(", ")}`,
    );
  }

  const result = await runPolicyProfile({
    entries,
    logger(event) {
      if (event.type === "start") {
        console.log(`::group::${event.entry.name}`);
      } else {
        if (event.result.status === "failed") {
          console.error(
            `::error title=${event.entry.name}::${event.result.failedCommand} failed`,
          );
        }
        console.log("::endgroup::");
      }
    },
  });

  const resultsPath = argument("--results");
  if (resultsPath) {
    writeFileSync(
      resultsPath,
      `${JSON.stringify({ profile, ...result }, null, 2)}\n`,
      "utf8",
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${markdown(profile, result)}\n`,
      "utf8",
    );
  }

  // Consolidated summary at the LOG TAIL (outside any collapsed `::group`), so
  // the failing guard is never hidden behind the last guard's output.
  const summary = formatRunSummary(profile, result);
  console.log(`\n${summary.text}`);
  if (summary.annotation) console.error(summary.annotation);

  if (!result.ok) process.exitCode = 1;
}

if (isEntryModule(import.meta.url)) {
  await main();
}

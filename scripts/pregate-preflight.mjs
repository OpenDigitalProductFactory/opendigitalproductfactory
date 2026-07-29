#!/usr/bin/env node
// scripts/pregate-preflight.mjs — CLI for the host-side guard parity preflight
// (BI-D35433FB). Run standalone (`pnpm run pregate:preflight`) or let
// scripts/pregate.mjs invoke it automatically before lease admission.
//
//   node scripts/pregate-preflight.mjs           # run the preflight
//   node scripts/pregate-preflight.mjs --plan    # print the plan as JSON
//
// Exit codes: 0 = clean (environment-skipped guards are warnings), 1 = at
// least one guard reported a genuine violation.

import { fileURLToPath } from "node:url";

import {
  PREFLIGHT_SKIP_ENV,
  buildPreflightPlan,
  runPreflight,
} from "./lib/pregate-preflight.mjs";

export async function main() {
  if (process.argv.includes("--plan")) {
    const plan = buildPreflightPlan().map((entry) => ({
      id: entry.id,
      name: entry.name,
      commands: entry.commands.map(([command, args]) => [command, ...args].join(" ")),
    }));
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  const startedAt = Date.now();
  const result = await runPreflight({
    // Failure lines are printed from the FINAL classified entries below —
    // an env-degraded guard transiently looks "failed" at finish-time and
    // must not be announced as a failure here.
    logger(event) {
      if (event.type === "start") {
        process.stdout.write(`[pregate-preflight] ${event.entry.name}…\n`);
      }
    },
  });

  if (result.skipped) {
    process.stdout.write(
      `[pregate-preflight] SKIPPED — ${PREFLIGHT_SKIP_ENV}=${result.skipReason}\n`,
    );
    return;
  }

  const failed = result.entries.filter((entry) => entry.status === "failed");
  const environmentSkipped = result.entries.filter(
    (entry) => entry.status === "skipped_environment",
  );
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  for (const entry of environmentSkipped) {
    process.stderr.write(
      `[pregate-preflight] WARN ${entry.name} could not run on this host (missing runtime) — CI will still enforce it. Remedy: pnpm install --frozen-lockfile --ignore-scripts --filter @dpf/repo-guard-runtime\n`,
    );
  }

  if (failed.length > 0) {
    process.stderr.write(
      `[pregate-preflight] ${failed.length} guard(s) FAILED in ${elapsed}s — these are deterministic CI failures; fix them before the sandbox gate runs:\n`,
    );
    for (const entry of failed) {
      process.stderr.write(`  - ${entry.name}: ${entry.failedCommand}\n`);
    }
    process.stderr.write(
      `[pregate-preflight] emergency skip (recorded honesty, CI still enforces): set ${PREFLIGHT_SKIP_ENV}="<why>"\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `[pregate-preflight] OK — ${result.entries.length} guards clean in ${elapsed}s` +
      (environmentSkipped.length > 0
        ? ` (${environmentSkipped.length} environment-skipped, see warnings)`
        : "") +
      "\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

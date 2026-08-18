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

import {
  PREFLIGHT_SKIP_ENV,
  buildPreflightPlan,
  runPreflight,
} from "./lib/pregate-preflight.mjs";
import { checkStaleRootClone } from "./lib/stale-root-clone.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

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

  // BI-A900EA3F: fail fast when a linked worktree junctions @dpf/* into a root
  // clone that is behind origin/main — phantom typecheck errors otherwise look
  // like base drift and tempt Local-CI-Override.
  const staleRoot = checkStaleRootClone({ worktreeRoot: process.cwd() });
  if (!staleRoot.ok) {
    process.stderr.write(`[pregate-preflight] ${staleRoot.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (staleRoot.behind === 0 && staleRoot.rootClonePath) {
    process.stdout.write(
      `[pregate-preflight] root clone current (${staleRoot.rootClonePath})\n`,
    );
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
  const runnerFailed = result.entries.filter(
    (entry) => entry.status === "runner_failed",
  );
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  for (const entry of environmentSkipped) {
    // BI-99CAE42F: never recommend a bare --filter install from the workspace root.
    process.stderr.write(
      `[pregate-preflight] WARN ${entry.name} could not run on this host (missing runtime) — CI will still enforce it. ` +
        `Remedy: node scripts/lib/bootstrap-worktree-deps.mjs .  (managed install; do NOT run bare pnpm --filter at the workspace root — it prunes sibling links)\n`,
    );
  }

  // BI-AA2EE621: a spawn the host killed or refused is NOT a deterministic guard
  // violation. Report it honestly (host contention, retry) and let CI/the
  // sandbox enforce — never send the reader to audit an innocent guard.
  for (const entry of runnerFailed) {
    process.stderr.write(
      `[pregate-preflight] WARN ${entry.name} could not RUN on this host (spawn killed or refused — host under pressure, not a guard violation) — retry on a quieter host; CI will still enforce it.\n`,
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
      `[pregate-preflight] see every constraint that applies to this diff: pnpm gate:context\n` +
      `[pregate-preflight] emergency skip (recorded honesty, CI still enforces): set ${PREFLIGHT_SKIP_ENV}="<why>"\n`,
    );
    process.exitCode = 1;
    return;
  }

  const caveats = [
    environmentSkipped.length > 0 ? `${environmentSkipped.length} environment-skipped` : null,
    runnerFailed.length > 0 ? `${runnerFailed.length} host-could-not-run` : null,
  ].filter(Boolean);
  process.stdout.write(
    `[pregate-preflight] OK — ${result.entries.length} guards clean in ${elapsed}s` +
      (caveats.length > 0 ? ` (${caveats.join(", ")}, see warnings)` : "") +
      "\n",
  );
}

if (isEntryModule(import.meta.url)) {
  await main();
}

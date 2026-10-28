#!/usr/bin/env node
// scripts/record-guard-outcome.mjs — record one hook verdict as a guard
// outcome run (BI-FEDD8F45), spool it and flush the spool.
//
//   node scripts/record-guard-outcome.mjs --runner pre-push-gate --verdict refused --duration-ms 120
//
// Called by .githooks/pre-push-gate on every exit path. It always exits 0: a
// recording failure must never change whether a push is allowed.

import { parseArgs } from "node:util";

import { isEntryModule } from "./lib/entry-module.mjs";
import { buildGuardResult, digestFiles, GUARD_VERDICTS, recordGuardRun } from "./lib/guard-outcome-record.mjs";
import { submitSpool } from "./lib/guard-outcome-submit.mjs";

export const HOOK_GUARDS = Object.freeze({
  "pre-push-gate": { guardId: "hook:pre-push-gate", files: [".githooks/pre-push-gate"] },
});

export function parseHookArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      runner: { type: "string" },
      verdict: { type: "string" },
      "duration-ms": { type: "string" },
    },
    strict: false,
  });
  const hook = HOOK_GUARDS[values.runner];
  const verdict = GUARD_VERDICTS.includes(values.verdict) ? values.verdict : null;
  const durationMs = Math.max(0, Number(values["duration-ms"]) || 0);
  if (!hook || !verdict) return null;
  return { runner: values.runner, hook, verdict, durationMs };
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), record = recordGuardRun, now = Date.now } = {}) {
  const parsed = parseHookArgs(argv);
  if (!parsed) return { recorded: false, reason: "usage" };
  const guard = buildGuardResult({
    guardId: parsed.hook.guardId,
    kind: "hook",
    guardDigest: digestFiles(parsed.hook.files, { repoRoot: cwd }),
    verdict: parsed.verdict,
    durationMs: parsed.durationMs,
  });
  await record({
    runner: parsed.runner,
    guards: [guard],
    startedAt: now() - parsed.durationMs,
    durationMs: parsed.durationMs,
    cwd,
    submit: submitSpool,
  });
  return { recorded: true };
}

if (isEntryModule(import.meta.url)) {
  try {
    await main();
  } catch {
    // never change the hook's outcome
  }
  process.exitCode = 0;
}

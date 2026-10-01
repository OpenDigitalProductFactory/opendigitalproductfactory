#!/usr/bin/env node
// scripts/gate-local.mjs
//
// BI-85270E96: the fast loop. Runs every diff-scoped, deterministic gate that
// CI will run on the PR — against the WORKING TREE, before the first commit —
// and reads the planned commit message so trailer-bearing gates judge the
// same text the commit will carry. What used to take three or four hook
// cycles (commit → gate → fix → amend) becomes one command that finishes in
// a couple of minutes.
//
//   pnpm gate:local                       # working tree, no planned message
//   pnpm gate:local -- --message-file m.txt
//   pnpm gate:local -- --committed         # judge only what is committed (CI's view)
//
// This is not the sandbox gate and not the guard loop: `pnpm pregate` still
// owns the lease-gated local-CI run and `pnpm pregate:preflight` the full
// 40+ guard parity pass. This is the subset an author iterates against.

import { parseArgs as utilParseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { scrubGitRepoLocationEnv } from "./lib/git-hook-env.mjs";
import { INCLUDE_WORKING_TREE_ENV } from "./lib/git-changed-files.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The diff-scoped gates an author iterates against, in the order CI runs them. */
export const LOCAL_GATES = Object.freeze([
  { id: "ux-fit", command: ["node", "scripts/check-ux-fit-decision.mjs"] },
  { id: "docs-impact", command: ["node", "scripts/check-docs-impact.mjs"] },
  { id: "design-grounding", command: ["node", "scripts/check-design-grounding-decision.mjs"] },
  { id: "spec-plan-doc", command: ["node", "scripts/check-spec-plan-doc.mjs"] },
  { id: "data-impact", command: ["node", "scripts/check-data-impact.mjs"] },
  { id: "convergence-impact", command: ["node", "scripts/check-convergence-impact.mjs"] },
  { id: "seed-fit", command: ["node", "scripts/check-seed-fit-decision.mjs"] },
  { id: "clock-bombs", command: ["node", "scripts/check-test-clock-bombs.mjs"] },
  { id: "module-size", command: ["node", "scripts/check-module-size.mjs"] },
  { id: "one-action-result", command: ["node", "scripts/check-no-local-action-result.mjs"] },
  { id: "client-server-boundary", command: ["node", "scripts/check-no-server-imports-in-client.mjs"] },
  { id: "prose-lint", command: ["pnpm", "run", "check:prose-lint"] },
]);

export function parseArgs(argv) {
  // strict: false keeps the old tolerance: unknown flags are ignored.
  const { values } = utilParseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    options: { "message-file": { type: "string" }, committed: { type: "boolean" }, only: { type: "string" } },
  });
  const text = (value) => (typeof value === "string" ? value : undefined);
  return {
    messageFile: text(values["message-file"]) ?? null,
    committed: values.committed === true,
    only: values.only === undefined ? null : (text(values.only) ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export function buildGateEnv({ base = process.env, messageFile = null, committed = false, readFile = (p) => readFileSync(p, "utf8") } = {}) {
  const env = scrubGitRepoLocationEnv(base);
  if (!committed) env[INCLUDE_WORKING_TREE_ENV] = "1";
  else delete env[INCLUDE_WORKING_TREE_ENV];
  if (messageFile) {
    // The planned commit message plays the PR body: every trailer-bearing gate
    // already reads PR_BODY, so no gate needs to know about the file.
    env.PR_BODY = `${env.PR_BODY ? `${env.PR_BODY}\n\n` : ""}${readFile(messageFile)}`;
  }
  return env;
}

/** Runs gates in order; returns per-gate outcomes. A gate that cannot start is `runner_failed`, not a failure. */
export function runLocalGates({ gates = LOCAL_GATES, env, spawn = spawnSync, log = (line) => process.stdout.write(`${line}\n`) }) {
  const results = [];
  for (const gate of gates) {
    const started = Date.now();
    const result = spawn(gate.command[0], gate.command.slice(1), { cwd: REPO_ROOT, env, encoding: "utf8", shell: process.platform === "win32" });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.error || result.status === null) {
      results.push({ id: gate.id, status: "runner_failed", output });
      log(`  ? ${gate.id} could not run (${result.error?.message ?? "killed"}) — ${elapsed}s`);
    } else if (result.status === 0) {
      results.push({ id: gate.id, status: "passed", output });
      log(`  ✓ ${gate.id} — ${elapsed}s`);
    } else {
      results.push({ id: gate.id, status: "failed", output });
      log(`  ✗ ${gate.id} — ${elapsed}s`);
      log(output.trim().split("\n").filter((l) => !/^\s+at /.test(l)).slice(-25).map((l) => `      ${l}`).join("\n"));
    }
  }
  return results;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const env = buildGateEnv({ messageFile: args.messageFile, committed: args.committed });
  const gates = args.only ? LOCAL_GATES.filter((g) => args.only.includes(g.id)) : LOCAL_GATES;
  process.stdout.write(`[gate:local] ${args.committed ? "committed diff only" : "working tree + committed diff"}${args.messageFile ? `, planned message ${args.messageFile}` : ""}; ${gates.length} gate(s)\n`);
  const results = runLocalGates({ gates, env });
  const failed = results.filter((r) => r.status === "failed");
  const notRun = results.filter((r) => r.status === "runner_failed");
  if (failed.length === 0 && notRun.length === 0) {
    process.stdout.write(`[gate:local] all ${results.length} gate(s) green. Commit, then push; CI runs the same gates on the committed diff.\n`);
    return 0;
  }
  if (failed.length > 0) process.stderr.write(`[gate:local] ${failed.length} gate(s) failed: ${failed.map((f) => f.id).join(", ")}\n`);
  if (notRun.length > 0) process.stderr.write(`[gate:local] ${notRun.length} gate(s) could not run here: ${notRun.map((f) => f.id).join(", ")} — CI still enforces them.\n`);
  return failed.length > 0 ? 1 : 7;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());

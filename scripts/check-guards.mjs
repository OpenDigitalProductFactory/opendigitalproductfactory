#!/usr/bin/env node
// Repo guard loop — BI-3B0AD9CF (EP-8DC217EB).
//
// One runner discovers and executes every `scripts/check-no-*.mjs` ratchet
// guard, running each guard's sibling `*.test.mjs` self-test first. CI calls
// this once (the "Repo Guard Loop" job) and `pnpm check:guards` is the local
// equivalent.
//
// Why a loop instead of one CI job per guard: every consolidation PR used to
// add a job to ci.yml AND a script entry to package.json AND its guard script,
// so concurrent consolidation PRs all conflicted on ci.yml/package.json, and
// every merge re-conflicted the remaining PRs. With the loop, adding a ratchet
// is ONE new `scripts/check-no-<thing>.mjs` file — no ci.yml or package.json
// edit, no merge cascade.
//
// Contract for guard scripts:
//   - named scripts/check-no-<slug>.mjs
//   - exit 0 = clean, non-zero = violation (print the violation on stderr)
//   - optional sibling scripts/check-no-<slug>.test.mjs (node --test) proves
//     the guard logic itself; the loop runs it before the guard
//
//   node scripts/check-guards.mjs        # run all guards (CI)
//   pnpm check:guards                    # same, from anywhere in the repo
//
// KILLED-SPAWN HONESTY (BI-AA2EE621): a guard child the OS refused to launch
// (spawn ENOMEM/EAGAIN) or that was killed by a signal — on Windows a local-CI
// eviction issues `taskkill /T /F`, which leaves spawnSync `status: null` — is a
// RUNNER failure, not a guard violation. Conflating the two once reported
// `1/24 guard(s) FAILED: check-no-native-dialogs.mjs` for a guard that had run
// and PASSED, sending readers to audit an innocent guard for ~2h. classifySpawn-
// Result() keeps the two distinct; runner failures are retried (transient by
// definition) and, if still failing, reported under a separate heading with a
// distinct exit code so callers (pregate, local-CI) can tell "the host could not
// run the guards" apart from "a guard found a violation".

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, "..");

// Exit code for "this host could not RUN the guards" — deliberately distinct
// from 1 ("a guard found a violation") and from 0, so a caller can tell a
// transient host failure apart from a deterministic tree failure.
export const RUNNER_FAILURE_EXIT_CODE = 3;

export const SPAWN_OUTCOME = Object.freeze({
  OK: "ok",
  VIOLATION: "violation",
  RUNNER_FAILURE: "runner-failure",
});

// Coerce a retry count to a safe non-negative integer. A non-numeric env value
// (e.g. DPF_GUARD_SPAWN_RETRIES=off) must NOT yield NaN — `attempt >= NaN` is
// always false, which would loop forever under a persistent runner failure,
// exactly the host-pressure condition this path exists for.
export function coerceRetryCount(value, fallback = 2) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// How many times to re-spawn a guard whose spawn was killed/refused before
// believing the host genuinely cannot run it. A runner failure is transient by
// definition; a real violation is deterministic and never reaches this path.
export const DEFAULT_SPAWN_RETRIES = coerceRetryCount(process.env.DPF_GUARD_SPAWN_RETRIES, 2);

// Classify a spawnSync result WITHOUT collapsing "the spawn never ran / was
// killed" into "the guard found a violation". The order matters:
//   - result.error set     -> the child never launched (ENOMEM/EAGAIN/ENOENT)
//   - result.status null    -> launched, then terminated by a signal / taskkill
//   - result.status === 0   -> clean
//   - result.status > 0     -> a genuine guard violation, as before
export function classifySpawnResult(result) {
  if (!result || typeof result !== "object") {
    return { outcome: SPAWN_OUTCOME.RUNNER_FAILURE, detail: "no spawn result" };
  }
  if (result.error) {
    const code = result.error.code ?? result.error.message ?? "spawn failed";
    return { outcome: SPAWN_OUTCOME.RUNNER_FAILURE, detail: `spawn ${code}` };
  }
  if (typeof result.status !== "number") {
    const detail = result.signal
      ? `killed by ${result.signal}`
      : "no exit status (killed)";
    return { outcome: SPAWN_OUTCOME.RUNNER_FAILURE, detail };
  }
  if (result.status === 0) return { outcome: SPAWN_OUTCOME.OK, detail: "exit 0" };
  return { outcome: SPAWN_OUTCOME.VIOLATION, detail: `exit ${result.status}` };
}

// Spawn `argv`, retrying only while the outcome is a RUNNER failure. `spawn` is
// injectable so the loop is unit-testable without touching the OS.
export function spawnWithRunnerRetry(argv, { spawn, maxRetries = DEFAULT_SPAWN_RETRIES } = {}) {
  const cap = coerceRetryCount(maxRetries, DEFAULT_SPAWN_RETRIES);
  let classified;
  for (let attempt = 0; ; attempt += 1) {
    classified = classifySpawnResult(spawn(argv, attempt));
    if (classified.outcome !== SPAWN_OUTCOME.RUNNER_FAILURE || attempt >= cap) {
      return { ...classified, attempts: attempt + 1 };
    }
  }
}

export function discoverGuardFiles(entries) {
  const sorted=[...entries].sort();
  return {
    guards: sorted.filter((f) => /^check-no-.*\.mjs$/.test(f) && !f.endsWith(".test.mjs")),
    tests: new Set(sorted.filter((f) => /^check-no-.*\.test\.mjs$/.test(f))),
  };
}

// Pure orchestrator: run every guard (and its self-test) through the injected
// `spawn`, sorting outcomes into genuine violations vs runner failures. No
// process I/O, so tests can inject killed/errored/violating spawn results.
export function runGuards({ guards, tests, spawn, maxRetries = DEFAULT_SPAWN_RETRIES }) {
  const violations = [];
  const runnerFailures = [];
  const run = (argv) => spawnWithRunnerRetry(argv, { spawn, maxRetries });

  for (const guard of guards) {
    const testFile = guard.replace(/\.mjs$/, ".test.mjs");
    if (tests.has(testFile)) {
      const t = run(["--test", join(SCRIPTS_DIR, testFile)]);
      if (t.outcome === SPAWN_OUTCOME.RUNNER_FAILURE) {
        runnerFailures.push(`${testFile} (guard self-test) — ${t.detail}`);
        continue; // couldn't run the self-test; don't run the guard on this pass
      }
      if (t.outcome === SPAWN_OUTCOME.VIOLATION) {
        violations.push(`${testFile} (guard self-test)`);
        continue; // don't run a guard whose own logic is broken
      }
    }
    const r = run([join(SCRIPTS_DIR, guard)]);
    if (r.outcome === SPAWN_OUTCOME.RUNNER_FAILURE) runnerFailures.push(`${guard} — ${r.detail}`);
    else if (r.outcome === SPAWN_OUTCOME.VIOLATION) violations.push(guard);
  }

  return { violations, runnerFailures };
}

// Pure summary: decide the exit code and the exact operator lines from a run.
// A genuine violation dominates (exit 1); a runner-only failure is honest about
// being a host problem (exit RUNNER_FAILURE_EXIT_CODE), never "deterministic".
export function summarizeGuardRun({ guards, tests, violations, runnerFailures }) {
  const lines = [];
  const guardCount = guards.length;

  if (violations.length > 0) {
    lines.push(`Guard loop: ${violations.length}/${guardCount} guard(s) FAILED (found violations):`);
    for (const f of violations) lines.push(`  - ${f}`);
  }
  if (runnerFailures.length > 0) {
    lines.push(
      `Guard loop: could not RUN ${runnerFailures.length}/${guardCount} guard(s) — the host failed to spawn them or killed them mid-run; this is NOT a guard violation:`,
    );
    for (const f of runnerFailures) lines.push(`  - ${f}`);
    lines.push(
      "These are RUNNER failures (transient host pressure / OS refused the spawn / local-CI eviction), not deterministic guard failures — retry on a quieter host.",
    );
  }

  if (violations.length > 0) return { exitCode: 1, lines };
  if (runnerFailures.length > 0) return { exitCode: RUNNER_FAILURE_EXIT_CODE, lines };

  lines.push(`Guard loop OK — ${guardCount} guards passed (${tests.size} self-tests).`);
  return { exitCode: 0, lines };
}

export function main() {
  const { guards, tests } = discoverGuardFiles(readdirSync(SCRIPTS_DIR));

  if (guards.length === 0) {
    console.error("No scripts/check-no-*.mjs guards found — that is itself a failure.");
    process.exit(1);
  }

  const spawn = (argv) =>
    spawnSync(process.execPath, argv, { cwd: REPO_ROOT, stdio: "inherit" });

  const { violations, runnerFailures } = runGuards({ guards, tests, spawn });
  const { exitCode, lines } = summarizeGuardRun({ guards, tests, violations, runnerFailures });

  console.log("");
  const sink = exitCode === 0 ? console.log : console.error;
  for (const line of lines) sink(line);
  process.exit(exitCode);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

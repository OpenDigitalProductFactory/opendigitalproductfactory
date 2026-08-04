#!/usr/bin/env node
// Time-bomb detector (BI-6A4F47B9).
//
// Runs the web unit suite twice — once normally, once with the clock shifted
// forward — and reports the SET DIFFERENCE: tests that pass now and fail later.
// That difference is the definition of a time bomb, so there is no heuristic to
// tune and no false-positive class to triage.
//
// Context: on 2026-08-01 a single test with a hardcoded `expiresAt` went red at
// the instant it encoded and blocked every PR in the repo (a required shard).
// The obvious static sweep was measured on this repo and over-reports ~6:1 — 29
// files matched, the 5 most imminent all passed — because a future date is inert
// unless something compares it to now. Hence this dynamic check.
//
// Usage:
//   node scripts/detect-time-bombs.mjs                  # +90d (default)
//   node scripts/detect-time-bombs.mjs --days 30,90,365 # several horizons
//   node scripts/detect-time-bombs.mjs --days 90 --filter lib/healthcare
//
// Exit codes: 0 = no bombs found, 1 = bombs found, 2 = harness failure.
// Intended for a SCHEDULED job, not per-PR: it runs the suite once per horizon
// plus a baseline, so it is deliberately not on the critical path of a merge.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = path.join(REPO_ROOT, "apps", "web");
const VITEST_BIN = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");

function parseArgs(argv) {
  const options = { days: [90], filter: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--days") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      options.days = raw
        .split(",")
        .map((value) => Number.parseFloat(value.trim()))
        .filter((value) => Number.isFinite(value) && value !== 0);
      if (options.days.length === 0) {
        throw new Error(`--days needs at least one non-zero number (got "${raw}")`);
      }
    } else if (argv[i] === "--filter") {
      options.filter = argv[i + 1] ?? "";
      i += 1;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      options.help = true;
    }
  }
  return options;
}

/**
 * Run the suite once and return the set of failing test ids.
 *
 * Uses vitest's JSON reporter rather than scraping stdout: the human reporter's
 * shape is not a contract, and a parser that silently matches nothing would
 * report "no bombs" — the worst possible failure for a guard whose whole job is
 * to notice something.
 */
async function runSuite({ shiftDays, filter, outFile }) {
  // Invoke vitest's entry directly with the current node binary rather than
  // going through `pnpm` + a shell. On Windows `pnpm` needs `shell: true`, which
  // concatenates arguments instead of escaping them — so a `--filter` value
  // would be interpreted by the shell. This form takes no shell at all.
  const args = [VITEST_BIN, "run", "--reporter=json", `--outputFile=${outFile}`];
  if (filter) args.push(filter);

  const env = { ...process.env };
  if (shiftDays) env.DPF_CLOCK_SHIFT_DAYS = String(shiftDays);
  else delete env.DPF_CLOCK_SHIFT_DAYS;

  const label = shiftDays ? `+${shiftDays}d` : "baseline";
  process.stdout.write(`[time-bombs] running suite (${label})…\n`);

  const { exitCode, signal, spawnError } = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: WEB_DIR,
      env,
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("close", (code, receivedSignal) =>
      resolve({ exitCode: code ?? 1, signal: receivedSignal, spawnError: null }),
    );
    child.on("error", (error) => resolve({ exitCode: 1, signal: null, spawnError: error }));
  });

  let report;
  try {
    report = JSON.parse(await readFile(outFile, "utf8"));
  } catch (error) {
    // Report HOW the child died, not just that no report showed up. The two
    // causes look identical from the missing file alone and need opposite
    // responses: `signal` set (usually SIGKILL/SIGTERM) means the run was killed
    // from outside — a job timeout or the OOM killer under memory pressure, so
    // the suite is fine and the harness needs more room; a non-zero `exitCode`
    // with no signal means vitest itself failed and the suite is the problem.
    // Without this distinction the message reads "the run produced no parseable
    // output" for both, which is where the diagnosis stalls.
    const cause = spawnError
      ? `could not spawn vitest: ${spawnError.message}`
      : signal
        ? `vitest was KILLED by ${signal} — an external timeout or the OOM killer, not a test failure`
        : `vitest exited ${exitCode} without writing the report`;
    throw new Error(
      `could not read the ${label} JSON report — ${cause}, so its result cannot ` +
        `be trusted (${String(error)})`,
    );
  }

  const failures = new Set();
  for (const suite of report.testResults ?? []) {
    for (const test of suite.assertionResults ?? []) {
      if (test.status === "failed") {
        failures.add(`${suite.name ?? "(unknown file)"} :: ${test.fullName ?? test.title}`);
      }
    }
  }
  return { failures, exitCode, total: report.numTotalTests ?? 0 };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/detect-time-bombs.mjs [--days 30,90,365] [--filter <path>]\n",
    );
    return 0;
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "dpf-time-bombs-"));
  try {
    const baseline = await runSuite({
      shiftDays: 0,
      filter: options.filter,
      outFile: path.join(workDir, "baseline.json"),
    });

    if (baseline.total === 0) {
      process.stderr.write(
        "[time-bombs] the baseline run reported ZERO tests — the harness is broken, " +
          "not the clock. Refusing to report a clean result.\n",
      );
      return 2;
    }

    // A red baseline is not this job's business, but it must be said out loud:
    // silently subtracting pre-existing failures could hide a bomb that is
    // already failing for a second reason.
    if (baseline.failures.size > 0) {
      process.stdout.write(
        `[time-bombs] note: ${baseline.failures.size} test(s) already fail unshifted; ` +
          "they are excluded from the diff below and need fixing on their own merits.\n",
      );
    }

    const bombs = [];
    for (const days of options.days) {
      const shifted = await runSuite({
        shiftDays: days,
        filter: options.filter,
        outFile: path.join(workDir, `shift-${days}.json`),
      });

      if (shifted.total === 0) {
        process.stderr.write(`[time-bombs] the +${days}d run reported ZERO tests — aborting.\n`);
        return 2;
      }

      for (const id of shifted.failures) {
        if (!baseline.failures.has(id)) bombs.push({ days, id });
      }
    }

    if (bombs.length === 0) {
      process.stdout.write(
        `[time-bombs] clean — ${baseline.total} tests pass at every horizon checked ` +
          `(+${options.days.join("d, +")}d).\n`,
      );
      return 0;
    }

    process.stdout.write(`\n[time-bombs] ${bombs.length} TIME BOMB(S) FOUND\n\n`);
    for (const { days, id } of bombs) {
      process.stdout.write(`  detonates within +${days}d:  ${id}\n`);
    }
    process.stdout.write(
      "\nEach passes against the current clock and fails against a future one, so each " +
        "will go red on a known date and stay red — blocking every PR if it sits on a " +
        "required shard.\n" +
        "Fix: pin the clock in the enclosing describe " +
        '(`vi.useFakeTimers().setSystemTime("…")` + `afterEach(() => vi.useRealTimers())`), ' +
        "or make the fixture relative to now.\n",
    );
    return 1;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`[time-bombs] harness failure: ${error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  });

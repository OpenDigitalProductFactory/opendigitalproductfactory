#!/usr/bin/env node
// Test clock-bomb guard (BI-E104FBCC).
//
// THE FAILURE THIS PREVENTS
//
// A test fixture pins a hardcoded date — `expiresAt: new Date("2026-08-01T15:00:00Z")`
// — and the code under test rejects an expiry that is not in the future. The test
// passes for months, then wall-clock crosses that instant and it fails on EVERY open
// PR at once. It is not a flake, and no PR caused it. Twice already: #3834
// (mcp-api-token rotation) and the care-intake repository test that motivated this.
//
// TWO DESIGN CONSTRAINTS, BOTH LEARNED THE HARD WAY
//
// 1. The rule must be TIME-INDEPENDENT. "Flag dates in the future" would make the
//    guard itself a clock bomb: its verdict would change with the calendar, so a
//    clean tree could go red overnight and a planted bomb would go quiet the moment
//    it detonated. This guard never compares anything to the current time. It flags a
//    pattern — a hardcoded absolute date bound to a field whose semantics REQUIRE a
//    future value, in a file that never pins the clock — which reads identically on
//    every run forever.
//
// 2. The rule must be DIFF-SCOPED. Measured against the whole repo, the pattern above
//    matches 255 fixtures across 125 files. Most are legitimate: `2099-01-01`
//    sentinels that will never detonate, and already-past dates that deliberately
//    exercise the expired branch. Shipping that as a repo-wide gate would require a
//    125-file baseline — a silent allowlist that hides the real ones.
//
//    So this guard only inspects test files the current change actually touches. That
//    is the division the backlog item asks for: the guard stops NEW bombs, and a
//    one-time audit clears the planted ones. It also means the guard needs no baseline
//    file to drift out of date.
//
// HOW TO FIX A FINDING
//
//   1. Pin the clock in the enclosing describe — `vi.useFakeTimers()` plus
//      `setSystemTime(...)` — which is what neighbouring suites usually already do.
//   2. Or make the fixture relative: `new Date(Date.now() + 3_600_000)`.
//   3. Or, if the date genuinely must be absolute and unpinned (a far-future sentinel,
//      or a deliberately-expired fixture), annotate the line with
//      `clock-bomb-guard: allow <reason>` so the exemption is stated, not silent.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_FILE = /\.(test|spec)\.[cm]?tsx?$/;

/** An absolute calendar date literal: "YYYY-MM-DD" with an optional time part. */
const DATE_LITERAL = /["'`]\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:[T ][^"'`]*)?["'`]/;

/**
 * Identifiers whose semantics require the value to lie in the future. These are the
 * domains the audit found real bombs in: credential expiry, certificate validity,
 * effectivity/deployment windows, and scheduling deadlines.
 */
const FUTURE_REQUIRING =
  /\b(expires?|expiry|expiresAt|expiresOn|validUntil|validTo|validThrough|notAfter|deadline|dueAt|dueDate|endsAt|windowEnd|scheduledFor|renewAt|nextRunAt|effectiveTo|activeUntil)\b/i;

/**
 * Any of these anywhere in the file means the author controls the clock.
 *
 * Fake timers are only one of the two idioms in this repo, and assuming they were the
 * only one is a mistake worth naming: the audit's nearest-term "bomb"
 * (lib/auth/edge-node-mtls.test.ts, a certificate expiring 16 days out) turned out to
 * be perfectly safe, because `resolveEdgeNodeMtls` takes an explicit `now` and the
 * test passes a fixed one. The code never reads the wall clock. Flagging that file
 * would have pushed an author to "fix" a test that was already correct — so explicit
 * clock injection counts as control just as much as `useFakeTimers` does.
 */
const CLOCK_PINNED =
  /useFakeTimers|setSystemTime|MockDate|vi\.setSystemTime|jest\.setSystemTime|\bnow\s*:|\basOf\b|\breferenceDate\b|\bclock\s*:/;

const ALLOW_MARKER = /clock-bomb-guard:\s*allow/;

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    return error.stdout?.toString() ?? "";
  }
}

/** Reject anything that is not a plain ref, so a hostile BASE_SHA cannot inject args. */
function safeRef(value, label) {
  if (!/^[\w./-]+$/.test(value)) {
    console.error(`[clock-bomb-guard] ${label} is not a plain git ref: ${value}`);
    process.exit(1);
  }
  return value;
}

function resolveBase() {
  const base = safeRef(process.env.BASE_SHA || "origin/main", "BASE_SHA");
  git("fetch", "--no-tags", "origin", "main");
  return base;
}

function changedTestFiles(base) {
  return git("diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => TEST_FILE.test(file))
    .filter((file) => existsSync(file));
}

/**
 * The whole rule, as a pure function of one file's source. Exported so the guard's
 * own test can exercise it without a git tree.
 */
export function findClockBombs(src) {
  // Deliberately file-scoped rather than describe-scoped: matching describe blocks by
  // brace counting is fragile, and a file that pins the clock at all has shown intent.
  if (CLOCK_PINNED.test(src)) return [];

  const findings = [];
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!DATE_LITERAL.test(line)) return;
    if (!FUTURE_REQUIRING.test(line)) return;
    if (ALLOW_MARKER.test(line)) return;
    if (i > 0 && ALLOW_MARKER.test(lines[i - 1])) return;
    findings.push({ line: i + 1, text: line.trim().slice(0, 120) });
  });
  return findings;
}

/**
 * Line numbers this change ADDED to `file`, parsed from a zero-context diff.
 *
 * Scoping to changed FILES is not enough. Measured repo-wide, the pattern matches 185
 * fixtures across 93 files — overwhelmingly dates already in the past, which are
 * legitimate. If touching one of those files for an unrelated reason fired the guard
 * on lines the author never wrote, the guard would block unrelated work and be
 * disabled within a week. Only lines this change introduced are its business.
 */
function addedLines(file, base) {
  const added = new Set();
  const diff = git("diff", "-U0", `${base}...HEAD`, "--", file);
  let next = 0;
  for (const line of diff.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+")) added.add(next++);
    else if (!line.startsWith("-") && !line.startsWith("\\")) next++;
  }
  return added;
}

function findingsFor(file, base) {
  const findings = findClockBombs(readFileSync(file, "utf8"));
  if (findings.length === 0) return findings;
  const added = addedLines(file, base);
  return findings.filter((f) => added.has(f.line));
}

function main() {
  const base = resolveBase();
  const files = changedTestFiles(base);
  if (files.length === 0) {
    console.log("✓ Clock-bomb guard: this change touches no test files.");
    return;
  }

  const offenders = [];
  for (const file of files) {
    const findings = findingsFor(file, base);
    if (findings.length) offenders.push({ file, findings });
  }

  if (offenders.length === 0) {
    console.log(
      `✓ No unpinned future-requiring date fixtures added in ${files.length} changed test file(s).`,
    );
    return;
  }

  const total = offenders.reduce((n, o) => n + o.findings.length, 0);
  console.error(
    `✗ ${total} hardcoded date fixture(s) in ${offenders.length} changed test file(s) bind a future-requiring field with no pinned clock.`,
  );
  console.error("  These pass until wall-clock crosses them, then fail on every open PR at once.\n");
  for (const o of offenders) {
    console.error(`  ${o.file}`);
    for (const f of o.findings) console.error(`    L${f.line}  ${f.text}`);
  }
  console.error("\n  Fix: pin the clock (vi.useFakeTimers + setSystemTime), or make the fixture");
  console.error("  relative (new Date(Date.now() + ...)), or annotate the line with");
  console.error("  `clock-bomb-guard: allow <reason>` to state the exemption.");
  process.exitCode = 1;
}

// Only sweep when run as a command. Importing this module (the guard's own test does)
// must not shell out to git or set an exit code.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}

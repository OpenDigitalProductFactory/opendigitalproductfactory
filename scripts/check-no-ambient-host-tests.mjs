#!/usr/bin/env node
// Ambient-host-state guard for unit tests — BI-95A83B47 (M7, late-defect
// detection hardening plan).
//
// THE FAILURE THIS PREVENTS
//
// A unit test silently depends on the machine it happens to run on, so its
// verdict changes with the host instead of the code. Twice already:
//   - BI-EFA383AA: self-upgrade.test.ts exercised the real host-memory guard,
//     which reads os.freemem() — 49 false failures on a busy macOS host whose
//     free memory dipped below the floor. No code was wrong.
//   - BI-BFDCE0A9: a test needed an ambient Postgres to be listening — green in
//     CI (where the service exists), red in the DB-less local gate. Same tree,
//     two verdicts.
//
// THE RULE
//
// A test file may not reach for ambient host state without either (a) injecting
// the dependency through a seam, (b) mocking the module that probes it, or
// (c) self-gating so the suite SKIPS when the resource is absent instead of
// failing. The guard flags four precise marker categories and suppresses each
// category when the file demonstrates the corresponding control — mirroring
// scripts/check-test-clock-bombs.mjs, where explicit injection counts as
// control just as much as mocking does. Precision beats recall: an
// over-reporting measure is a defect, so each pattern is scoped to the shapes
// that actually escaped, not to everything that smells host-flavoured.
//
// MARKER CATEGORIES (and the control that clears each)
//
//   db-client      `new PrismaClient(` / `new pg.Client(` in a test file.
//   db-url         hardcoded connection-string fallback:
//                  `process.env.DATABASE_URL ?? "postgresql://..."` — the test
//                  will try to CONNECT even where no DB was declared.
//     control: the house DB-gating idioms — `describe.skipIf(...)`,
//     `const describeDatabase = databaseUrl ? describe : describe.skip`,
//     a reachability probe + `ctx.skip()`, an `if (!DATABASE_URL) return`
//     early guard, or `vi.mock(...)` of the prisma/pg/db module.
//   host-probe     a real call to os.freemem()/os.totalmem(), or reading
//                  "/proc/meminfo" — the BI-EFA383AA shape.
//     control: injecting the seam the BI-EFA383AA fix added to
//     apps/web/lib/self-upgrade/host-memory-preflight.ts (`deps.readMeminfo` /
//     `deps.osFreeMemoryBytes`, or any `freemem:`/`totalmem:` dep property), or
//     `vi.mock("node:os")` / `vi.mock(".../host-memory-preflight")`.
//   host-exec      child_process exec/spawn of docker/psql/pg_dump/pg_restore
//                  from a unit test.
//     control: `vi.mock("node:child_process")`.
//
// A finding that is genuinely intentional can be annotated on (or immediately
// above) the line with `ambient-host-guard: allow <reason>` — the exemption is
// stated, not silent.
//
// WHAT THIS GUARD DOES NOT COVER
//
//   - Time/clock dependence — owned by scripts/check-test-clock-bombs.mjs.
//   - Network access, ambient env vars in general, or host filesystem paths
//     other than /proc/meminfo — only the shapes above have escaped so far.
//   - TRANSITIVE ambient dependence: it reads only the test file's own source,
//     so a test that imports a module which probes the host internally is
//     invisible unless the test names the probe. (BI-EFA383AA itself was
//     caught here because the fix left the probe's name in the mock.)
//   - Declared integration tests are scanned like any other file; their gating
//     idioms are exactly the controls above, so a correctly-gated suite passes.
//
// BASELINE (shrink-only, module-size idiom)
//
// scripts/ambient-host-test-baseline.txt freezes today's offender counts per
// file; a baselined file may only shrink, a new finding fails. Union-merge
// duplicates are tolerated with min-wins (never loosens). Regenerate with
// --update after removing findings.
//
//   node scripts/check-no-ambient-host-tests.mjs            # check (guard loop)
//   node scripts/check-no-ambient-host-tests.mjs --update   # re-baseline

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatTxtBudgetHeader, parseTxtBudgetHeader } from "./lib/baseline-budget.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "ambient-host-test-baseline.txt");

const DEFAULT_BUDGET = Object.freeze({ owner: "platform-architecture", expiry: "2026-11-16" });
const BUDGET_NOTE_LINES = Object.freeze([
  "Ambient-host-state test baseline (BI-95A83B47). Shrink-only: files leave by",
  "injecting the seam / mocking the probe / self-gating, never by expanding",
  "the baseline. Regenerate with: node scripts/check-no-ambient-host-tests.mjs --update",
]);

const ALLOW_MARKER = /ambient-host-guard:\s*allow/;
// Line comments never count as markers (test titles in string literals still
// do, but every category regex requires call/constructor syntax that a prose
// title does not produce).
const LINE_COMMENT = /^\s*(\/\/|\*|\/\*)/;

/**
 * The four categories. `marker` is line-scoped; `control` is file-scoped —
 * any control match anywhere in the file clears that category, following the
 * clock-bomb guard's "a file that pins the clock at all has shown intent".
 */
export const CATEGORIES = [
  {
    name: "db-client",
    marker: /new\s+PrismaClient\s*\(|new\s+(?:pg\s*\.\s*)?Client\s*\(\s*\{\s*connectionString/,
    control:
      /\bskipIf\s*\(|\brunIf\s*\(|describe\.skip\b|\bctx\.skip\s*\(|if\s*\(\s*!\s*[\w$.]*DATABASE_URL|vi\.mock\(\s*["'`][^"'`]*(?:prisma|\/db\b|\bpg\b)/,
    fix:
      "self-gate the suite (describe.skipIf(!process.env.DATABASE_URL), the databaseUrl ? describe : describe.skip idiom, or a reachability probe + ctx.skip()), or mock the client module",
  },
  {
    name: "db-url",
    marker: /process\.env\.DATABASE_URL\s*(?:\?\?|\|\|)\s*["'`]postgres/,
    control:
      /\bskipIf\s*\(|\brunIf\s*\(|describe\.skip\b|\bctx\.skip\s*\(|if\s*\(\s*!\s*[\w$.]*DATABASE_URL|vi\.mock\(\s*["'`][^"'`]*(?:prisma|\/db\b|\bpg\b)/,
    fix:
      "do not fall back to a hardcoded connection string — gate on the declared env var so a DB-less host SKIPS instead of connecting (BI-BFDCE0A9)",
  },
  {
    name: "host-probe",
    // A real CALL — `freemem()` / `os.totalmem()` — or a quoted /proc/meminfo
    // path. `totalmem: () => 1024` (dep injection) deliberately does not match.
    marker: /\b(?:freemem|totalmem)\s*\(\s*\)|["'`]\/proc\/meminfo["'`]/,
    control:
      /\breadMeminfo\s*:|\bosFreeMemoryBytes\s*:|\b(?:freemem|totalmem)\s*:|vi\.mock\(\s*["'`](?:node:)?os["'`]|vi\.mock\(\s*["'`][^"'`]*host-memory-preflight/,
    fix:
      "inject the seam from apps/web/lib/self-upgrade/host-memory-preflight.ts (deps.readMeminfo / deps.osFreeMemoryBytes) or vi.mock the probe module, as the BI-EFA383AA fix does",
  },
  {
    name: "host-exec",
    marker:
      /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*["'`](?:docker|psql|pg_dump|pg_restore)\b/,
    control: /vi\.mock\(\s*["'`](?:node:)?child_process/,
    fix: "mock node:child_process, or move the test to a gated integration tier",
  },
];

/**
 * The whole rule as a pure function of one file's source. Exported so the
 * guard's own test can exercise it without a git tree.
 */
export function findAmbientHostMarkers(src) {
  const lines = String(src).split(/\r?\n/);
  const findings = [];
  for (const category of CATEGORIES) {
    if (category.control.test(src)) continue; // the file demonstrates control
    lines.forEach((line, i) => {
      if (!category.marker.test(line)) return;
      if (LINE_COMMENT.test(line)) return;
      if (ALLOW_MARKER.test(line)) return;
      if (i > 0 && ALLOW_MARKER.test(lines[i - 1])) return;
      findings.push({ line: i + 1, category: category.name, fix: category.fix, text: line.trim().slice(0, 120) });
    });
  }
  return findings.sort((a, b) => a.line - b.line);
}

/** Tracked unit-test files in scope. Guard self-tests (scripts/check-*.test.mjs)
 * are excluded: they hold red-case fixture strings by design. */
export function isInScope(file) {
  if (/^scripts\/check-[^/]*\.test\.mjs$/.test(file)) return false;
  return /^(?:apps|packages)\/.*\.test\.[cm]?tsx?$/.test(file) || /^scripts\/.*\.test\.mjs$/.test(file);
}

function listTestFiles() {
  const out = execFileSync("git", ["ls-files", "apps", "packages", "scripts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean).filter(isInScope);
}

/**
 * Parse `<path>\t<count>` lines. Union merges can duplicate a path; keep the
 * SMALLER count so a stale sibling never loosens the ratchet (min-wins, the
 * check-module-size.mjs idiom).
 */
export function parseBaseline(text) {
  const baseline = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    const [, file, countStr] = m;
    const count = Number(countStr);
    if (!(file in baseline) || count < baseline[file]) baseline[file] = count;
  }
  return baseline;
}

/** Diagnostic only — check mode tolerates duplicates via min-wins. */
export function findDuplicateBaselinePaths(text) {
  const seen = new Set();
  const dups = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    if (seen.has(m[1])) dups.add(m[1]);
    else seen.add(m[1]);
  }
  return [...dups].sort();
}

function serializeBaseline(counts, budget = DEFAULT_BUDGET) {
  const header = formatTxtBudgetHeader({ ...budget, noteLines: BUDGET_NOTE_LINES });
  const lines = Object.keys(counts)
    .sort()
    .map((k) => `${k}\t${counts[k]}`);
  return `${header}${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function scan() {
  const offenders = new Map();
  for (const file of listTestFiles()) {
    const abs = join(REPO_ROOT, file);
    if (!existsSync(abs)) continue;
    const findings = findAmbientHostMarkers(readFileSync(abs, "utf8"));
    if (findings.length) offenders.set(file, findings);
  }
  return offenders;
}

function main() {
  const offenders = scan();

  if (process.argv.includes("--update")) {
    let budget = DEFAULT_BUDGET;
    try {
      const existing = parseTxtBudgetHeader(readFileSync(BASELINE_PATH, "utf8"));
      if (existing.owner && existing.expiry) budget = existing;
    } catch {
      // no existing baseline — defaults apply
    }
    const counts = Object.fromEntries([...offenders].map(([f, list]) => [f, list.length]));
    writeFileSync(BASELINE_PATH, serializeBaseline(counts, budget));
    console.log(`Wrote ambient-host test baseline: ${offenders.size} file(s) with findings.`);
    process.exit(0);
  }

  let baseline = {};
  let baselineText = "";
  try {
    baselineText = readFileSync(BASELINE_PATH, "utf8");
    baseline = parseBaseline(baselineText);
  } catch {
    console.error(
      `Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-no-ambient-host-tests.mjs --update`,
    );
    process.exit(1);
  }

  const duplicates = findDuplicateBaselinePaths(baselineText);
  if (duplicates.length > 0) {
    console.warn(
      `Ambient-host baseline has ${duplicates.length} union-merge duplicate path(s); using the smaller count ` +
        `for each (never loosens). Optional cleanup: node scripts/check-no-ambient-host-tests.mjs --update`,
    );
  }

  const failures = [];
  for (const [file, findings] of offenders) {
    const budgeted = baseline[file] ?? 0;
    if (findings.length > budgeted) failures.push({ file, findings, budgeted });
  }

  if (failures.length === 0) {
    console.log(
      `✓ Ambient-host guard: no unit test depends on ambient host state beyond the baseline ` +
        `(${offenders.size} baselined file(s)).`,
    );
    return;
  }

  const total = failures.reduce((n, f) => n + f.findings.length, 0);
  console.error(
    `✗ ${total} ambient-host-state marker(s) in ${failures.length} unit-test file(s) exceed the baseline.`,
  );
  console.error(
    "  A test that reads the real host (DB, memory, docker) passes or fails with the MACHINE, not the code",
  );
  console.error("  (BI-EFA383AA: 49 false failures; BI-BFDCE0A9: green in CI, red in the DB-less gate).\n");
  for (const f of failures) {
    console.error(`  ${f.file} (${f.findings.length} finding(s), baseline ${f.budgeted})`);
    for (const x of f.findings) {
      console.error(`    L${x.line} [${x.category}]  ${x.text}`);
      console.error(`      fix: ${x.fix}`);
    }
  }
  console.error(
    "\n  Or, if the dependence is genuinely intentional, annotate the line with",
  );
  console.error("  `ambient-host-guard: allow <reason>` to state the exemption.");
  process.exitCode = 1;
}

// Only sweep when run as a command. Importing this module (the guard's own
// test does) must not shell out to git or set an exit code.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

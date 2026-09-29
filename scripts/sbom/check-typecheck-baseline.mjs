#!/usr/bin/env node
// scripts/sbom/check-typecheck-baseline.mjs
//
// Typecheck program ratchet (plan 2026-09-08 M11 step 4 and §7). It reads what
// the apps/web production program actually checked (the file list and the
// `--extendedDiagnostics` numbers from the same tsc run, recorded by
// scripts/run-tsc.mjs under DPF_TSC_PROGRAM_REPORT) and splits every checked
// line into one bucket:
//
//   project     apps/web source the tsconfig includes. A diff explains every
//               one of these lines by construction, so they are REPORTED only.
//   generated   first-party generated code (Prisma client, `.next/types`).
//               Explained by a schema or route diff. REPORTED only.
//   outside     first-party source from other directories (packages/db/src,
//               scripts/lib, ...). Explained by a diff to that directory, so
//               the LINES are reported; a NEW source directory is a program
//               shape change no diff line explains, and FAILS until accepted.
//   excluded    apps/web files the production tsconfig excludes (tests, e2e,
//               test-support, scripts, vitest config) that an import pulled
//               back into the production program. HARD budget.
//   dependency  TypeScript's lib files plus everything under node_modules.
//               No first-party diff explains these. HARD budget, with a 1%
//               tolerance so a patch bump of a typed dependency does not fail.
//
// Check time is recorded, never gated: wall-clock varies by machine and load.
// Budgets only go down (--update-baseline); raising one takes a recorded
// reason (--raise-budget "<reason>"), exactly like check-sbom-drift.mjs.
//
// Usage:
//   node scripts/sbom/check-typecheck-baseline.mjs --report <run-tsc report>   # gate (CI Typecheck job)
//   node scripts/sbom/check-typecheck-baseline.mjs --measure                   # run the web typecheck, then gate
//   ... --update-baseline                        # record the current program; budgets only go down
//   ... --raise-budget "<reason>"                # move budgets to current and record why
//   ... --write-analysis <file>                  # also save the analysis (CI uploads it)
//   ... --analysis <file>                        # judge a saved analysis instead of a report
// Measuring runs a full web typecheck (about 5.5 GB peak); on a shared host
// wrap --measure in `flock /tmp/dpf-heavy.lock`.

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE_PATH = join(ROOT, "sbom", "typecheck-baseline.json");
export const PROGRAM_DIR = "apps/web";
export const PROGRAM_TSCONFIG = `${PROGRAM_DIR}/tsconfig.json`;

/** First-party paths whose content a generator writes; explained by the generator's input diff. */
export const GENERATED_PREFIXES = ["packages/db/generated/", `${PROGRAM_DIR}/.next/`];

/** Budgeted counts, lower is better. */
export const BUDGETED = ["dependencyLines", "excludedLines"];

/** Growth allowed within a budget before the gate fails, as a fraction of the budget. */
export const TOLERANCE = { dependencyLines: 0.01, excludedLines: 0 };

/** `--extendedDiagnostics` keys recorded for reference. None is gated. */
export const RECORDED_DIAGNOSTICS = [
  "Files",
  "Lines of Library",
  "Lines of Definitions",
  "Lines of TypeScript",
  "Lines of JavaScript",
  "Lines of JSON",
  "Identifiers",
  "Symbols",
  "Types",
  "Instantiations",
  "Memory used",
  "Check time",
  "Total time",
];

const BASELINE_NOTE =
  "Typecheck program ratchet for scripts/sbom/check-typecheck-baseline.mjs (plan 2026-09-08 M11 step 4). `budgets` are ceilings on the lines no first-party diff explains: `dependencyLines` (TypeScript lib + node_modules; 1% tolerance) and `excludedLines` (apps/web files the production tsconfig excludes but an import pulls back in). `acceptedOutsideSources` is the set of first-party directories outside apps/web the program may pull source from; a new one fails. `measured` is the reference program at the last update, including tsc's own --extendedDiagnostics; Check time is informational. --update-baseline only lowers budgets; raising one needs --raise-budget \"<reason>\", recorded in `lastBudgetRaise`. See docs/architecture/dependency-reduction-routine.md.";

// ── pure analysis ────────────────────────────────────────────────────────────

/** Line count as tsc's `Lines of ...` counts it: line starts, so an empty file is 1. */
export function countLines(text) {
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      n++;
    } else if (c === 10 || c === 0x2028 || c === 0x2029) {
      n++;
    }
  }
  return n;
}

/** tsconfig `exclude` pattern -> RegExp over a path relative to the tsconfig directory. */
export function excludePatternToRegExp(pattern) {
  const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*" && p[i + 2] === "/") {
      re += "(?:.*/)?";
      i += 2;
    } else if (c === "*" && p[i + 1] === "*") {
      re += ".*";
      i += 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // A pattern names a file or a directory and everything under it.
  return new RegExp(`^${re}(?:/.*)?$`);
}

/** Directory a first-party file outside the program directory is attributed to. */
export function outsideSourceOf(relPath) {
  const parts = relPath.split("/");
  const dirs = parts.slice(0, -1);
  if (["apps", "packages", "services"].includes(dirs[0])) return dirs.slice(0, 3).join("/") || relPath;
  return dirs[0] ?? relPath;
}

/** npm package that owns a node_modules path (the innermost node_modules segment). */
export function packageOf(relPath) {
  const idx = relPath.lastIndexOf("node_modules/");
  const rest = relPath.slice(idx + "node_modules/".length).split("/");
  return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}

/**
 * Classify each checked file. `files` are repo-relative posix paths (or
 * absolute paths outside the repo); `linesOf(path)` returns the line count.
 */
export function analyzeProgram({ files, linesOf, excludePatterns = [], programDir = PROGRAM_DIR }) {
  const excluded = excludePatterns.filter((p) => p !== "node_modules").map(excludePatternToRegExp);
  const totals = { files: files.length, lines: 0, project: 0, generated: 0, outside: 0, excludedLines: 0, library: 0, external: 0 };
  const outsideSources = {};
  const externalPackages = {};
  const excludedFiles = [];
  for (const file of files) {
    const n = linesOf(file);
    totals.lines += n;
    if (file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.startsWith("..")) {
      totals.external += n;
      externalPackages["(outside the repository)"] = (externalPackages["(outside the repository)"] ?? 0) + n;
    } else if (file.includes("node_modules/")) {
      if (/(^|\/)node_modules\/typescript\/lib\/lib\.[^/]*\.d\.ts$/.test(file)) {
        totals.library += n;
      } else {
        totals.external += n;
        const pkg = packageOf(file);
        externalPackages[pkg] = (externalPackages[pkg] ?? 0) + n;
      }
    } else if (GENERATED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      totals.generated += n;
    } else if (file.startsWith(`${programDir}/`)) {
      const inProgramDir = file.slice(programDir.length + 1);
      if (excluded.some((re) => re.test(inProgramDir))) {
        totals.excludedLines += n;
        excludedFiles.push(file);
      } else {
        totals.project += n;
      }
    } else {
      totals.outside += n;
      const source = outsideSourceOf(file);
      outsideSources[source] = (outsideSources[source] ?? 0) + n;
    }
  }
  totals.dependencyLines = totals.library + totals.external;
  return {
    totals,
    outsideSources: sortObject(outsideSources),
    externalPackages: sortObject(externalPackages),
    excludedFiles: excludedFiles.sort(),
  };
}

/** `Name:   123.45s` lines from `--extendedDiagnostics` -> { Name: number }. */
export function parseExtendedDiagnostics(lines) {
  const out = {};
  for (const line of lines) {
    const m = /^([A-Za-z][A-Za-z /-]*?):\s+([\d.]+)([a-zA-Z]*)\s*$/.exec(line.trim());
    if (m && RECORDED_DIAGNOSTICS.includes(m[1])) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** Budgets vs current. A total with no numeric budget is not gated. */
export function evaluateBudgets(totals, budgets = {}) {
  const over = [];
  const tolerated = [];
  const under = [];
  for (const key of BUDGETED) {
    const budget = budgets?.[key];
    if (typeof budget !== "number") continue;
    const current = totals[key];
    const ceiling = Math.floor(budget * (1 + (TOLERANCE[key] ?? 0)));
    if (current > ceiling) over.push({ key, current, budget, ceiling });
    else if (current > budget) tolerated.push({ key, current, budget, ceiling });
    else if (current < budget) under.push({ key, current, budget });
  }
  return { over, tolerated, under };
}

/** Next budgets: only down, unless `raise`, which moves each to the current total. */
export function nextBudgets(totals, budgets = {}, { raise = false } = {}) {
  const out = {};
  for (const key of BUDGETED) {
    const prev = budgets?.[key];
    out[key] = typeof prev !== "number" || raise ? totals[key] : Math.min(prev, totals[key]);
  }
  return out;
}

/** Outside source directories against the accepted set. */
export function evaluateOutsideSources(outsideSources = {}, accepted = []) {
  const acceptedSet = new Set(accepted);
  const current = Object.keys(outsideSources);
  return {
    added: current.filter((s) => !acceptedSet.has(s)).sort(),
    gone: accepted.filter((s) => !Object.hasOwn(outsideSources, s)).sort(),
  };
}

/**
 * Next accepted outside-source set: without `raise` it only shrinks (a new
 * directory stays unaccepted); with `raise`, or with no prior set, it becomes
 * the current set.
 */
export function nextAcceptedSources(outsideSources = {}, accepted, { raise = false } = {}) {
  const current = Object.keys(outsideSources).sort();
  if (raise || !Array.isArray(accepted)) return current;
  return current.filter((s) => accepted.includes(s));
}

/** Per-package line changes, largest growth first. */
export function packageDeltas(current = {}, previous = {}) {
  const names = new Set([...Object.keys(current), ...Object.keys(previous)]);
  return [...names]
    .map((name) => ({ name, delta: (current[name] ?? 0) - (previous[name] ?? 0) }))
    .filter((x) => x.delta !== 0)
    .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));
}

function sortObject(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

// ── I/O ──────────────────────────────────────────────────────────────────────

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function currentExcludePatterns() {
  // tsconfig.json is JSONC in general; this one is plain JSON, and a parse
  // failure here should be loud rather than silently ungated.
  return readJson(join(ROOT, PROGRAM_TSCONFIG)).exclude ?? [];
}

function assertProductionProgram(report) {
  const dir = relative(ROOT, report.cwd).split(sep).join("/");
  // The recorded tsc arguments; strict: false because tsc has many options this ignores.
  const { values } = parseArgs({
    args: report.args ?? [],
    strict: false,
    allowPositionals: true,
    options: { project: { type: "string", short: "p" } },
  });
  const project = typeof values.project === "string" ? values.project : "tsconfig.json";
  if (dir !== PROGRAM_DIR || !["tsconfig.json", "./tsconfig.json"].includes(project)) {
    throw new Error(`report is for ${dir}/${project}, not ${PROGRAM_TSCONFIG}`);
  }
  if (report.exitCode !== 0) {
    throw new Error(`the recorded tsc run exited ${report.exitCode}; fix the type errors first`);
  }
}

/** Build the analysis from a run-tsc program report. */
function analysisFromReport(report, excludePatterns) {
  assertProductionProgram(report);
  const toRel = (abs) => {
    const rel = relative(ROOT, abs).split(sep).join("/");
    return rel.startsWith("..") ? abs : rel;
  };
  const absOf = new Map();
  const files = report.files.map((abs) => {
    const rel = toRel(abs);
    absOf.set(rel, abs);
    return rel;
  });
  const analysis = analyzeProgram({
    files,
    excludePatterns,
    linesOf: (rel) => countLines(readFileSync(absOf.get(rel), "utf8")),
  });
  return { ...analysis, tsc: parseExtendedDiagnostics(report.output ?? []) };
}

function measure() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-tsc-program-"));
  const reportPath = join(dir, "report.json");
  try {
    process.stdout.write("Measuring: pnpm --filter web typecheck (full compile, about 5.5 GB peak)...\n");
    const run = spawnSync("pnpm", ["--filter", "web", "typecheck"], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, DPF_TSC_PROGRAM_REPORT: reportPath },
      shell: process.platform === "win32",
    });
    if (run.status !== 0) throw new Error(`web typecheck exited ${run.status ?? run.signal}`);
    return readJson(reportPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sign(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function main() {
  const { values } = parseArgs({
    options: {
      report: { type: "string" },
      analysis: { type: "string" },
      measure: { type: "boolean" },
      "update-baseline": { type: "boolean" },
      "raise-budget": { type: "string" },
      "write-analysis": { type: "string" },
    },
  });
  const raiseReason = values["raise-budget"]?.trim();
  if (values["raise-budget"] !== undefined && !raiseReason) {
    process.stderr.write('::error::--raise-budget needs a reason: --raise-budget "<what the growth retires, or why nothing can>"\n');
    process.exit(1);
  }

  const baseline = (() => {
    try {
      return readJson(BASELINE_PATH);
    } catch {
      return null;
    }
  })();
  // The baseline's recorded patterns still count after someone edits tsconfig
  // exclude, so dropping an exclude cannot quietly re-admit the tests.
  const excludePatterns = [...new Set([...(baseline?.excludePatterns ?? []), ...currentExcludePatterns()])].sort();

  let analysis;
  if (values.analysis) {
    analysis = readJson(values.analysis);
  } else if (values.report || values.measure) {
    const report = values.report ? readJson(values.report) : measure();
    analysis = analysisFromReport(report, excludePatterns);
  } else {
    process.stderr.write("::error::Pass --report <file> (from DPF_TSC_PROGRAM_REPORT), --analysis <file>, or --measure.\n");
    process.exit(1);
  }
  if (values["write-analysis"]) writeFileSync(values["write-analysis"], `${JSON.stringify(analysis, null, 2)}\n`);

  const t = analysis.totals;
  if (values["update-baseline"] || raiseReason) {
    const budgets = nextBudgets(t, baseline?.budgets, { raise: Boolean(raiseReason) });
    const lastBudgetRaise = raiseReason ? { reason: raiseReason, budgets } : baseline?.lastBudgetRaise;
    const next = {
      note: BASELINE_NOTE,
      program: PROGRAM_TSCONFIG,
      budgets,
      ...(lastBudgetRaise ? { lastBudgetRaise } : {}),
      // Like the budgets, the accepted set and the recorded exclude patterns
      // only tighten on --update-baseline; widening them takes a reason.
      acceptedOutsideSources: nextAcceptedSources(analysis.outsideSources, baseline?.acceptedOutsideSources, { raise: Boolean(raiseReason) }),
      excludePatterns: raiseReason ? currentExcludePatterns().filter((p) => p !== "node_modules").sort() : excludePatterns.filter((p) => p !== "node_modules"),
      measured: {
        totals: t,
        tsc: analysis.tsc ?? {},
        outsideSources: analysis.outsideSources,
        excludedFiles: analysis.excludedFiles,
        externalPackages: analysis.externalPackages,
      },
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(`Baseline updated: ${BASELINE_PATH}\n  budgets=${JSON.stringify(budgets)}\n`);
    const unaccepted = Object.keys(analysis.outsideSources).filter((s) => !next.acceptedOutsideSources.includes(s));
    const overBudget = BUDGETED.filter((key) => t[key] > budgets[key]);
    if (unaccepted.length || overBudget.length) {
      process.stdout.write(
        `  Still failing (--update-baseline never widens): ${[...overBudget, ...unaccepted].join(", ")}. Use --raise-budget "<reason>" if the growth is deliberate.\n`,
      );
    }
    return;
  }

  if (!baseline) {
    process.stderr.write(`::error::No typecheck baseline at ${BASELINE_PATH}. Create one with --measure --update-baseline.\n`);
    process.exit(1);
  }

  const m = baseline.measured?.totals ?? {};
  const d = (key) => sign(t[key] - (m[key] ?? 0));
  const tsc = analysis.tsc ?? {};
  const mt = baseline.measured?.tsc ?? {};
  const report = [
    `Typecheck program report for ${PROGRAM_TSCONFIG} (vs baseline):`,
    `  files checked        : ${t.files} (${d("files")})`,
    `  lines checked        : ${t.lines} (${d("lines")})`,
    `    project            : ${t.project} (${d("project")})  explained by the diff`,
    `    generated          : ${t.generated} (${d("generated")})  explained by the generator input`,
    `    outside apps/web   : ${t.outside} (${d("outside")})  explained by the diff`,
    `    excluded, imported : ${t.excludedLines} (${d("excludedLines")}, budget ${baseline.budgets?.excludedLines})`,
    `    dependency         : ${t.dependencyLines} (${d("dependencyLines")}, budget ${baseline.budgets?.dependencyLines}, tolerance ${TOLERANCE.dependencyLines * 100}%)`,
  ];
  if (tsc["Check time"] !== undefined) {
    report.push(`  check time           : ${tsc["Check time"]}s (baseline ${mt["Check time"] ?? "?"}s; informational, varies by machine)`);
  }
  const grew = packageDeltas(analysis.externalPackages, baseline.measured?.externalPackages).filter((x) => x.delta > 0).slice(0, 10);
  if (grew.length) report.push(`  dependency growth    : ${grew.map((x) => `${x.name} ${sign(x.delta)}`).join(", ")}`);
  process.stdout.write(`${report.join("\n")}\n\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${report.join("\n")}\n\`\`\`\n`, { flag: "a" });
    } catch {
      // The summary is a convenience; the log above carries the same report.
    }
  }

  let failed = false;
  const sources = evaluateOutsideSources(analysis.outsideSources, baseline.acceptedOutsideSources);
  if (sources.added.length) {
    process.stderr.write(
      [
        `::error::The web production program now pulls source from ${sources.added.join(", ")}.`,
        ...sources.added.map((s) => `    - ${s}: ${analysis.outsideSources[s]} lines`),
        "",
        "  A new first-party source directory is a program-shape change: from now on",
        "  every push checks all of it. Import from the package's public entry instead,",
        "  or, if the directory belongs in the program, accept it with a recorded reason",
        "  (the CI job uploads its analysis, so no local compile is needed):",
        '    node scripts/sbom/check-typecheck-baseline.mjs --analysis <typecheck-program-analysis.json> --raise-budget "<why>"',
        "",
      ].join("\n"),
    );
    failed = true;
  }

  const verdict = evaluateBudgets(t, baseline.budgets);
  if (verdict.over.length) {
    const newlyExcluded = analysis.excludedFiles.filter((f) => !(baseline.measured?.excludedFiles ?? []).includes(f));
    process.stderr.write(
      [
        `::error::Typecheck program over budget: ${verdict.over.map((o) => `${o.key} ${o.current} > ${o.ceiling}`).join(", ")}`,
        ...(newlyExcluded.length ? ["  Excluded files now imported by production code:", ...newlyExcluded.map((f) => `    - ${f}`)] : []),
        ...(grew.length ? [`  Largest dependency growth: ${grew.map((x) => `${x.name} ${sign(x.delta)}`).join(", ")}`] : []),
        "",
        "  These lines are checked on every push, and no first-party diff line explains",
        "  them. Drop the import or the dependency, or retire what it replaces. If the",
        "  growth is deliberate, raise the budget with a reason reviewers see in the diff",
        "  (the CI job uploads its analysis, so no local compile is needed):",
        '    node scripts/sbom/check-typecheck-baseline.mjs --analysis <typecheck-program-analysis.json> --raise-budget "<reason>"',
        "",
      ].join("\n"),
    );
    failed = true;
  }
  if (failed) process.exit(1);

  for (const tol of verdict.tolerated) {
    process.stdout.write(`::warning::${tol.key} ${tol.current} is above its budget ${tol.budget} but inside the tolerance (${tol.ceiling}). Growth accumulates: the next PR past ${tol.ceiling} fails.\n`);
  }
  if (verdict.under.length || sources.gone.length) {
    process.stdout.write(
      `Smaller than the baseline (${[...verdict.under.map((u) => `${u.key} ${u.current} < ${u.budget}`), ...sources.gone.map((s) => `${s} no longer pulled in`)].join(", ")}): lock the gain in with --update-baseline.\n`,
    );
  }
  process.stdout.write("OK: the typecheck program grew by no more than its diff explains.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`::error::check-typecheck-baseline: ${err.message}\n`);
    process.exit(1);
  }
}

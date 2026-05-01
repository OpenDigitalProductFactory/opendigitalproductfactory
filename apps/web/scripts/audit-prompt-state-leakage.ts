/**
 * Prompt state-leakage audit
 * (docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md).
 *
 * Walks every persona file under prompts/route-persona/ and prompts/specialist/
 * and runs the spec's §6 rules (PSL-001 through PSL-004). Static — no DB.
 * Read-only — no edits.
 *
 * Usage (local):
 *   pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts
 *
 * Usage (CI): wired into .github/workflows/audit-prompt-state-leakage.yml
 *
 * Output: JSON report on stdout. Exit code 0 if no findings, 1 if any error-level.
 *   --baseline <path>                       compare against a prior report; exit 1
 *                                            only if NEW error-level findings appear.
 *   --baseline-may-only-shrink-from <path>  fail if the current baseline added any
 *                                            keys vs. the path argument's baseline
 *                                            (shrink-only guard for PR review).
 *   --json-out <path>                       write report to file in addition to stdout.
 *   --help                                   print usage.
 */

import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

type Severity = "error" | "warn";
type InvariantId = "PSL-001" | "PSL-002" | "PSL-003" | "PSL-004";

interface Finding {
  invariantId: InvariantId;
  severity: Severity;
  file: string;        // repo-relative, forward slashes
  line: number;        // 1-based; display only, not part of finding identity
  column: number;      // 1-based; display only
  match: string;       // the matched substring (normalized)
  summary: string;
  detail: string;
}

interface Report {
  generatedAt: string;
  spec: string;
  rulesChecked: number;
  errorCount: number;
  warnCount: number;
  findings: Finding[];
}

const findings: Finding[] = [];

function repoRoot(): string {
  // walk up until pnpm-workspace.yaml found
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

const ROOT = repoRoot();

function normalizeMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function findingKey(f: Finding): string {
  return `${f.invariantId}::${f.file}::${normalizeMatch(f.match)}`;
}

// ─── Prompt enumeration ────────────────────────────────────────────────────

function listPromptFiles(): string[] {
  const out: string[] = [];
  for (const cat of ["route-persona", "specialist"] as const) {
    const dir = join(ROOT, "prompts", cat);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".prompt.md")) continue;
      out.push(`prompts/${cat}/${entry}`);
    }
  }
  return out.sort();
}

// ─── Rule implementations (added in Tasks 2–5) ────────────────────────────

// checkPsl001, checkPsl002, checkPsl003, checkPsl004 — added in subsequent tasks

// ─── Baseline diff (added in Task 6) ──────────────────────────────────────

// ─── Shrink-only guard (added in Task 7) ──────────────────────────────────

// ─── Main ──────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(
    `prompt state-leakage audit\n\n` +
    `Usage:\n` +
    `  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts [options]\n\n` +
    `Options:\n` +
    `  --baseline <path>                       compare against prior report\n` +
    `  --baseline-may-only-shrink-from <path>  shrink-only guard\n` +
    `  --json-out <path>                       also write report to file\n` +
    `  --help                                   print this message\n`,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  let baselinePath: string | null = null;
  let shrinkFromPath: string | null = null;
  let jsonOutPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline" && args[i + 1]) { baselinePath = args[i + 1]!; i++; }
    else if (args[i] === "--baseline-may-only-shrink-from" && args[i + 1]) { shrinkFromPath = args[i + 1]!; i++; }
    else if (args[i] === "--json-out" && args[i + 1]) { jsonOutPath = args[i + 1]!; i++; }
  }

  const absolutize = (p: string | null): string | null =>
    p && !p.match(/^([a-zA-Z]:[\\/]|\/)/) ? join(ROOT, p) : p;
  baselinePath = absolutize(baselinePath);
  shrinkFromPath = absolutize(shrinkFromPath);
  jsonOutPath = absolutize(jsonOutPath);

  // Run rule checks (no-op until Tasks 2–5 add them)
  const promptFiles = listPromptFiles();
  void promptFiles;

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;

  const report: Report = {
    generatedAt: new Date().toISOString(),
    spec: "docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md",
    rulesChecked: 4,
    errorCount,
    warnCount,
    findings: [...findings].sort((a, b) => findingKey(a).localeCompare(findingKey(b))),
  };

  console.log(JSON.stringify(report, null, 2));

  if (jsonOutPath) {
    writeFileSync(jsonOutPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.error(`[audit] wrote ${jsonOutPath}`);
  }

  let exitCode = 0;
  // Baseline diff and shrink-only guard wired in Tasks 6–7
  if (errorCount > 0 && !baselinePath) exitCode = 1;
  void baselinePath;
  void shrinkFromPath;

  process.exit(exitCode);
}

main();

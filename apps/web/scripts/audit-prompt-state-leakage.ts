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

// ─── PSL-001: stale future-state grant phrases ─────────────────────────────

const PSL_001_PATTERNS: Array<{ regex: RegExp; phrase: string }> = [
  { regex: /currently\s+\[\]/i, phrase: "currently []" },
  { regex: /pending follow-on assignment/i, phrase: "pending follow-on assignment" },
  { regex: /once the per-agent grant/i, phrase: "once the per-agent grant" },
  { regex: /will hold a curated set/i, phrase: "will hold a curated set" },
  { regex: /tools? the role expects to hold once granted/i, phrase: "tools the role expects to hold once granted" },
];

export function matchPsl001(body: string, file: string): Finding[] {
  const out: Finding[] = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { regex, phrase } of PSL_001_PATTERNS) {
      const m = line.match(regex);
      if (m && typeof m.index === "number") {
        out.push({
          invariantId: "PSL-001",
          severity: "error",
          file,
          line: i + 1,
          column: m.index + 1,
          match: m[0],
          summary: `[PSL-001] forbidden state phrase: "${phrase}"`,
          detail:
            `The phrase "${phrase}" tells the model that runtime grants are not yet available, even when the runtime delivers them. Remove this language. The runtime tool list is authoritative — describe behavior in the prompt, not state.\n\nSee docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md §6 PSL-001.`,
        });
      }
    }
  }
  return out;
}

function checkPsl001(promptFiles: string[]): void {
  for (const relPath of promptFiles) {
    const abs = join(ROOT, relPath);
    const text = readFileSync(abs, "utf8");
    for (const f of matchPsl001(text, relPath)) findings.push(f);
  }
}

// ─── PSL-002: unsourced grant enumeration ──────────────────────────────────

const TOOLS_HEADING_RE = /^#+\s*(?:Tools Available|Tool Use)\s*$/m;
const NEXT_HEADING_RE = /^#+\s+/m;
const GRANT_BULLET_RE =
  /^\s*[-*]\s+`?[a-z][a-z0-9_]*(?:_(?:read|write|create|execute|publish|emit|validate|provision|trigger|promote|triage))`?\b/m;
const REGISTRY_CITATION_RE = /packages\/db\/data\/agent_registry\.json/;

export function matchPsl002(body: string, file: string): Finding[] {
  const out: Finding[] = [];
  const headingMatch = body.match(TOOLS_HEADING_RE);
  if (!headingMatch || typeof headingMatch.index !== "number") return out;

  const sectionStart = headingMatch.index;
  const tail = body.slice(sectionStart + headingMatch[0].length);
  const nextH = tail.match(NEXT_HEADING_RE);
  const sectionEnd = nextH && typeof nextH.index === "number"
    ? sectionStart + headingMatch[0].length + nextH.index
    : body.length;
  const section = body.slice(sectionStart, sectionEnd);

  if (!GRANT_BULLET_RE.test(section)) return out;
  if (REGISTRY_CITATION_RE.test(section)) return out;

  // Compute line of the heading
  const before = body.slice(0, sectionStart);
  const lineNo = before.split(/\r?\n/).length;

  out.push({
    invariantId: "PSL-002",
    severity: "error",
    file,
    line: lineNo,
    column: 1,
    match: headingMatch[0].trim(),
    summary: `[PSL-002] '${headingMatch[0].trim()}' enumerates grants without citing packages/db/data/agent_registry.json`,
    detail:
      `A Tools Available / Tool Use section that lists grant-like bullets must cite the canonical grant source: packages/db/data/agent_registry.json. Without that anchor, the prompt is making a state claim that will rot when the registry changes.\n\nSee docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md §6 PSL-002. The marketing-specialist prompt at prompts/route-persona/marketing-specialist.prompt.md is the reference shape.`,
  });
  return out;
}

function checkPsl002(promptFiles: string[]): void {
  for (const relPath of promptFiles) {
    const abs = join(ROOT, relPath);
    const text = readFileSync(abs, "utf8");
    for (const f of matchPsl002(text, relPath)) findings.push(f);
  }
}

// checkPsl003, checkPsl004 — added in subsequent tasks

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

  // Run rule checks
  const promptFiles = listPromptFiles();
  checkPsl001(promptFiles);
  checkPsl002(promptFiles);

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

// Auto-run main() only when invoked as a script (not when imported by tests).
// Without this guard, importing the rule matchers from the test file would
// trigger process.exit during test setup and Vitest would report "no tests".
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("audit-prompt-state-leakage.ts");
if (invokedDirectly) main();

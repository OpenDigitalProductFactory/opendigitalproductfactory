import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_ENTRIES = 12;

function stripAnsi(line) {
  return String(line ?? "").replace(/\x1B\[[0-9;]*m/g, "");
}

function normalizeLine(line) {
  return stripAnsi(line).replace(/\s+/g, " ").trim();
}

function makeEntry(line, index) {
  const text = normalizeLine(line);
  return text ? { line: index + 1, text } : null;
}

function isPassingLine(text) {
  // BI-FBB86A69: a line that already classified as pass is never a failure,
  // even when the test *title* contains the substring FAIL (FAIL-SAFE,
  // "detects an ANSI FAIL marker line").
  return /^[✓✔√]/.test(text) || /^(PASS|ok)\b/.test(text);
}

function isFailedTestLine(text) {
  if (isPassingLine(text)) return false;
  // Vitest prints FAIL at the start of the line, optionally after a status
  // glyph. Matching FAIL anywhere (the old `\bFAIL\b`) treated passing titles
  // that mention the word as failures.
  if (/^(?:[×✕✖]\s+)?FAIL\b/.test(text)) return true;
  if (/^❯\s+.*\.(test|spec)\.[cm]?[jt]sx?\b/.test(text)) return true;
  return false;
}

function isFailedCheckLine(text) {
  if (isPassingLine(text)) return false;
  if (isFailedTestLine(text)) return false;
  return /\b(Type error|TS\d{4}|Command failed|error Command failed|ELIFECYCLE|failed to solve|unhandled errors?|vitest-pool|Worker exited unexpectedly)\b/i.test(text);
}

export function summarizeLocalCiOutput(output, opts = {}) {
  const maxEntries = Number.isInteger(opts.maxEntries) ? opts.maxEntries : DEFAULT_MAX_ENTRIES;
  const failedTests = [];
  const failedChecks = [];
  let omittedFailureLineCount = 0;
  const lines = String(output ?? "").split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const text = normalizeLine(line);
    if (!text) continue;

    if (isFailedTestLine(text)) {
      const entry = makeEntry(line, index);
      if (entry && failedTests.length < maxEntries) failedTests.push(entry);
      else omittedFailureLineCount += 1;
      continue;
    }

    if (isFailedCheckLine(text)) {
      const entry = makeEntry(line, index);
      if (entry && failedChecks.length < maxEntries) failedChecks.push(entry);
      else omittedFailureLineCount += 1;
    }
  }

  return {
    schema: "dpf-local-ci-failure-summary/v1",
    failedTests,
    failedChecks,
    omittedFailureLineCount,
    truncated: omittedFailureLineCount > 0,
  };
}

function printSummaryFromCli() {
  const file = process.argv[2];
  const input = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  process.stdout.write(`${JSON.stringify(summarizeLocalCiOutput(input), null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  printSummaryFromCli();
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_ENTRIES = 12;

function normalizeLine(line) {
  return String(line ?? "").replace(/\s+/g, " ").trim();
}

function makeEntry(line, index) {
  const text = normalizeLine(line);
  return text ? { line: index + 1, text } : null;
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

    const isFailedTest =
      /\bFAIL\b/.test(text) ||
      /^❯\s+.*\.(test|spec)\.[cm]?[jt]sx?\b/.test(text);
    const isFailedCheck =
      /\b(Type error|TS\d{4}|Command failed|error Command failed|ELIFECYCLE|Prisma schema|Dockerfile|failed to solve|unhandled errors?|vitest-pool|Worker exited unexpectedly)\b/i.test(text);

    if (isFailedTest) {
      const entry = makeEntry(line, index);
      if (entry && failedTests.length < maxEntries) failedTests.push(entry);
      else omittedFailureLineCount += 1;
      continue;
    }

    if (isFailedCheck) {
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

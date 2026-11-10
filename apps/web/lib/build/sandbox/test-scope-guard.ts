// apps/web/lib/build/sandbox/test-scope-guard.ts
//
// BI-F5D4FA50: a Build Studio coding agent ran `pnpm exec vitest run` with no
// file filter inside the sandbox. The whole web suite fanned out one worker per
// core, the sandbox reached ~920% CPU, and the local-CI pool closed for
// `host-cpu-high` for every pregate on the host. Platform verification was
// already scoped (coding-agent.ts runSandboxTests); nothing held an agent's own
// shell to the same rule.
//
// This module is the single statement of that rule. It decides whether a test
// invocation names what it runs (scoped) or runs the whole suite (unscoped):
//   - run_sandbox_command refuses an unscoped command before it reaches the
//     sandbox (sandbox-pack.ts);
//   - apps/web/vitest.config.ts refuses an unscoped run inside the sandbox,
//     which covers CLI agents (claude / codex / grok / opencode) whose shell
//     never passes through run_sandbox_command. It only enforces when the
//     sandbox service sets DPF_SANDBOX_TEST_SCOPE=enforce, so CI, local-CI and
//     developer runs are unchanged.
// apps/mobile/jest.config.js mirrors the argv rule for Jest; it cannot import
// this file because mobile is its own pnpm workspace.
//
// Every decision inside the sandbox is appended to a JSONL record, so a build
// can show which runs were allowed and which were refused.

import { appendFileSync } from "node:fs";

export const SANDBOX_TEST_SCOPE_ENV = "DPF_SANDBOX_TEST_SCOPE";
export const SANDBOX_TEST_SCOPE_LOG_ENV = "DPF_SANDBOX_TEST_SCOPE_LOG";
export const DEFAULT_SANDBOX_TEST_SCOPE_LOG = "/tmp/dpf-test-scope-guard.jsonl";
export const SANDBOX_TEST_SCOPE_MARKER = "[dpf-test-scope-guard]";

export type TestRunner = "vitest" | "jest" | "package-test-script";

export type TestScopeVerdict =
  | { kind: "not-a-test-run" }
  | { kind: "scoped"; runner: TestRunner; filters: string[] }
  | { kind: "unscoped"; runner: TestRunner };

// Options whose following argument is a value, not a test file filter.
const VALUE_OPTIONS = new Set([
  "--reporter", "--reporters", "--shard", "--project", "--projects", "--selectProjects",
  "-t", "--testNamePattern", "--config", "-c", "--root", "-r", "--dir", "--rootDir",
  "--maxWorkers", "-w", "--pool", "--environment", "--env", "--outputFile",
  "--coverageDirectory", "--testTimeout", "--bail", "--retry", "--mode", "--workspace",
]);

// Options that make a run name its own subset of tests.
const SCOPING_OPTIONS = new Set([
  "--changed", "--related", "--findRelatedTests", "-o", "--onlyChanged",
  "--changedSince", "--testPathPattern", "--testPathPatterns", "--listTests",
]);

const NON_RUN_OPTIONS = new Set(["--help", "-h", "--version", "-v"]);
const VITEST_SUBCOMMANDS = new Set(["run", "watch", "dev", "bench"]);
const VITEST_NON_RUN_SUBCOMMANDS = new Set(["list", "init", "typecheck"]);

/** Classify the arguments that follow a test runner binary (or a package `test` script). */
export function classifyTestArgs(runner: TestRunner, rawArgs: readonly string[]): TestScopeVerdict {
  let args = [...rawArgs];
  if (runner === "vitest") {
    const head = args[0];
    if (head && VITEST_NON_RUN_SUBCOMMANDS.has(head)) return { kind: "not-a-test-run" };
    if (head === "related") return args.length > 1 ? { kind: "scoped", runner, filters: args.slice(1) } : { kind: "unscoped", runner };
    if (head && VITEST_SUBCOMMANDS.has(head)) args = args.slice(1);
  }
  const filters: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg.startsWith("-")) {
      const name = arg.split("=")[0];
      if (NON_RUN_OPTIONS.has(name)) return { kind: "not-a-test-run" };
      if (SCOPING_OPTIONS.has(name)) return { kind: "scoped", runner, filters: [arg] };
      if (!arg.includes("=") && VALUE_OPTIONS.has(name)) i += 1;
      continue;
    }
    filters.push(arg);
  }
  return filters.length > 0 ? { kind: "scoped", runner, filters } : { kind: "unscoped", runner };
}

const SHELL_SEPARATOR = /&&|\|\||[;|\n]/;
const TOKEN = /"[^"]*"|'[^']*'|\S+/g;

function tokenize(segment: string): string[] {
  return (segment.match(TOKEN) ?? []).map((t) => t.replace(/^(["'])(.*)\1$/, "$2"));
}

function runnerFromToken(token: string): "vitest" | "jest" | null {
  const base = token.split(/[\\/]/).pop() ?? token;
  if (/^vitest(\.m?js)?$/.test(base)) return "vitest";
  if (/^jest(\.js)?$/.test(base)) return "jest";
  return null;
}

function classifySegment(segment: string): TestScopeVerdict {
  const tokens = tokenize(segment);
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  if (tokens.length === 0) return { kind: "not-a-test-run" };

  const runnerIndex = tokens.findIndex((t) => runnerFromToken(t) !== null);
  // A runner token after a package-manager launcher (pnpm exec / npx / pnpm vitest) or bare.
  if (runnerIndex >= 0 && (runnerIndex === 0 || /^(pnpm|npx|npm|yarn|exec|node|bunx)$/.test(tokens[runnerIndex - 1]) || /^(pnpm|npx|yarn|bunx)$/.test(tokens[0]))) {
    return classifyTestArgs(runnerFromToken(tokens[runnerIndex])!, tokens.slice(runnerIndex + 1));
  }

  // `pnpm test`, `pnpm run test`, `pnpm --filter web test`, `npm test`, `yarn test`.
  if (/^(pnpm|npm|yarn)$/.test(tokens[0])) {
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith("-")) {
      const name = tokens[i].split("=")[0];
      i += !tokens[i].includes("=") && /^(--filter|-F|-C|--dir|--prefix|-w|--workspace)$/.test(name) ? 2 : 1;
    }
    if (tokens[i] === "run" || tokens[i] === "run-script") i += 1;
    if (tokens[i] === "test" || tokens[i] === "t") {
      return classifyTestArgs("package-test-script", tokens.slice(i + 1));
    }
  }
  return { kind: "not-a-test-run" };
}

/**
 * Classify a shell command an agent asked the sandbox to run. Returns the first
 * unscoped test invocation in the command, else the first scoped one, else
 * not-a-test-run.
 */
export function classifyShellTestCommand(command: string): TestScopeVerdict {
  let scoped: TestScopeVerdict | null = null;
  for (const segment of command.split(SHELL_SEPARATOR)) {
    const verdict = classifySegment(segment);
    if (verdict.kind === "unscoped") return verdict;
    if (verdict.kind === "scoped" && !scoped) scoped = verdict;
  }
  return scoped ?? { kind: "not-a-test-run" };
}

/** The refusal an agent sees. Names the scoped tool and the scoped command. */
export function unscopedTestRefusal(runner: TestRunner): string {
  const what = runner === "package-test-script" ? "`test` script with no file filter" : `\`${runner}\` run with no file filter`;
  const example = runner === "jest" ? "pnpm exec jest --ci <test files>" : "pnpm exec vitest run <test files>";
  return [
    `${SANDBOX_TEST_SCOPE_MARKER} Refused a ${what} in the Build Studio sandbox.`,
    "The whole suite runs in cloud CI and the merge queue, not here: one unscoped run takes most of the host and closes the shared local-CI pool.",
    `Run only the tests for the files you changed: call run_sandbox_tests (it derives them from the build's changed files), or name them: ${example}.`,
  ].join(" ");
}

export type TestScopeRecord = {
  at: string;
  runner: TestRunner;
  decision: "allowed" | "refused";
  cwd: string;
  args: string[];
};

/**
 * Enforce the rule for the runner process that is starting (called from a test
 * runner config). No-op unless the sandbox env sets DPF_SANDBOX_TEST_SCOPE=enforce.
 * Throws the refusal for an unscoped run; records every decision it makes.
 */
export function enforceSandboxTestScope(params: {
  runner: "vitest" | "jest";
  argv: readonly string[];
  env: Record<string, string | undefined>;
  cwd: string;
  appendRecord?: (path: string, line: string) => void;
  now?: () => Date;
}): TestScopeVerdict | null {
  const { runner, argv, env, cwd } = params;
  if (env[SANDBOX_TEST_SCOPE_ENV] !== "enforce") return null;
  const binIndex = argv.findIndex((a) => runnerFromToken(a) === runner);
  if (binIndex < 0) return null;
  const args = argv.slice(binIndex + 1);
  const verdict = classifyTestArgs(runner, args);
  if (verdict.kind === "not-a-test-run") return verdict;

  const record: TestScopeRecord = {
    at: (params.now?.() ?? new Date()).toISOString(),
    runner,
    decision: verdict.kind === "unscoped" ? "refused" : "allowed",
    cwd,
    args: [...args],
  };
  const append = params.appendRecord ?? ((path: string, line: string) => appendFileSync(path, line));
  try {
    append(env[SANDBOX_TEST_SCOPE_LOG_ENV] || DEFAULT_SANDBOX_TEST_SCOPE_LOG, `${JSON.stringify(record)}\n`);
  } catch {
    // The record is evidence, not the gate: an unwritable log never lets an unscoped run through.
  }
  if (verdict.kind === "unscoped") throw new Error(unscopedTestRefusal(runner));
  return verdict;
}

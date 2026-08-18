// Tests for the host-side guard parity preflight (BI-D35433FB).
//
// The preflight's trust contract has two halves and both are load-bearing:
// it must fail on a genuine deterministic guard violation BEFORE any lease is
// claimed, and it must NOT fail on a host that merely cannot run a guard
// (missing isolated runtime) — a false local red would teach contributors to
// skip it, recreating the push-to-discover loop it exists to close.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ENVIRONMENT_FAILURE_RE,
  LOCAL_SAFE_PR_GUARD_IDS,
  PREFLIGHT_SKIP_ENV,
  buildPreflightPlan,
  isEnvironmentFailureOutput,
  isRunnerFailureResult,
  runPreflight,
} from "./lib/pregate-preflight.mjs";
import { RUNNER_FAILURE_EXIT_CODE } from "./check-guards.mjs";
import { loadPinnedGuardTypeScript } from "./lib/load-pinned-guard-typescript.mjs";
import { shouldRunPreflight } from "./pregate.mjs";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const preflightCli = join(repoRoot, "scripts", "pregate-preflight.mjs");
const pregateCli = join(repoRoot, "scripts", "pregate.mjs");

// ── plan construction ───────────────────────────────────────────────────────

test("buildPreflightPlan strips guard self-tests but keeps every check command", () => {
  const profiles = {
    source: [
      {
        id: "g1",
        legacyJobId: "g1",
        name: "Guard One",
        commands: [
          ["node", ["--test", "scripts/g1.test.mjs"]],
          ["node", ["scripts/g1.mjs"]],
        ],
      },
      {
        id: "tests-only",
        legacyJobId: "tests-only",
        name: "Self-Tests Only",
        commands: [["node", ["--test", "scripts/only.test.mjs"]]],
      },
    ],
    workspace: [
      {
        id: "workspace-check",
        legacyJobId: "workspace-check",
        name: "Workspace Check",
        commands: [
          ["pnpm", ["run", "workspace-check:test"]],
          ["pnpm", ["run", "workspace-check"]],
        ],
      },
    ],
    "pull-request": [],
  };
  const plan = buildPreflightPlan({ profiles });
  assert.deepEqual(plan.map((entry) => entry.id), ["g1", "workspace-check"]);
  assert.deepEqual(plan[0].commands, [["node", ["scripts/g1.mjs"]]]);
  assert.deepEqual(plan[1].commands, [["pnpm", ["run", "workspace-check"]]]);
});

test("buildPreflightPlan includes only commit-range-safe pull-request gates", () => {
  const plan = buildPreflightPlan();
  const ids = new Set(plan.map((entry) => entry.id));
  for (const id of LOCAL_SAFE_PR_GUARD_IDS) {
    assert.ok(ids.has(id), `expected local-safe gate ${id} in the plan`);
  }
  // PR-body-dependent and tree-mutating gates must never run host-side.
  assert.ok(!ids.has("seed-fit-gate"), "seed-fit-gate reads the PR body");
  assert.ok(!ids.has("decision-baseline"), "decision-baseline merges origin/main");
});

test("buildPreflightPlan contains no --test invocations at all", () => {
  for (const entry of buildPreflightPlan()) {
    for (const [command, args] of entry.commands) {
      assert.ok(
        !(command === "node" && args[0] === "--test"),
        `${entry.id} kept a self-test: ${args.join(" ")}`,
      );
    }
  }
});

test("buildPreflightPlan includes the workspace-dependent prose guard", () => {
  const prose = buildPreflightPlan().find((entry) => entry.id === "prose-lint-guard");
  assert.ok(prose, "prose lint must run before a sandbox lease or PR");
  assert.deepEqual(prose.commands, [["pnpm", ["run", "check:prose-lint"]]]);
});

test("buildPreflightPlan enforces FPAW while stripping its self-test", () => {
  const fpaw = buildPreflightPlan().find((entry) => entry.id === "fpaw-standard-guard");
  assert.ok(fpaw, "FPAW conformance must run before a sandbox lease or PR");
  assert.deepEqual(fpaw.commands, [["pnpm", ["run", "check:fpaw-standard"]]]);
});

// ── run + classification ────────────────────────────────────────────────────

const PLAN = [
  {
    id: "violating",
    legacyJobId: "violating",
    name: "Violating Guard",
    commands: [["node", ["scripts/violating.mjs"]]],
  },
  {
    id: "env-broken",
    legacyJobId: "env-broken",
    name: "Env-Broken Guard",
    commands: [["node", ["scripts/env-broken.mjs"]]],
  },
  {
    id: "clean",
    legacyJobId: "clean",
    name: "Clean Guard",
    commands: [["node", ["scripts/clean.mjs"]]],
  },
];

function fakeExecute(command, args) {
  const script = args[args.length - 1];
  if (script.includes("violating")) return { exitCode: 1, output: "module exceeds ratchet baseline" };
  if (script.includes("env-broken")) {
    return {
      exitCode: 1,
      output: "GuardRuntimeEnvironmentError: Repo guard runtime is unavailable",
    };
  }
  return { exitCode: 0, output: "" };
}

function capturePinnedLoaderError(overrides) {
  try {
    loadPinnedGuardTypeScript({
      runtimeManifest: { devDependencies: { typescript: "6.0.3" } },
      lockText: [
        "importers:",
        "  packages/repo-guard-runtime:",
        "    devDependencies:",
        "      typescript:",
        "        specifier: 6.0.3",
        "        version: 6.0.3",
      ].join("\n"),
      ...overrides,
    });
    assert.fail("expected the pinned runtime loader to reject");
  } catch (error) {
    return String(error?.stack ?? error);
  }
}

test("runPreflight fails on a genuine guard violation", async () => {
  const result = await runPreflight({ plan: PLAN, execute: fakeExecute, env: {} });
  assert.equal(result.ok, false);
  const byId = Object.fromEntries(result.entries.map((entry) => [entry.id, entry.status]));
  assert.equal(byId.violating, "failed");
  assert.equal(byId.clean, "passed");
});

test("runPreflight reclassifies environment failures as skipped_environment, not failed", async () => {
  const result = await runPreflight({
    plan: PLAN.filter((entry) => entry.id !== "violating"),
    execute: fakeExecute,
    env: {},
  });
  assert.equal(result.ok, true, "an unrunnable guard must not hard-fail the preflight");
  const envEntry = result.entries.find((entry) => entry.id === "env-broken");
  assert.equal(envEntry.status, "skipped_environment");
});

test("runPreflight reclassifies the pinned guard loader's canonical missing-runtime error", async () => {
  const output = capturePinnedLoaderError({
    resolvePackage() {
      throw new Error("missing");
    },
  });

  assert.match(output, /Pinned repo guard TypeScript 6\.0\.3 is missing/);
  assert.match(output, /GuardRuntimeEnvironmentError/);
  const result = await runPreflight({
    plan: [{
      id: "pinned-runtime-missing",
      legacyJobId: "pinned-runtime-missing",
      name: "Pinned Runtime Missing",
      commands: [["node", ["scripts/pinned-runtime-missing.mjs"]]],
    }],
    execute: () => ({ exitCode: 1, output }),
    env: {},
  });

  assert.equal(result.ok, true, "source-only runtime absence must not block sandbox admission");
  assert.equal(result.entries[0].status, "skipped_environment");
});

test("wrong-graph guard runtime resolution carries the same stable environment signal", () => {
  const output = capturePinnedLoaderError({
    resolvePackage: () => "D:/unrelated/node_modules/typescript/package.json",
  });
  assert.match(output, /GuardRuntimeEnvironmentError/);
  assert.ok(isEnvironmentFailureOutput(output));
});

test("runPreflight reclassifies a killed spawn as runner_failed, not a violation (BI-AA2EE621)", async () => {
  // The executor signals a spawn the host killed/refused via runnerFailure.
  const result = await runPreflight({
    plan: PLAN.filter((entry) => entry.id === "clean" || entry.id === "violating"),
    execute: (command, args) => {
      const script = args[args.length - 1];
      if (script.includes("violating")) return { exitCode: 1, output: "", runnerFailure: true };
      return { exitCode: 0, output: "", runnerFailure: false };
    },
    env: {},
  });
  // A host that could not run a guard must not hard-fail the preflight...
  assert.equal(result.ok, true);
  const entry = result.entries.find((e) => e.id === "violating");
  // ...and must be distinguishable from both a real violation and an env skip.
  assert.equal(entry.status, "runner_failed");
});

test("runPreflight reclassifies the guard-loop runner's reserved exit code as runner_failed", async () => {
  // defaultExecute maps check-guards' RUNNER_FAILURE_EXIT_CODE to runnerFailure;
  // this simulates that executor output for the guard-loop command.
  const result = await runPreflight({
    plan: PLAN.filter((entry) => entry.id === "clean" || entry.id === "violating"),
    execute: (command, args) => {
      const script = args[args.length - 1];
      if (script.includes("violating")) {
        return { exitCode: RUNNER_FAILURE_EXIT_CODE, output: "could not RUN 1/24 guard(s)", runnerFailure: true };
      }
      return { exitCode: 0, output: "", runnerFailure: false };
    },
    env: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.entries.find((e) => e.id === "violating").status, "runner_failed");
});

test("a genuine violation is still failed even though the runner path exists", async () => {
  const result = await runPreflight({ plan: PLAN, execute: fakeExecute, env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.entries.find((e) => e.id === "violating").status, "failed");
});

test("REGRESSION (BI-AA2EE621): exit 1 whose output mentions a killed sub-guard stays a violation", async () => {
  // The dangerous case: check-guards found a REAL violation (exit 1) while a
  // DIFFERENT sub-guard was evicted, so its output contains both blocks. Keying
  // on output text would downgrade this to a warning and let a doomed tree pass.
  const result = await runPreflight({
    plan: PLAN.filter((entry) => entry.id === "clean" || entry.id === "violating"),
    execute: (command, args) => {
      const script = args[args.length - 1];
      if (script.includes("violating")) {
        return {
          exitCode: 1,
          output:
            "1/24 guard(s) FAILED (found violations)\n" +
            "could not RUN 1/24 guard(s) — RUNNER failures — killed by SIGKILL",
          runnerFailure: false,
        };
      }
      return { exitCode: 0, output: "", runnerFailure: false };
    },
    env: {},
  });
  assert.equal(result.ok, false, "a real violation must hard-fail even when a sibling spawn was killed");
  assert.equal(result.entries.find((e) => e.id === "violating").status, "failed");
});

test("isRunnerFailureResult keys on exit code and spawn signals, never on guard output", () => {
  // Killed / refused spawns → runner, for any command.
  assert.ok(isRunnerFailureResult({ args: ["scripts/check-module-size.mjs"], status: null, error: null }));
  assert.ok(isRunnerFailureResult({ args: ["scripts/x.mjs"], error: Object.assign(new Error("spawn ENOMEM"), { code: "ENOMEM" }) }));
  // The guard-loop runner's reserved runner code → runner.
  assert.ok(isRunnerFailureResult({ args: ["scripts/check-guards.mjs"], status: RUNNER_FAILURE_EXIT_CODE }));
  // The SAME reserved code from a DIFFERENT command is NOT a runner failure.
  assert.ok(!isRunnerFailureResult({ args: ["scripts/check-module-size.mjs"], status: RUNNER_FAILURE_EXIT_CODE }));
  // A real violation (exit 1) is NEVER a runner failure — the load-bearing property.
  assert.ok(!isRunnerFailureResult({ args: ["scripts/check-guards.mjs"], status: 1 }));
  assert.ok(!isRunnerFailureResult({ args: ["scripts/check-module-size.mjs"], status: 1 }));
  // Clean is not a runner failure.
  assert.ok(!isRunnerFailureResult({ args: ["scripts/check-guards.mjs"], status: 0 }));
});

test("runPreflight honors the recorded emergency skip", async () => {
  const result = await runPreflight({
    plan: PLAN,
    execute: () => {
      throw new Error("must not execute anything when skipped");
    },
    env: { [PREFLIGHT_SKIP_ENV]: "hotfix: guard outage BI-XXXX" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, "hotfix: guard outage BI-XXXX");
});

test("environment failure classification uses stable runtime signals, not guard verdicts", () => {
  assert.ok(ENVIRONMENT_FAILURE_RE.test("Error [ERR_MODULE_NOT_FOUND]: Cannot find package"));
  assert.ok(isEnvironmentFailureOutput("GuardRuntimeEnvironmentError: localized wording"));
  assert.ok(isEnvironmentFailureOutput("Local package.json exists, but node_modules missing"));
  assert.ok(isEnvironmentFailureOutput("'tsx' is not recognized as an internal or external command"));
  assert.ok(!isEnvironmentFailureOutput("module exceeds ratchet baseline: 1050 > 1047 lines"));
  assert.ok(!isEnvironmentFailureOutput("Missing UX-Fit-Decision trailer"));
});

// ── pregate wiring ──────────────────────────────────────────────────────────

test("shouldRunPreflight: on for real gate runs, off for probes, replays, and recorded skips", () => {
  assert.equal(shouldRunPreflight(["--branch", "feat/x"], {}), true);
  assert.equal(shouldRunPreflight(["--dry-run", "--branch", "feat/x"], {}), false);
  assert.equal(shouldRunPreflight(["--finalize-evidence", "--branch", "feat/x"], {}), false);
  assert.equal(
    shouldRunPreflight(["--branch", "feat/x"], { DPF_SKIP_PREGATE_PREFLIGHT_REASON: "why" }),
    false,
  );
});

test("pregate-preflight.mjs --plan emits the JSON plan without running guards", () => {
  const result = spawnSync(process.execPath, [preflightCli, "--plan"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.ok(plan.length > 0);
  assert.ok(plan.some((entry) => entry.id === "module-size-guard"));
  assert.ok(plan.every((entry) => entry.commands.every((c) => !c.startsWith("node --test"))));
});

// BI-FFFEFBCC (follow-on to BI-745658D7): Node realpath-resolves the ESM entry
// module, so under a symlinked invocation path (macOS /var tmpdir → /private/var)
// the naive `process.argv[1] === fileURLToPath(import.meta.url)` guard is false,
// main() silently never runs, and the process exits 0 with no output. This pins
// the isEntryModule adoption: main() must run whichever spelling the caller used.
test("pregate-preflight.mjs still runs main() when invoked through a symlinked path", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-preflight-symlink-"));
  const link = join(temp, "repo-link");
  try {
    // "junction" keeps this runnable on Windows hosts without symlink privilege.
    symlinkSync(repoRoot, link, "junction");
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    t.skip(`cannot create a directory symlink on this host: ${error.code}`);
    return;
  }
  try {
    const result = spawnSync(
      process.execPath,
      [join(link, "scripts", "pregate-preflight.mjs"), "--plan"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.ok(plan.length > 0, "main() must run under a symlinked argv[1], not silently exit 0");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("pregate.mjs --dry-run skips the preflight and still reaches gate routing", () => {
  const result = spawnSync(
    process.execPath,
    [pregateCli, "--dry-run", "--branch", "feat/x", "--worktree", repoRoot],
    { encoding: "utf8", env: { ...process.env, DPF_PREGATE_FORCE_NODE: "1" } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /pregate-preflight/);
  assert.match(result.stdout, /gate-worktree dry-run/);
});

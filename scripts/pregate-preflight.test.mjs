// Tests for the host-side guard parity preflight (BI-D35433FB).
//
// The preflight's trust contract has two halves and both are load-bearing:
// it must fail on a genuine deterministic guard violation BEFORE any lease is
// claimed, and it must NOT fail on a host that merely cannot run a guard
// (missing isolated runtime) — a false local red would teach contributors to
// skip it, recreating the push-to-discover loop it exists to close.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import {
  ENVIRONMENT_FAILURE_RE,
  LOCAL_SAFE_PR_GUARD_IDS,
  PREFLIGHT_SKIP_ENV,
  buildPreflightPlan,
  isEnvironmentFailureOutput,
  runPreflight,
} from "./lib/pregate-preflight.mjs";
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

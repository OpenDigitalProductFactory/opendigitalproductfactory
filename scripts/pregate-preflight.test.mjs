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
  runPreflight,
} from "./lib/pregate-preflight.mjs";
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
    "pull-request": [],
  };
  const plan = buildPreflightPlan({ profiles });
  assert.deepEqual(plan.map((entry) => entry.id), ["g1"]);
  assert.deepEqual(plan[0].commands, [["node", ["scripts/g1.mjs"]]]);
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
      output: "Error: Repo guard TypeScript resolved outside its isolated pnpm graph: …",
    };
  }
  return { exitCode: 0, output: "" };
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

test("ENVIRONMENT_FAILURE_RE matches runtime-absence signatures, not guard verdicts", () => {
  assert.ok(ENVIRONMENT_FAILURE_RE.test("Error [ERR_MODULE_NOT_FOUND]: Cannot find package"));
  assert.ok(ENVIRONMENT_FAILURE_RE.test("TypeScript resolved outside its isolated pnpm graph"));
  assert.ok(!ENVIRONMENT_FAILURE_RE.test("module exceeds ratchet baseline: 1050 > 1047 lines"));
  assert.ok(!ENVIRONMENT_FAILURE_RE.test("Missing UX-Fit-Decision trailer"));
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

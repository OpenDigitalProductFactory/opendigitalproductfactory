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
import * as fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ENVIRONMENT_FAILURE_RE,
  LOCAL_SAFE_PR_GUARD_IDS,
  PREFLIGHT_SKIP_ENV,
  buildPreflightPlan,
  guardAppliesToScope,
  planPreflight,
  isEnvironmentFailureOutput,
  isRunnerFailureResult,
  runPreflight,
} from "./lib/pregate-preflight.mjs";
import { POLICY_GUARD_PROFILES, isPolicyGuardConformanceCommand } from "./lib/ci-policy-guards.mjs";
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

// BI-7B249AFE: a `node --test` command marked `{ conformance: true }` asserts
// LIVE REPOSITORY STATE, not guard logic. Stripping it removes the only check on
// the tree being pushed, and the preflight then reports clean where CI fails
// deterministically — observed end to end on #4737.
test("buildPreflightPlan keeps a conformance-marked test and still strips its unmarked twin", () => {
  const profiles = {
    source: [
      {
        id: "mixed",
        legacyJobId: "mixed",
        name: "Mixed",
        commands: [
          ["node", ["--test", "scripts/unit.test.mjs"]],
          ["node", ["--test", "scripts/conformance.test.mjs"], { conformance: true }],
          ["node", ["scripts/check-mixed.mjs"]],
        ],
      },
      {
        id: "conformance-only",
        legacyJobId: "conformance-only",
        name: "Conformance Only",
        commands: [["node", ["--test", "scripts/only.test.mjs"], { conformance: true }]],
      },
    ],
    workspace: [],
    "pull-request": [],
  };

  const plan = buildPreflightPlan({ profiles });
  assert.deepEqual(plan.map((entry) => entry.id), ["mixed", "conformance-only"]);
  assert.deepEqual(plan[0].commands, [
    ["node", ["--test", "scripts/conformance.test.mjs"], { conformance: true }],
    ["node", ["scripts/check-mixed.mjs"]],
  ]);
  // A guard whose ONLY command is a conformance assertion used to vanish from
  // the plan entirely, which reads as "clean" rather than "never checked".
  assert.equal(plan[1].commands.length, 1);
});

test("the real plan carries the instruction-plane rule-coverage conformance assertion", () => {
  // The exact command whose absence produced the #4737 false green.
  const plan = buildPreflightPlan();
  const commands = plan.flatMap((entry) => entry.commands.map(([bin, args]) => [bin, ...args].join(" ")));
  assert.ok(
    commands.includes("node --test scripts/check-instruction-plane-rule-coverage.test.mjs"),
    "the rule-coverage conformance assertion must run host-side",
  );
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

test("buildPreflightPlan runs every pull-request gate that can answer host-side", () => {
  // Parity with CI's pull-request profile is the point of the preflight. A gate
  // omitted here is one a push can only discover in CI — which is what happened
  // to Docs Impact on #4558. Only the two gates that CANNOT answer before a push
  // may be missing; anything else added to the profile must be triaged into or
  // out of LOCAL_SAFE_PR_GUARD_IDS deliberately, and this test is the prompt.
  const CANNOT_ANSWER_HOST_SIDE = new Set(["seed-fit-gate", "decision-baseline"]);
  const planned = new Set(buildPreflightPlan().map((entry) => entry.id));
  const missing = POLICY_GUARD_PROFILES["pull-request"]
    .map((entry) => entry.id)
    .filter((id) => !planned.has(id) && !CANNOT_ANSWER_HOST_SIDE.has(id));
  assert.deepEqual(
    missing,
    [],
    `pull-request gate(s) absent from the preflight: ${missing.join(", ")}. ` +
      "Add to LOCAL_SAFE_PR_GUARD_IDS, or to CANNOT_ANSWER_HOST_SIDE with the reason.",
  );
});

// Was "contains no --test invocations at all" until BI-7B249AFE. That invariant
// was the bug: it made stripping unconditional, so a conformance assertion over
// repository state was removed along with the genuine self-tests. The invariant
// now is that every surviving `--test` command carries the explicit mark —
// `scripts/check-guard-conformance-marks.mjs` decides which ones earn it.
test("buildPreflightPlan keeps no UNMARKED --test invocation", () => {
  for (const entry of buildPreflightPlan()) {
    for (const command of entry.commands) {
      const [binary, args] = command;
      if (binary !== "node" || args[0] !== "--test") continue;
      assert.ok(
        isPolicyGuardConformanceCommand(command),
        `${entry.id} kept an unmarked self-test: ${args.join(" ")}`,
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
  // BI-7E0812E0: --plan is scoped to the current diff. A docs-only branch
  // correctly omits module-size-guard, so pin a guard that applies in every
  // scope instead of making this CLI smoke test branch-dependent.
  assert.ok(plan.some((entry) => entry.id === "docs-link-integrity"));
  // The rendered plan flattens each command to a string, so the conformance mark
  // is not visible here. Assert against the registry instead: every `node --test`
  // line the plan shows must be one the registry marked (BI-7B249AFE).
  const marked = new Set(
    buildPreflightPlan()
      .flatMap((entry) => entry.commands)
      .filter((command) => isPolicyGuardConformanceCommand(command))
      .map(([binary, args]) => [binary, ...args].join(" ")),
  );
  const unmarked = plan
    .flatMap((entry) => entry.commands)
    .filter((command) => command.startsWith("node --test") && !marked.has(command));
  assert.deepEqual(unmarked, []);
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

// BI-8CDA7F95: the preflight honours the change scope the cloud trusts. A guard
// is left out of a docs-only run ONLY when it DECLARES inputs a docs-only diff
// cannot touch. Undeclared guards, unknown scope, and any non-docs change run
// everything — a wrong skip is a false green.
const scopedProfiles = {
  source: [
    { id: "code-only", legacyJobId: "code-only", name: "Code Only", commands: [["node", ["scripts/code-only.mjs"]]], inputs: ["code"] },
    { id: "undeclared", legacyJobId: "undeclared", name: "Undeclared", commands: [["node", ["scripts/undeclared.mjs"]]], inputs: null },
    { id: "docs-aware", legacyJobId: "docs-aware", name: "Docs Aware", commands: [["node", ["scripts/docs-aware.mjs"]]], inputs: ["code", "docs"] },
  ],
  workspace: [],
  "pull-request": [],
};

test("a docs-only scope leaves out only guards that declare inputs: [\"code\"]", () => {
  const planned = planPreflight({ profiles: scopedProfiles, changeScope: { docsOnly: true, mobileOnly: false, heavy: false } });
  assert.deepEqual(planned.entries.map((e) => e.id), ["undeclared", "docs-aware"]);
  assert.deepEqual(planned.skippedByScope.map((e) => e.id), ["code-only"]);
});

test("a full or mobile-only scope, or an unknown scope, runs every guard", () => {
  for (const changeScope of [
    { docsOnly: false, mobileOnly: false, heavy: true },
    { docsOnly: false, mobileOnly: true, heavy: false },
    null,
    undefined,
  ]) {
    const planned = planPreflight({ profiles: scopedProfiles, changeScope });
    assert.deepEqual(planned.entries.map((e) => e.id), ["code-only", "undeclared", "docs-aware"], String(changeScope));
    assert.deepEqual(planned.skippedByScope, []);
  }
  assert.equal(guardAppliesToScope({ inputs: ["code"] }, null), true);
  assert.equal(guardAppliesToScope({ inputs: ["code"] }, { docsOnly: true }), false);
  assert.equal(guardAppliesToScope({ inputs: null }, { docsOnly: true }), true);
  assert.equal(guardAppliesToScope({}, { docsOnly: true }), true);
});

test("buildPreflightPlan without a scope is unchanged (every guard)", () => {
  assert.deepEqual(
    buildPreflightPlan({ profiles: scopedProfiles }).map((e) => e.id),
    ["code-only", "undeclared", "docs-aware"],
  );
});

test("the real registry declares the module-size guard code-only and leaves the docs guards undeclared", () => {
  const all = [...POLICY_GUARD_PROFILES.source, ...POLICY_GUARD_PROFILES.workspace, ...POLICY_GUARD_PROFILES["pull-request"]];
  const byId = new Map(all.map((e) => [e.id, e]));
  assert.deepEqual(byId.get("module-size-guard").inputs, ["code"]);
  for (const id of ["docs-link-integrity", "docs-impact-gate", "prose-lint-guard", "instruction-plane-rule-coverage", "doc-reference-integrity"]) {
    assert.equal(byId.get(id).inputs, null, `${id} must stay undeclared (it reads docs)`);
  }
  const docsOnly = planPreflight({ changeScope: { docsOnly: true, mobileOnly: false, heavy: false } });
  assert.ok(docsOnly.skippedByScope.length >= 20, `expected a material docs-only saving, got ${docsOnly.skippedByScope.length}`);
  assert.ok(docsOnly.entries.some((e) => e.id === "docs-link-integrity"));
});

// Drift detector: a guard declared `inputs: ["code"]` must not read docs or
// markdown anywhere in its static import closure. This is the check that makes
// a declaration a claim someone can falsify rather than a comment.
test("every guard declared code-only has an import closure that references no docs or markdown inputs", () => {
  const { readFileSync, existsSync } = fsSync;
  const docsInputRe = /\.mdx?\b|\bdocs\/|markdown|AGENTS\.md|\.adoc|\.rst|memory\/|user-guide/;
  const importRe = /from\s+["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  function closure(file, seen = new Set(), depth = 0) {
    if (seen.has(file) || depth > 3 || !existsSync(file)) return seen;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(importRe)) {
      let target = join(dirname(file), m[1] || m[2]);
      if (!existsSync(target)) {
        if (existsSync(`${target}.mjs`)) target = `${target}.mjs`;
        else if (existsSync(`${target}.js`)) target = `${target}.js`;
        else continue;
      }
      closure(target, seen, depth + 1);
    }
    return seen;
  }
  const all = [...POLICY_GUARD_PROFILES.source, ...POLICY_GUARD_PROFILES.workspace, ...POLICY_GUARD_PROFILES["pull-request"]];
  const offenders = [];
  for (const entry of all) {
    if (!entry.inputs || entry.inputs.includes("docs")) continue;
    // Self-tests are stripped from the plan (and CI runs them), so only the
    // commands that actually run host-side are audited: check scripts, plus
    // conformance-marked --test commands, which the preflight keeps.
    const scripts = entry.commands.flatMap(([, args, options]) => (
      args[0] === "--test" && options?.conformance !== true
        ? []
        : args.filter((a) => /^scripts\/.*\.mjs$/.test(a))
    ));
    assert.ok(scripts.length > 0, `${entry.id}: a code-only declaration needs an auditable script, not a pnpm alias`);
    const files = new Set();
    for (const script of scripts) for (const f of closure(join(repoRoot, script))) files.add(f);
    for (const f of files) {
      if (docsInputRe.test(readFileSync(f, "utf8"))) offenders.push(`${entry.id} <- ${f.slice(repoRoot.length)}`);
    }
  }
  assert.deepEqual(offenders, [], "declared code-only guards reference docs inputs:\n" + offenders.join("\n"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGatePlan } from "./pr-readiness/core.mjs";
import { classifyChangedFiles } from "./ci-change-scope.mjs";

const guard = (id, inputs) => ({ id, name: id, inputs, commands: [["node", [`scripts/${id}.mjs`]]] });
const profiles = { source: [guard("code", ["code"]), guard("docs", ["docs"]), guard("shared", ["code", "docs"]), guard("undeclared")], workspace: [], "pull-request": [] };

test("PR readiness uses CI scope for an AGENTS.md-only change", () => {
  const changeScope = classifyChangedFiles(["AGENTS.md"]);
  assert.equal(changeScope.docsOnly, true);
  assert.deepEqual(buildGatePlan({ profiles, changeScope }).map(gate => gate.name), ["docs", "shared", "undeclared"]);
});

test("mixed and unknown changes retain every guard", () => {
  for (const changeScope of [null, classifyChangedFiles([]), classifyChangedFiles(["AGENTS.md", "apps/web/lib/example.ts"])]) {
    assert.deepEqual(buildGatePlan({ profiles, changeScope }).map(gate => gate.name), ["code", "docs", "shared", "undeclared"]);
  }
});

test("every readiness guard binds one immutable source pair, including explicit baseline commands", () => {
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const plan = buildGatePlan({ baseSha, headSha });
  assert.ok(plan.length > 0);
  for (const gate of plan) {
    assert.equal(gate.env.BASE_SHA, baseSha, gate.name);
    assert.equal(gate.env.HEAD_SHA, headSha, gate.name);
    assert.ok(!(gate.command[0] === "git" && gate.command[1][0] === "fetch"), "fetch belongs before source resolution, never inside the pinned plan");
    assert.ok(!gate.command[1].includes("origin/main"), gate.name);
  }
  const baseline = plan.find(gate => gate.command[1][0] === "scripts/check-golden-decisions.mjs");
  assert.ok(baseline, "binding must retain the actual baseline check");
  assert.deepEqual(baseline.command[1].slice(-2), ["--merge-with", baseSha]);
});

test("repository classification and baseline readers retain the same resolved base after shared ref motion", async t => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { readRepoState } = await import("./pr-readiness.mjs");
  const { readBaselineAtBase: readContextBaseline } = await import("./check-context-economy.mjs");
  const { readBaselineAtBase: readToolBaseline } = await import("./check-tool-surface.mjs");
  const { resolveBaseRef } = await import("./check-n-minus-one-caller-honesty.mjs");
  const cwd = mkdtempSync(join(tmpdir(), "dpf-readiness-source-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = args => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const commit = message => { git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", message]); };
  git(["init", "-b", "topic"]);
  mkdirSync(join(cwd, "scripts"));
  for (const slug of ["context-economy", "tool-surface"]) writeFileSync(join(cwd, "scripts", slug + "-baseline.json"), JSON.stringify({ entries: { budget: { value: 1 } } }));
  commit("base");
  const baseSha = git(["rev-parse", "HEAD"]);
  git(["update-ref", "refs/remotes/origin/main", baseSha]);
  writeFileSync(join(cwd, "AGENTS.md"), "Documentation candidate");
  commit("candidate");
  const repo = readRepoState(null, { cwd, fetch: () => {} });
  assert.equal(repo.baseSha, baseSha);
  assert.deepEqual(repo.changedFiles, ["AGENTS.md"]);
  assert.deepEqual(repo.commits.map(c => c.subject), ["candidate"]);
  assert.equal(classifyChangedFiles(repo.changedFiles).docsOnly, true);
  for (const slug of ["context-economy", "tool-surface"]) writeFileSync(join(cwd, "scripts", slug + "-baseline.json"), JSON.stringify({ entries: { budget: { value: 2 } } }));
  commit("new main");
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  for (const read of [readContextBaseline, readToolBaseline]) {
    assert.deepEqual(read({ base: repo.baseSha, cwd }), { budget: { value: 1 } });
    assert.deepEqual(read({ base: "origin/main", cwd }), { budget: { value: 2 } });
  }
  assert.equal(resolveBaseRef(undefined, { BASE_SHA: baseSha }), baseSha);
  assert.equal(resolveBaseRef("supported-release", { BASE_SHA: baseSha }), "supported-release", "an explicit compatibility baseline retains precedence");
  const plan = buildGatePlan({ baseSha: repo.baseSha, headSha: repo.headSha });
  assert.ok(plan.every(gate => gate.env.BASE_SHA === baseSha && gate.env.HEAD_SHA === repo.headSha));
});

test("readiness removes only its already-resolved main fetch and preserves independent evidence fetches", () => {
  const profiles = { source: [{ id: "fetches", name: "Fetches", commands: [
    ["git", ["fetch", "--no-tags", "--quiet", "origin", "main"]],
    ["git", ["fetch", "--no-tags", "--quiet", "evidence", "supported-release"]],
    ["node", ["scripts/check-golden-decisions.mjs", "--merge-with", "origin/main"]],
  ] }], workspace: [], "pull-request": [] };
  const plan = buildGatePlan({ profiles, baseSha: "a".repeat(40) });
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0].command, ["git", ["fetch", "--no-tags", "--quiet", "evidence", "supported-release"]]);
});

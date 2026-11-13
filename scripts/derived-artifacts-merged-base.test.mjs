#!/usr/bin/env node
// BI-1A06A1AF: pregate preflight judged derived-artifact freshness on the
// branch tree while CI judges the pull_request merge of main + branch. A branch
// 79 commits behind main passed preflight and then failed Route Manifest
// Freshness. These tests pin the merged-base verdict preflight now gives before
// any guard runs or sandbox lease is claimed. Isolated Git repositories only.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateMergedBaseExposure, mergedBaseDerivedVerdict } from "./derived-artifacts-gate.mjs";
import { refuseOnMergedBaseStaleness } from "./pregate-preflight.mjs";

const ROUTES = {
  id: "route-manifest",
  sourceGlobs: ["app/**"],
  artifactPaths: ["lib/route-manifest.json"],
  generate: ["pnpm", "--filter", "web", "run", "build:route-manifest"],
  check: ["pnpm", "--filter", "web", "run", "check:route-manifest"],
};
const DOCS = {
  id: "doc-index",
  sourceGlobs: ["docs/**/*.md"],
  artifactPaths: ["lib/doc-index.generated.json"],
  generate: ["node", "scripts/gen-doc-index.mjs"],
  check: ["node", "scripts/gen-doc-index.mjs", "--check"],
};
const REGISTRY = [ROUTES, DOCS];

test("only an artifact whose inputs changed on BOTH sides is exposed to the merge", () => {
  const exposed = evaluateMergedBaseExposure({
    branchFiles: ["app/new/page.tsx", "lib/route-manifest.json"],
    mainFiles: ["app/other/page.tsx", "lib/route-manifest.json", "docs/guide.md"],
    registry: REGISTRY,
  });
  assert.deepEqual(exposed.map((entry) => entry.id), ["route-manifest"]);
});

test("a regenerated artifact output counts as that artifact's input on either side", () => {
  const exposed = evaluateMergedBaseExposure({
    branchFiles: ["lib/route-manifest.json"],
    mainFiles: ["app/other/page.tsx"],
    registry: REGISTRY,
  });
  assert.deepEqual(exposed.map((entry) => entry.id), ["route-manifest"]);
});

test("one-sided changes are judged exactly by the existing head check", () => {
  assert.deepEqual(evaluateMergedBaseExposure({
    branchFiles: ["app/new/page.tsx"], mainFiles: ["docs/guide.md"], registry: REGISTRY,
  }), []);
});

function repository(t) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-merged-base-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path, text) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "DPF Test");
  git("config", "user.email", "dpf-test@example.invalid");
  git("config", "core.autocrlf", "false");
  write("app/home/page.tsx", "home\n");
  write("lib/route-manifest.json", "[\"home\"]\n");
  git("add", "."); git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-q", "-c", "topic");
  return { dir, git, write };
}

function advanceMain({ git, write }, path, text) {
  git("switch", "-q", "main");
  write(path, text);
  git("add", "."); git("commit", "-qm", `main: ${path}`);
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-q", "topic");
}

test("preflight FAILS a branch whose artifact inputs moved on origin/main too, with CI's id and run: remedy", t => {
  const repo = repository(t);
  repo.write("app/new/page.tsx", "new\n");
  repo.write("lib/route-manifest.json", "[\"home\",\"new\"]\n");
  repo.git("add", "."); repo.git("commit", "-qm", "topic route");
  advanceMain(repo, "app/other/page.tsx", "other\n");

  const verdict = mergedBaseDerivedVerdict({ cwd: repo.dir, registry: REGISTRY });
  assert.equal(verdict.status, "stale");
  assert.equal(verdict.behind, 1);
  assert.deepEqual(verdict.entries.map((entry) => entry.id), ["route-manifest"]);

  const out = [];
  const exitCode = refuseOnMergedBaseStaleness({ cwd: repo.dir, registry: REGISTRY, write: (line) => out.push(line) });
  assert.equal(exitCode, 1);
  const text = out.join("");
  assert.match(text, /route-manifest: STALE/);
  assert.match(text, /run: pnpm --filter web run build:route-manifest/);
  assert.match(text, /git merge origin\/main/);
  assert.match(text, /no lease was claimed/);
});

test("a fresh branch that already contains origin/main is unaffected", t => {
  const repo = repository(t);
  advanceMain(repo, "app/other/page.tsx", "other\n");
  repo.git("merge", "-q", "--no-edit", "origin/main");
  repo.write("app/new/page.tsx", "new\n");
  repo.write("lib/route-manifest.json", "[\"home\",\"new\",\"other\"]\n");
  repo.git("add", "."); repo.git("commit", "-qm", "topic route on current main");

  assert.equal(mergedBaseDerivedVerdict({ cwd: repo.dir, registry: REGISTRY }).status, "current");
  assert.equal(refuseOnMergedBaseStaleness({ cwd: repo.dir, registry: REGISTRY, write: () => {} }), 0);
});

test("a branch behind main on unrelated inputs is not refused", t => {
  const repo = repository(t);
  repo.write("app/new/page.tsx", "new\n");
  repo.git("add", "."); repo.git("commit", "-qm", "topic route");
  advanceMain(repo, "docs/guide.md", "guide\n");
  const verdict = mergedBaseDerivedVerdict({ cwd: repo.dir, registry: REGISTRY });
  assert.equal(verdict.status, "clear");
  assert.equal(refuseOnMergedBaseStaleness({ cwd: repo.dir, registry: REGISTRY, write: () => {} }), 0);
});

test("a merged base that cannot be computed is UNRUN, never STALE (BI-BD7E0319, BI-20B40955)", t => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-merged-base-none-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(mergedBaseDerivedVerdict({ cwd: dir, registry: REGISTRY }).status, "unrun");
  const out = [];
  assert.equal(refuseOnMergedBaseStaleness({ cwd: dir, registry: REGISTRY, write: (line) => out.push(line) }), 0);
  assert.match(out.join(""), /UNRUN/);
  assert.doesNotMatch(out.join(""), /STALE/);
});

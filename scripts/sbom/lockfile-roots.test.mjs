#!/usr/bin/env node
// Conformance tests for the lockfile-root registry (plan 2026-09-08 M6).
// Reads live repository state, so it runs as a conformanceTest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LOCKFILE_ROOTS, repoWorkspacePath, rootFile } from "./lockfile-roots.mjs";
import { parseReleaseAgePolicy } from "./check-lockfile-release-age.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("importer keys map back to repo paths", () => {
  const mobile = { id: "m", dir: "apps/mobile", workspacePrefix: "apps/mobile" };
  assert.equal(repoWorkspacePath(mobile, "."), "apps/mobile");
  assert.equal(repoWorkspacePath(mobile, "sub"), "apps/mobile/sub");
  assert.equal(repoWorkspacePath({ id: "p", dir: ".", workspacePrefix: "" }, "apps/web"), "apps/web");
  assert.equal(rootFile(mobile, "pnpm-lock.yaml"), "apps/mobile/pnpm-lock.yaml");
});

test("every registered root has a lockfile and a workspace file with the platform release-age floor", () => {
  const platformFloor = parseReleaseAgePolicy(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")).minutes;
  assert.ok(platformFloor > 0);
  for (const root of LOCKFILE_ROOTS) {
    assert.ok(existsSync(join(ROOT, rootFile(root, "pnpm-lock.yaml"))), `${root.id}: lockfile missing`);
    const policy = parseReleaseAgePolicy(readFileSync(join(ROOT, rootFile(root, "pnpm-workspace.yaml")), "utf8"));
    assert.ok(policy.minutes >= platformFloor, `${root.id}: minimumReleaseAge below the platform floor`);
  }
});

test("every separate root is excluded from the platform workspace and has Dependabot coverage and budgets", () => {
  const platformWorkspace = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const dependabot = readFileSync(join(ROOT, ".github", "dependabot.yml"), "utf8");
  const baseline = JSON.parse(readFileSync(join(ROOT, "sbom", "baseline.json"), "utf8"));
  for (const root of LOCKFILE_ROOTS.filter((r) => r.dir !== ".")) {
    assert.match(platformWorkspace, new RegExp(`- "!${root.dir}"`), `${root.id}: not excluded from the platform workspace`);
    assert.match(dependabot, new RegExp(`directory: "/${root.dir}"`), `${root.id}: no Dependabot entry`);
    assert.equal(typeof baseline.roots?.[root.id]?.budgets?.resolvedComponents, "number", `${root.id}: no shape budgets`);
  }
});

test("the platform Dependabot entry owns the platform's coupled dependency policies", () => {
  const text = readFileSync(join(ROOT, ".github", "dependabot.yml"), "utf8");
  const entries = text.split(/^  - package-ecosystem: /m).slice(1);
  const platform = entries.find((entry) => /^"npm"\s*\n/.test(entry) && /^    directory: "\/"$/m.test(entry));
  assert.ok(platform, "platform npm entry missing");
  for (const name of ["expo", "expo-*", "@expo/*", "react", "react-dom", "react-native", "typescript", "@fullcalendar/*", "react-data-grid", "@floating-ui/*"]) {
    assert.ok(platform.includes(`- dependency-name: "${name}"`), `${name}: platform policy attached to another directory`);
  }
  assert.match(platform, /groups:\s*\n\s+minor-and-patch:/, "compatible platform updates must be grouped");
  assert.match(platform, /exclude-paths:\s*\n\s+- "apps\/mobile\/\*\*"/, "root updates must not reach the independent mobile graph");
});

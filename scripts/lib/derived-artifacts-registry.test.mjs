#!/usr/bin/env node
// Tests for the derived-artifact registry (BI-48768E05).

import { test } from "node:test";
import assert from "node:assert/strict";

import { globToRegExp, matchesGlob, matchesAnyGlob, affectedEntries, DERIVED_ARTIFACTS } from "./derived-artifacts-registry.mjs";

// ── glob matching ───────────────────────────────────────────────────────────

test("literal path matches only itself", () => {
  assert.equal(matchesGlob("pnpm-lock.yaml", "pnpm-lock.yaml"), true);
  assert.equal(matchesGlob("pnpm-lock.yamlx", "pnpm-lock.yaml"), false);
  assert.equal(matchesGlob("other/pnpm-lock.yaml", "pnpm-lock.yaml"), false);
});

test("single '*' matches within one path segment only", () => {
  assert.equal(matchesGlob("scripts/foo.mjs", "scripts/*.mjs"), true);
  assert.equal(matchesGlob("scripts/lib/foo.mjs", "scripts/*.mjs"), false);
});

test("'dir/**/*.md' matches nested and directly-under files", () => {
  assert.equal(matchesGlob("docs/foo.md", "docs/**/*.md"), true);
  assert.equal(matchesGlob("docs/user-guide/foo.md", "docs/**/*.md"), true);
  assert.equal(matchesGlob("docs/a/b/c/foo.md", "docs/**/*.md"), true);
  assert.equal(matchesGlob("docs/foo.ts", "docs/**/*.md"), false);
  assert.equal(matchesGlob("other/foo.md", "docs/**/*.md"), false);
});

test("trailing '/**' matches the whole subtree, at any depth", () => {
  assert.equal(matchesGlob("scripts/sbom/check-sbom-drift.mjs", "scripts/sbom/**"), true);
  assert.equal(matchesGlob("scripts/sbom/lib/x.mjs", "scripts/sbom/**"), true);
  assert.equal(matchesGlob("scripts/other.mjs", "scripts/sbom/**"), false);
});

test("matchesAnyGlob short-circuits on the first match", () => {
  assert.equal(matchesAnyGlob("pnpm-lock.yaml", ["docs/**/*.md", "pnpm-lock.yaml"]), true);
  assert.equal(matchesAnyGlob("pnpm-lock.yaml", ["docs/**/*.md"]), false);
});

test("regex produced by globToRegExp is fully anchored", () => {
  const re = globToRegExp("docs/**/*.md");
  assert.equal(re.test("xdocs/foo.md"), false);
  assert.equal(re.test("docs/foo.mdx"), false);
});

// ── registry shape ───────────────────────────────────────────────────────────

test("every registry entry has the required fields", () => {
  for (const entry of DERIVED_ARTIFACTS) {
    assert.equal(typeof entry.id, "string");
    assert.ok(entry.id.length > 0, `entry missing id: ${JSON.stringify(entry)}`);
    assert.ok(Array.isArray(entry.sourceGlobs) && entry.sourceGlobs.length > 0, `${entry.id}: sourceGlobs`);
    assert.ok(Array.isArray(entry.artifactPaths) && entry.artifactPaths.length > 0, `${entry.id}: artifactPaths`);
    assert.ok(Array.isArray(entry.generate) && entry.generate.length > 0, `${entry.id}: generate`);
    assert.ok(Array.isArray(entry.check) && entry.check.length > 0, `${entry.id}: check`);
  }
});

test("registry ids are unique", () => {
  const ids = DERIVED_ARTIFACTS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("enrolls the five generators required by BI-48768E05", () => {
  const ids = new Set(DERIVED_ARTIFACTS.map((e) => e.id));
  for (const expected of ["doc-index", "doc-impact", "doc-diagrams", "capability-service-catalog", "sbom-baseline"]) {
    assert.ok(ids.has(expected), `missing registry entry: ${expected}`);
  }
});

test("enrolls the route-derived registry chain (BI-34D69270)", () => {
  const ids = new Set(DERIVED_ARTIFACTS.map((e) => e.id));
  // All four must be present, in dependency order, so a route change regenerates
  // the whole chain at commit time (the #4295 latent-main-red class).
  const chain = ["route-manifest", "route-audience", "route-shells", "page-purpose"];
  for (const expected of chain) {
    assert.ok(ids.has(expected), `missing registry entry: ${expected}`);
  }
  const order = DERIVED_ARTIFACTS.map((e) => e.id).filter((id) => chain.includes(id));
  assert.deepEqual(order, chain, "route chain must be in dependency order (downstream reads upstream)");
});

test("sbom-baseline is registered with autoStage disabled (judgment call, not a pure function of sources)", () => {
  const entry = DERIVED_ARTIFACTS.find((e) => e.id === "sbom-baseline");
  assert.equal(entry.autoStage, false);
});

// ── affectedEntries ─────────────────────────────────────────────────────────

test("affectedEntries finds only entries whose sourceGlobs match a changed file", () => {
  const registry = [
    { id: "a", sourceGlobs: ["docs/**/*.md"] },
    { id: "b", sourceGlobs: ["pnpm-lock.yaml"] },
  ];
  const affected = affectedEntries(["docs/foo.md", "src/x.ts"], registry);
  assert.deepEqual(affected.map((e) => e.id), ["a"]);
});

test("affectedEntries returns nothing when no file matches", () => {
  const registry = [{ id: "a", sourceGlobs: ["docs/**/*.md"] }];
  assert.deepEqual(affectedEntries(["src/x.ts"], registry), []);
});

test("affectedEntries can return multiple entries for one changed-files set", () => {
  const registry = [
    { id: "a", sourceGlobs: ["docs/**/*.md"] },
    { id: "b", sourceGlobs: ["docs/user-guide/**/*.md"] },
  ];
  const affected = affectedEntries(["docs/user-guide/x.md"], registry);
  assert.deepEqual(affected.map((e) => e.id).sort(), ["a", "b"]);
});

// Tests for the shared pnpm-lock reader (plan 2026-09-08 §10.5 S3).
// Run: node --test scripts/lib/pnpm-lock.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  baseVersion,
  findImporterDependency,
  parseImporters,
  parsePackageKeys,
  parseSnapshots,
  splitNameVersion,
  topLevelSection,
  unquote,
} from "./pnpm-lock.mjs";

const LOCK = [
  "lockfileVersion: '9.0'",
  "",
  "settings:",
  "  autoInstallPeers: true",
  "",
  "importers:",
  "",
  "  .:",
  "    devDependencies:",
  "      typescript:",
  "        specifier: 6.0.3",
  "        version: 6.0.3",
  "",
  "  apps/web:",
  "    dependencies:",
  "      '@scope/lib':",
  "        specifier: workspace:*",
  "        version: link:../../packages/lib",
  "      next:",
  "        specifier: ^16.2.0",
  "        version: 16.2.9(@babel/core@7.29.7)(react@19.2.8)",
  "    optionalDependencies:",
  "      fsevents:",
  "        specifier: ^2.3.3",
  "        version: 2.3.3",
  "    dependenciesMeta:",
  "      '@scope/lib':",
  "        injected: true",
  "",
  "packages:",
  "",
  "  '@babel/core@7.29.7':",
  "    resolution: {integrity: sha512-x}",
  "    peerDependencies:",
  "      react: '*'",
  "    engines: {node: '>=6.9.0'}",
  "",
  "  next@16.2.9:",
  "    resolution: {integrity: sha512-y}",
  "",
  "snapshots:",
  "",
  "  '@babel/core@7.29.7': {}",
  "",
  "  next@16.2.9(@babel/core@7.29.7)(react@19.2.8):",
  "    dependencies:",
  "      '@babel/core': 7.29.7",
  "    optionalDependencies:",
  "      sharp: 0.34.5",
  "    transitivePeerDependencies:",
  "      - supports-color",
  "",
].join("\r\n");

test("baseVersion strips the peer suffix", () => {
  assert.equal(baseVersion("16.2.9(@babel/core@7.29.7)(react@19.2.8)"), "16.2.9");
  assert.equal(baseVersion("6.0.3"), "6.0.3");
  assert.equal(baseVersion(undefined), "");
});

test("unquote strips one pair of quotes", () => {
  assert.equal(unquote("'@scope/x'"), "@scope/x");
  assert.equal(unquote('"a"'), "a");
  assert.equal(unquote("plain"), "plain");
});

test("splitNameVersion handles scopes, peers and non-registry specs", () => {
  assert.deepEqual(splitNameVersion("@babel/core@7.29.7"), { name: "@babel/core", version: "7.29.7" });
  assert.deepEqual(splitNameVersion("next@16.2.9(react@19.2.8)"), { name: "next", version: "16.2.9" });
  assert.equal(splitNameVersion("lib@file:packages/lib"), null);
  assert.equal(splitNameVersion("x@https://example.test/x.tgz"), null);
  assert.equal(splitNameVersion("@scope"), null);
});

test("topLevelSection stops at the next column-0 key", () => {
  const section = topLevelSection(LOCK.replace(/\r\n/g, "\n").split("\n"), "settings:");
  assert.deepEqual(section, ["  autoInstallPeers: true", ""]);
  assert.deepEqual(topLevelSection(["a:"], "missing:"), []);
});

test("parsePackageKeys returns only 2-space keys (regression: no nested junk keys)", () => {
  // The release-age gate's old walk also matched indented lines such as
  // `    peerDependencies:` and emitted them as package keys.
  assert.deepEqual(parsePackageKeys(LOCK), ["@babel/core@7.29.7", "next@16.2.9"]);
});

test("parseImporters reads every dependency kind and ignores dependenciesMeta", () => {
  const imps = parseImporters(LOCK);
  assert.deepEqual(Object.keys(imps), [".", "apps/web"]);
  assert.deepEqual(imps["."].devDependencies, [{ name: "typescript", specifier: "6.0.3", version: "6.0.3" }]);
  assert.deepEqual(imps["apps/web"].dependencies, [
    { name: "@scope/lib", specifier: "workspace:*", version: "link:../../packages/lib" },
    { name: "next", specifier: "^16.2.0", version: "16.2.9(@babel/core@7.29.7)(react@19.2.8)" },
  ]);
  assert.deepEqual(imps["apps/web"].optionalDependencies, [{ name: "fsevents", specifier: "^2.3.3", version: "2.3.3" }]);
});

test("findImporterDependency searches all kinds", () => {
  const imps = parseImporters(LOCK);
  assert.equal(findImporterDependency(imps, "apps/web", "fsevents").kind, "optionalDependencies");
  assert.equal(findImporterDependency(imps, ".", "typescript").version, "6.0.3");
  assert.equal(findImporterDependency(imps, ".", "next"), null);
  assert.equal(findImporterDependency(imps, "nope", "next"), null);
});

test("parseSnapshots collects dependencies + optionalDependencies only", () => {
  const snaps = parseSnapshots(LOCK);
  assert.deepEqual([...snaps.keys()], ["@babel/core@7.29.7", "next@16.2.9(@babel/core@7.29.7)(react@19.2.8)"]);
  assert.deepEqual(snaps.get("@babel/core@7.29.7"), []);
  assert.deepEqual(snaps.get("next@16.2.9(@babel/core@7.29.7)(react@19.2.8)"), ["@babel/core@7.29.7", "sharp@0.34.5"]);
});

test("empty or missing input parses to empty results", () => {
  assert.deepEqual(parsePackageKeys(""), []);
  assert.deepEqual(parseImporters(undefined), {});
  assert.equal(parseSnapshots(null).size, 0);
});

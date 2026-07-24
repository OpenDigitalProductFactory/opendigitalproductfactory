#!/usr/bin/env node
// Tests for the lockfile release-age gate (BI-B175621A).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseReleaseAgePolicy,
  parseLockfilePackages,
  splitNameVersion,
  newRegistryEntries,
  classifyAges,
} from "./check-lockfile-release-age.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── policy parsing ───────────────────────────────────────────────────────────

test("parses minimumReleaseAge and returns 0 when absent", () => {
  assert.equal(parseReleaseAgePolicy("minimumReleaseAge: 1440\n").minutes, 1440);
  assert.equal(parseReleaseAgePolicy("packages:\n  - 'apps/*'\n").minutes, 0);
});

test("parses minimumReleaseAgeExclude in block and inline form", () => {
  const block = parseReleaseAgePolicy(
    "minimumReleaseAge: 60\nminimumReleaseAgeExclude:\n  - next-auth\n  - '@auth/core'\nallowBuilds:\n  sharp: true\n",
  );
  assert.deepEqual([...block.exclude].sort(), ["@auth/core", "next-auth"]);

  const inline = parseReleaseAgePolicy("minimumReleaseAgeExclude: ['a', \"b\"]\n");
  assert.deepEqual([...inline.exclude].sort(), ["a", "b"]);
});

test("exclude list stops at the next top-level key", () => {
  const { exclude } = parseReleaseAgePolicy(
    "minimumReleaseAgeExclude:\n  - only-this\nallowBuilds:\n  - not-this\n",
  );
  assert.deepEqual([...exclude], ["only-this"]);
});

// ── lockfile parsing ─────────────────────────────────────────────────────────

const LOCK = [
  "lockfileVersion: '9.0'",
  "importers:",
  "  .:",
  "    dependencies:",
  "      next-auth:",
  "        specifier: 5.0.0-beta.32",
  "packages:",
  "  '@auth/core@0.41.3':",
  "    resolution: {integrity: sha512-aaa}",
  "  next-auth@5.0.0-beta.32:",
  "    resolution: {integrity: sha512-bbb}",
  "snapshots:",
  "  next-auth@5.0.0-beta.32(react@19.2.7):",
  "    dependencies:",
  "",
].join("\n");

test("reads name@version keys from packages: and ignores importers/snapshots", () => {
  const keys = parseLockfilePackages(LOCK);
  assert.deepEqual([...keys].sort(), ["@auth/core@0.41.3", "next-auth@5.0.0-beta.32"]);
  // the peer-suffixed snapshot key must not leak in
  assert.ok(![...keys].some((k) => k.includes("(")));
});

test("returns empty when there is no packages: section", () => {
  assert.equal(parseLockfilePackages("lockfileVersion: '9.0'\nimporters:\n  .: {}\n").size, 0);
});

test("splits scoped and unscoped name@version, rejects non-registry specs", () => {
  assert.deepEqual(splitNameVersion("@auth/core@0.41.3"), { name: "@auth/core", version: "0.41.3" });
  assert.deepEqual(splitNameVersion("next-auth@5.0.0-beta.32"), {
    name: "next-auth",
    version: "5.0.0-beta.32",
  });
  assert.equal(splitNameVersion("foo@file:../local"), null);
  assert.equal(splitNameVersion("bar@https://example.com/x.tgz"), null);
  assert.equal(splitNameVersion("@scope/only"), null);
});

// ── diffing ──────────────────────────────────────────────────────────────────

test("only entries absent from base count as new", () => {
  const base = new Set(["a@1.0.0", "b@1.0.0"]);
  const head = new Set(["a@1.0.0", "b@2.0.0", "c@1.0.0"]);
  assert.deepEqual(
    newRegistryEntries(base, head).map((e) => e.key),
    ["b@2.0.0", "c@1.0.0"],
  );
});

test("a version bump counts as new even though the package is not", () => {
  const entries = newRegistryEntries(new Set(["x@1.0.0"]), new Set(["x@1.0.1"]));
  assert.deepEqual(entries, [{ key: "x@1.0.1", name: "x", version: "1.0.1" }]);
});

// ── classification ───────────────────────────────────────────────────────────

const NOW = new Date("2026-07-23T12:00:00Z");
const minutesAgo = (n) => new Date(NOW.getTime() - n * 60_000).toISOString();

test("younger than the floor is a violation, older is ok", () => {
  const entries = [
    { key: "young@1.0.0", name: "young", version: "1.0.0" },
    { key: "old@1.0.0", name: "old", version: "1.0.0" },
  ];
  const published = new Map([
    ["young@1.0.0", minutesAgo(10)],
    ["old@1.0.0", minutesAgo(5000)],
  ]);
  const res = classifyAges(entries, published, { minutes: 1440, exclude: new Set(), now: NOW });
  assert.deepEqual(res.violations.map((v) => v.key), ["young@1.0.0"]);
  assert.equal(res.violations[0].ageMinutes, 10);
  assert.deepEqual(res.ok.map((o) => o.key), ["old@1.0.0"]);
});

test("exactly at the floor passes (boundary is not a violation)", () => {
  const entries = [{ key: "edge@1.0.0", name: "edge", version: "1.0.0" }];
  const published = new Map([["edge@1.0.0", minutesAgo(1440)]]);
  const res = classifyAges(entries, published, { minutes: 1440, exclude: new Set(), now: NOW });
  assert.equal(res.violations.length, 0);
  assert.equal(res.ok.length, 1);
});

test("an excluded package is exempt even when brand new", () => {
  const entries = [{ key: "urgent@1.0.0", name: "urgent", version: "1.0.0" }];
  const published = new Map([["urgent@1.0.0", minutesAgo(1)]]);
  const res = classifyAges(entries, published, {
    minutes: 1440,
    exclude: new Set(["urgent"]),
    now: NOW,
  });
  assert.equal(res.violations.length, 0);
  assert.equal(res.ok[0].reason, "excluded");
});

test("a missing publish time is unknown, never a silent pass", () => {
  const entries = [{ key: "ghost@1.0.0", name: "ghost", version: "1.0.0" }];
  const res = classifyAges(entries, new Map([["ghost@1.0.0", null]]), {
    minutes: 1440,
    exclude: new Set(),
    now: NOW,
  });
  assert.equal(res.unknown.length, 1);
  assert.equal(res.violations.length, 0);
  assert.equal(res.ok.length, 0);
});

// ── the policy is actually committed ─────────────────────────────────────────

test("the repository declares a non-zero minimumReleaseAge", () => {
  // Guards the gate against its own escape hatch: if the policy is ever removed
  // from pnpm-workspace.yaml the gate exits 1 at runtime, and this test says so
  // at PR time instead.
  const { minutes } = parseReleaseAgePolicy(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"));
  assert.ok(minutes > 0, "pnpm-workspace.yaml must declare minimumReleaseAge");
});

test("no install path re-introduces a minimumReleaseAge=0 override", () => {
  // BI-B175621A: the worktree bootstrap used to pass --config.minimumReleaseAge=0.
  // Frozen installs skip resolution, so such an override is always either dead or
  // an active bypass of the floor.
  const bootstrap = readFileSync(join(ROOT, "scripts/lib/bootstrap-worktree-deps.mjs"), "utf8");
  const active = bootstrap
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
  assert.ok(
    !/minimumReleaseAge=0/.test(active),
    "bootstrap-worktree-deps.mjs must not disable the release-age floor",
  );
});

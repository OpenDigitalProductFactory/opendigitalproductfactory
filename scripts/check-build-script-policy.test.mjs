#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  auditBuildScriptPolicy,
  parseAllowBuilds,
} from "./check-build-script-policy.mjs";

const workspace = (body) => `packages:\n  - "apps/*"\nallowBuilds:\n${body}\npackageExtensions:\n`;

test("accepts explicit boolean allow and deny decisions", () => {
  const result = auditBuildScriptPolicy(
    workspace("  esbuild: true\n  '@scarf/scarf': false"),
  );

  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.duplicates, []);
  assert.deepEqual(result.decisions, new Map([
    ["esbuild", true],
    ["@scarf/scarf", false],
  ]));
});

test("rejects pnpm's unresolved build-script placeholder", () => {
  const result = auditBuildScriptPolicy(
    workspace("  '@scarf/scarf': set this to true or false"),
  );

  assert.deepEqual(result.unresolved, [
    { name: "@scarf/scarf", value: "set this to true or false" },
  ]);
});

test("rejects quoted booleans because they are not policy booleans", () => {
  const result = auditBuildScriptPolicy(workspace("  sharp: 'true'"));

  assert.deepEqual(result.unresolved, [{ name: "sharp", value: "'true'" }]);
});

test("rejects duplicate package decisions", () => {
  const result = auditBuildScriptPolicy(
    workspace("  sharp: true\n  sharp: false"),
  );

  assert.deepEqual(result.duplicates, ["sharp"]);
});

test("requires the allowBuilds policy block", () => {
  assert.throws(
    () => parseAllowBuilds("packages:\n  - apps/*\n"),
    /no `allowBuilds:` block found/,
  );
});

test("the live workspace has resolved policy and explicitly denies Scarf telemetry", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const result = auditBuildScriptPolicy(
    readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
  );

  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.duplicates, []);
  assert.equal(result.decisions.get("@scarf/scarf"), false);
});

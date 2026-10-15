#!/usr/bin/env node
// Tests for the New Dependency Gate's retired-name refusal (plan 2026-09-08 §7).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { findRetiredInUse } from "./check-new-dependencies.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a declared name on the retired list is reported; others are not", () => {
  const retired = { puppeteer: { retired: "2026-09-08", reason: "x" } };
  assert.deepEqual(findRetiredInUse(["zod", "puppeteer"], retired), ["puppeteer"]);
  assert.deepEqual(findRetiredInUse(["zod"], retired), []);
});

test("a missing retired map retires nothing, and inherited keys never match", () => {
  assert.deepEqual(findRetiredInUse(["toString", "zod"], undefined), []);
  assert.deepEqual(findRetiredInUse(["constructor"], {}), []);
});

test("the live allowlist never acknowledges a name it also retires", () => {
  const allow = JSON.parse(readFileSync(join(ROOT, "sbom", "dependency-allowlist.json"), "utf8"));
  const both = Object.keys(allow.retired ?? {}).filter((n) => Object.hasOwn(allow.dependencies, n));
  assert.deepEqual(both, []);
  for (const [name, entry] of Object.entries(allow.retired ?? {})) {
    assert.match(entry.retired, /^\d{4}-\d{2}-\d{2}$/, `${name} needs a retired date`);
    assert.ok(entry.reason && entry.reason.length > 20, `${name} needs a reason`);
  }
});

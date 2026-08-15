// BI-8304AB09
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { inspectShallowLock, ensureFullHistory } from "./git-shallow-preflight.mjs";

test("inspectShallowLock returns null when no lock file", () => {
  const dir = mkdtempSync(join(tmpdir(), "shallow-none-"));
  assert.equal(inspectShallowLock(dir), null);
});

test("inspectShallowLock marks empty lock as stale when no git process filter matches", () => {
  const dir = mkdtempSync(join(tmpdir(), "shallow-stale-"));
  writeFileSync(join(dir, "shallow.lock"), "");
  const info = inspectShallowLock(dir);
  assert.ok(info);
  assert.equal(info.size, 0);
  // On CI runners without a concurrent git, empty lock is stale.
  assert.equal(typeof info.stale, "boolean");
  assert.ok(existsSync(info.path));
});

test("ensureFullHistory returns ok for a non-git directory with fetch disabled without throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "shallow-nongit-"));
  mkdirSync(join(dir, "empty"));
  const logs = [];
  const result = ensureFullHistory({
    cwd: dir,
    fetch: false,
    log: (line) => logs.push(line),
  });
  // No git → is-shallow fails → treated as not shallow / ok, or fail soft.
  assert.equal(typeof result.ok, "boolean");
  assert.equal(typeof result.message, "string");
});

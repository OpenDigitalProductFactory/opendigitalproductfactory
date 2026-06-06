import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs } from "./runtime-artifact-janitor.mjs";
import { DEFAULT_STALENESS_DAYS } from "./lib/runtime-artifact-janitor.mjs";

test("defaults to dry-run with the 7-day staleness threshold", () => {
  const opts = parseArgs([]);
  assert.equal(opts.apply, false);
  assert.equal(opts.stalenessDays, DEFAULT_STALENESS_DAYS);
  assert.equal(opts.json, false);
});

test("--apply (and the --live alias) enable destructive mode", () => {
  assert.equal(parseArgs(["--apply"]).apply, true);
  assert.equal(parseArgs(["--live"]).apply, true);
});

test("--dry-run overrides a prior --apply on the same line", () => {
  assert.equal(parseArgs(["--apply", "--dry-run"]).apply, false);
});

test("--staleness-days accepts both space and = forms", () => {
  assert.equal(parseArgs(["--staleness-days", "14"]).stalenessDays, 14);
  assert.equal(parseArgs(["--staleness-days=30"]).stalenessDays, 30);
});

test("--json sets the machine-readable flag", () => {
  assert.equal(parseArgs(["--json"]).json, true);
});

test("a non-positive or non-numeric staleness threshold is rejected", () => {
  assert.throws(() => parseArgs(["--staleness-days", "0"]), /positive number/);
  assert.throws(() => parseArgs(["--staleness-days", "-3"]), /positive number/);
  assert.throws(() => parseArgs(["--staleness-days", "abc"]), /positive number/);
});

test("an unknown flag is rejected", () => {
  assert.throws(() => parseArgs(["--wipe-everything"]), /unknown argument/);
});

test("--help is parsed without error", () => {
  assert.equal(parseArgs(["--help"]).help, true);
});

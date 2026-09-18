import { test } from "node:test";
import assert from "node:assert/strict";
import { pageBuildBudget } from "./build-memory-budget.mjs";

test("the failed 16 GiB, many-core builder uses two serial page workers", () => {
  assert.deepEqual(pageBuildBudget({ memoryBytes: 16 * 1024 ** 3, cpuCount: 12 }),
    { cpus: 2, staticGenerationMaxConcurrency: 1 });
});

test("small or unknown memory and a single CPU never fan out", () => {
  for (const memoryBytes of [0, NaN, Infinity, -1, 4 * 1024 ** 3, 8 * 1024 ** 3]) {
    assert.equal(pageBuildBudget({ memoryBytes, cpuCount: 12 }).cpus, 1);
  }
  assert.equal(pageBuildBudget({ memoryBytes: 64 * 1024 ** 3, cpuCount: 1 }).cpus, 1);
});

test("large hosts retain the conservative cap until a new measurement supports expansion", () => {
  assert.equal(pageBuildBudget({ memoryBytes: 128 * 1024 ** 3, cpuCount: 64 }).cpus, 2);
});

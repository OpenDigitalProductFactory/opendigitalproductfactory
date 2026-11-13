import { test } from "node:test";
import assert from "node:assert/strict";
import { pageBuildBudget, builderMemoryCapFromEnv } from "./build-memory-budget.mjs";

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

test("builderMemoryCapFromEnv prefers CGROUP_MEMORY_LIMIT_BYTES over DPF_LOCAL_CI_BUILDER_MEMORY_BYTES", () => {
  const origCgroup = process.env.CGROUP_MEMORY_LIMIT_BYTES;
  const origBuilder = process.env.DPF_LOCAL_CI_BUILDER_MEMORY_BYTES;
  try {
    // Both set — cgroup wins
    process.env.CGROUP_MEMORY_LIMIT_BYTES = String(16 * 1024 ** 3);
    process.env.DPF_LOCAL_CI_BUILDER_MEMORY_BYTES = String(32 * 1024 ** 3);
    assert.equal(builderMemoryCapFromEnv(), 16 * 1024 ** 3);

    // Only builder env set
    delete process.env.CGROUP_MEMORY_LIMIT_BYTES;
    assert.equal(builderMemoryCapFromEnv(), 32 * 1024 ** 3);

    // Neither set
    delete process.env.DPF_LOCAL_CI_BUILDER_MEMORY_BYTES;
    assert.equal(builderMemoryCapFromEnv(), null);

    // Only cgroup set
    process.env.CGROUP_MEMORY_LIMIT_BYTES = String(8 * 1024 ** 3);
    assert.equal(builderMemoryCapFromEnv(), 8 * 1024 ** 3);
  } finally {
    if (origCgroup !== undefined) process.env.CGROUP_MEMORY_LIMIT_BYTES = origCgroup;
    else delete process.env.CGROUP_MEMORY_LIMIT_BYTES;
    if (origBuilder !== undefined) process.env.DPF_LOCAL_CI_BUILDER_MEMORY_BYTES = origBuilder;
    else delete process.env.DPF_LOCAL_CI_BUILDER_MEMORY_BYTES;
  }
});

test("builderMemoryCapFromEnv rejects invalid values", () => {
  const origCgroup = process.env.CGROUP_MEMORY_LIMIT_BYTES;
  const origBuilder = process.env.DPF_LOCAL_CI_BUILDER_MEMORY_BYTES;
  try {
    for (const invalid of ["", "0", "-1", "NaN", "Infinity", "abc"]) {
      process.env.CGROUP_MEMORY_LIMIT_BYTES = invalid;
      delete process.env.DPF_LOCAL_CI_BUILDER_MEMORY_BYTES;
      assert.equal(builderMemoryCapFromEnv(), null, `should reject cgroup value "${invalid}"`);
    }
  } finally {
    if (origCgroup !== undefined) process.env.CGROUP_MEMORY_LIMIT_BYTES = origCgroup;
    else delete process.env.CGROUP_MEMORY_LIMIT_BYTES;
    if (origBuilder !== undefined) process.env.DPF_LOCAL_CI_BUILDER_MEMORY_BYTES = origBuilder;
    else delete process.env.DPF_LOCAL_CI_BUILDER_MEMORY_BYTES;
  }
});

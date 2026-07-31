import assert from "node:assert/strict";
import test from "node:test";

import {
  buildxBuildArgs,
  buildxCreateArgs,
  classifyBoundedBuildExit,
  databaseUrlFromContainerEnvironment,
  validateBuilderInspection,
} from "./local-ci-bounded-builder.mjs";

const builder = {
  name: "dpf-local-ci-buildkit-v2-0",
  container: "buildx_buildkit_dpf-local-ci-buildkit-v2-00",
  memoryBytes: 16 * 1024 ** 3,
  cpuQuota: 800_000,
  cpuPeriod: 100_000,
  maxParallelism: 4,
};

test("Buildx create uses the slot-scoped mechanical resource boundary", () => {
  assert.deepEqual(buildxCreateArgs(builder, "scripts/config/local-ci-buildkitd.toml"), [
    "buildx", "create",
    "--name", builder.name,
    "--driver", "docker-container",
    "--driver-opt", "memory=16g",
    "--driver-opt", "cpu-quota=800000",
    "--driver-opt", "cpu-period=100000",
    "--driver-opt", "default-load=true",
    "--buildkitd-config", "scripts/config/local-ci-buildkitd.toml",
    "--bootstrap",
  ]);
});

test("resource-limit termination is infrastructure evidence, not a product red", () => {
  assert.deepEqual(classifyBoundedBuildExit({
    exitCode: 1,
    output: "ResourceExhausted: next build cannot allocate memory",
  }), {
    status: "blocked_control_plane_starvation",
    exitCode: 5,
    failures: ["builder:resource-exhausted"],
  });
  assert.deepEqual(classifyBoundedBuildExit({
    exitCode: 1,
    output: "TypeScript error TS2322",
  }), {
    status: "failed",
    exitCode: 1,
    failures: [],
  });
});

test("live PostgreSQL credentials are encoded without assuming the install password", () => {
  assert.equal(databaseUrlFromContainerEnvironment(
    "POSTGRES_USER=dpf\r\nPOSTGRES_PASSWORD=secret with:/?\r\nPOSTGRES_DB=dpf\r\n",
  ), "postgresql://dpf:secret%20with%3A%2F%3F@127.0.0.1:5432/dpf");
  assert.throws(
    () => databaseUrlFromContainerEnvironment("POSTGRES_USER=dpf"),
    /password is unavailable/,
  );
});

test("Buildx build preserves the canonical loaded image artifact", () => {
  assert.deepEqual(buildxBuildArgs({ builder, tag: "dpf-test-build", context: "." }), [
    "buildx", "build", "--builder", builder.name,
    "--target", "build", "--tag", "dpf-test-build", "--load", ".",
  ]);
});

test("effective builder inspection must match every declared ceiling", () => {
  assert.deepEqual(validateBuilderInspection(builder, {
    driver: "docker-container",
    container: builder.container,
    memoryBytes: builder.memoryBytes,
    cpuQuota: builder.cpuQuota,
    cpuPeriod: builder.cpuPeriod,
  }), { ok: true, failures: [] });

  const drift = validateBuilderInspection(builder, {
    driver: "docker",
    container: builder.container,
    memoryBytes: 0,
    cpuQuota: 0,
    cpuPeriod: builder.cpuPeriod,
  });
  assert.equal(drift.ok, false);
  assert.deepEqual(drift.failures.sort(), ["cpu-quota", "driver", "memory"]);
});

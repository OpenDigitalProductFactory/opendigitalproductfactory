import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BUILD_WATCHDOG_FAILURE_LIMITS,
  classifyControlPlaneSample,
  establishHealthyControlPlane,
  monitorControlPlane,
  terminateProcessTreeCommand,
} from "./local-ci-control-plane-watchdog.mjs";

const healthy = {
  portal: { healthy: true, elapsedMs: 4 },
  mcp: { healthy: true, elapsedMs: 5 },
  docker: { healthy: true, elapsedMs: 7 },
  postgres: { healthy: true, elapsedMs: 3 },
};

test("all four independent surfaces must be healthy", () => {
  assert.deepEqual(classifyControlPlaneSample(healthy), {
    healthy: true,
    failures: [],
  });
  assert.deepEqual(classifyControlPlaneSample({
    ...healthy,
    portal: { healthy: false, reason: "http-200-invalid-payload" },
    docker: { healthy: false, reason: "timeout" },
  }), {
    healthy: false,
    failures: ["portal:http-200-invalid-payload", "docker:timeout"],
  });
});

test("one transient round recovers without tripping the boundary", async () => {
  const rounds = [
    { ...healthy, mcp: { healthy: false, reason: "timeout" } },
    healthy,
    healthy,
  ];
  let complete = false;
  const result = await monitorControlPlane({
    sample: async () => {
      const value = rounds.shift();
      if (rounds.length === 0) complete = true;
      return value;
    },
    isComplete: () => complete,
    wait: async () => {},
    consecutiveFailureLimit: 2,
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.samples.length, 3);
});

test("alternating single-surface misses do not form a sustained starvation breach", async () => {
  const rounds = [
    { ...healthy, portal: { healthy: false, reason: "timeout" } },
    { ...healthy, mcp: { healthy: false, reason: "timeout" } },
    healthy,
  ];
  let complete = false;
  const result = await monitorControlPlane({
    sample: async () => {
      const value = rounds.shift();
      if (rounds.length === 0) complete = true;
      return value;
    },
    isComplete: () => complete,
    wait: async () => {},
    consecutiveFailureLimit: 2,
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.samples.length, 3);
});

test("publishes every control-plane sample for durable stage heartbeats", async () => {
  const observed = [];
  let complete = false;
  const result = await monitorControlPlane({
    sample: async () => {
      complete = true;
      return healthy;
    },
    isComplete: () => complete,
    wait: async () => {},
    onSample: async (sample) => observed.push(sample),
  });
  assert.equal(result.status, "healthy");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].healthy, true);
  assert.deepEqual(observed[0].consecutiveFailureLimits, {
    portal: 3,
    mcp: 3,
    docker: 2,
    postgres: 2,
  });
});

test("default request-surface limits allow two misses followed by recovery", async (t) => {
  for (const surface of ["portal", "mcp"]) {
    await t.test(surface, async () => {
      const rounds = [
        { ...healthy, [surface]: { healthy: false, reason: "timeout" } },
        { ...healthy, [surface]: { healthy: false, reason: "timeout" } },
        healthy,
      ];
      let complete = false;
      const result = await monitorControlPlane({
        sample: async () => {
          const value = rounds.shift();
          if (rounds.length === 0) complete = true;
          return value;
        },
        isComplete: () => complete,
        wait: async () => {},
      });
      assert.equal(result.status, "healthy");
      assert.equal(result.samples.length, 3);
    });
  }
});

test("default request-surface limits fence a third consecutive miss", async (t) => {
  for (const surface of ["portal", "mcp"]) {
    await t.test(surface, async () => {
      const result = await monitorControlPlane({
        sample: async () => ({
          ...healthy,
          [surface]: { healthy: false, reason: "timeout" },
        }),
        isComplete: () => false,
        wait: async () => {},
      });
      assert.equal(result.status, "blocked_control_plane_starvation");
      assert.equal(result.samples.length, 3);
      assert.deepEqual(result.failures, [`${surface}:timeout`]);
    });
  }
});

test("default process-local surface limits remain fail-closed at two misses", async (t) => {
  for (const surface of ["docker", "postgres"]) {
    await t.test(surface, async () => {
      const result = await monitorControlPlane({
        sample: async () => ({
          ...healthy,
          [surface]: { healthy: false, reason: "timeout" },
        }),
        isComplete: () => false,
        wait: async () => {},
      });
      assert.equal(result.status, "blocked_control_plane_starvation");
      assert.equal(result.samples.length, 2);
      assert.deepEqual(result.failures, [`${surface}:timeout`]);
    });
  }
});

test("the default build-watchdog policy is immutable", () => {
  assert.equal(Object.isFrozen(DEFAULT_BUILD_WATCHDOG_FAILURE_LIMITS), true);
});

test("two consecutive unhealthy rounds form a sustained starvation breach", async () => {
  const result = await monitorControlPlane({
    sample: async () => ({
      ...healthy,
      postgres: { healthy: false, reason: "timeout" },
    }),
    isComplete: () => false,
    wait: async () => {},
    consecutiveFailureLimit: 2,
  });
  assert.equal(result.status, "blocked_control_plane_starvation");
  assert.equal(result.samples.length, 2);
  assert.deepEqual(result.failures, ["postgres:timeout"]);
});

test("a breach names only the surface whose consecutive limit was reached", async () => {
  const rounds = [
    { ...healthy, portal: { healthy: false, reason: "timeout" } },
    {
      ...healthy,
      portal: { healthy: false, reason: "timeout" },
      mcp: { healthy: false, reason: "connection-reset" },
    },
  ];
  const result = await monitorControlPlane({
    sample: async () => rounds.shift(),
    isComplete: () => false,
    wait: async () => {},
    consecutiveFailureLimit: 2,
  });
  assert.equal(result.status, "blocked_control_plane_starvation");
  assert.deepEqual(result.failures, ["portal:timeout"]);
});

test("a recovered surface resets only its own consecutive history", async () => {
  const rounds = [
    {
      ...healthy,
      portal: { healthy: false, reason: "timeout" },
      mcp: { healthy: false, reason: "timeout" },
    },
    { ...healthy, mcp: { healthy: false, reason: "timeout" } },
  ];
  const observed = [];
  const result = await monitorControlPlane({
    sample: async () => rounds.shift(),
    isComplete: () => false,
    wait: async () => {},
    onSample: async (sample) => observed.push(sample),
    consecutiveFailureLimit: 2,
  });
  assert.equal(result.status, "blocked_control_plane_starvation");
  assert.deepEqual(observed.map((sample) => sample.consecutiveFailures), [
    { portal: 1, mcp: 1, docker: 0, postgres: 0 },
    { portal: 0, mcp: 2, docker: 0, postgres: 0 },
  ]);
  assert.deepEqual(result.failures, ["mcp:timeout"]);
});

test("an unhealthy control plane blocks the build before it starts", async () => {
  const result = await establishHealthyControlPlane({
    sample: async () => ({
      ...healthy,
      portal: { healthy: false, reason: "timeout" },
    }),
    wait: async () => {},
  });
  assert.equal(result.status, "blocked_control_plane_starvation");
  assert.equal(result.samples.length, 2);
  assert.deepEqual(result.failures, ["portal:timeout"]);
});

test("process-tree termination stays local to the admitted build", () => {
  assert.deepEqual(terminateProcessTreeCommand(4321, "win32"), {
    command: "taskkill.exe",
    args: ["/PID", "4321", "/T", "/F"],
  });
  assert.deepEqual(terminateProcessTreeCommand(4321, "linux"), {
    command: "kill",
    args: ["-TERM", "-4321"],
  });
});

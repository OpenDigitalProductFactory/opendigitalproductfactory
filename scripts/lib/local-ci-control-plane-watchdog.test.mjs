import assert from "node:assert/strict";
import test from "node:test";

import {
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

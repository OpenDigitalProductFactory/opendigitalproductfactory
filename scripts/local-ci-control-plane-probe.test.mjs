// BI-24D5D7C2 — a deadline on one control-plane probe must not read as a broken
// endpoint, and must not be tight enough to abort a build that is fine.
//
// BI-3A008EBC — and a broken endpoint must say WHICH way it was broken. A wedged
// engine, an engine that is not running, a missing binary and a deadline are four
// different operator actions; they used to be one string, `docker:invalid-response`.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  classifyDockerProbeFailure,
  commandHealthy,
  controlPlaneEngineAdvisory,
  isTimeoutRejection,
  timedProbe,
} from "./local-ci-bounded-build.mjs";

test("recognises an inner mcpCall deadline as a timeout", () => {
  // The live repro: elapsedMs 2519 against a 2500ms mcpCall deadline, reported
  // as "request-failed" because the message was not the bare word "timeout".
  assert.equal(
    isTimeoutRejection(new Error("mcpCall: get_quiescence_status timed out after 2500ms")),
    true,
  );
});

test("recognises the bare local race rejection", () => {
  assert.equal(isTimeoutRejection(new Error("timeout")), true);
});

test("recognises an AbortSignal.timeout rejection by name", () => {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  assert.equal(isTimeoutRejection(error), true);
});

test("does NOT call a genuine connection fault a timeout", () => {
  // The distinction is the whole point: a real fault must stay reported as one.
  assert.equal(isTimeoutRejection(new Error("ECONNREFUSED 127.0.0.1:3000")), false);
  assert.equal(isTimeoutRejection(new Error("invalid JSON response")), false);
});

test("survives a non-Error rejection", () => {
  assert.equal(isTimeoutRejection("timed out"), true);
  assert.equal(isTimeoutRejection(undefined), false);
});

// ---------------------------------------------------------------------------
// BI-3A008EBC — the docker probe names what it saw.
// ---------------------------------------------------------------------------

test("a daemon that answered with an HTTP error is engine-error, and names the status", () => {
  // Observed 2026-09-10 with 13 GB of host memory free: the engine was wedged,
  // not starved, and the remedy was clearing orphaned AF_UNIX sockets
  // (BI-DDA569D9) — nothing to do with memory.
  const reason = classifyDockerProbeFailure({
    exitCode: 1,
    stderrTail: "request returned 500 Internal Server Error for API route and version"
      + " http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.55/containers/json,"
      + " check if the server supports the requested API version",
  });
  assert.match(reason, /^engine-error/);
  assert.match(reason, /500/, "the operator needs the status the daemon returned");
});

test("an absent engine pipe is engine-unreachable, not engine-error", () => {
  // Second rung of the same outage: once the stale backend was gone the pipe
  // simply did not exist. Different remedy — start Docker — so different reason.
  const reason = classifyDockerProbeFailure({
    exitCode: 1,
    stderrTail: "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;"
      + " check if the path is correct and if the daemon is running:"
      + " open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.",
  });
  assert.equal(reason, "engine-unreachable");
});

test("the POSIX phrasing of an absent daemon is also engine-unreachable", () => {
  const reason = classifyDockerProbeFailure({
    exitCode: 1,
    stderrTail: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock."
      + " Is the docker daemon running?",
  });
  assert.equal(reason, "engine-unreachable");
});

test("a missing docker binary is binary-missing, not a broken engine", () => {
  const spawnError = new Error("spawn docker ENOENT");
  spawnError.code = "ENOENT";
  assert.equal(classifyDockerProbeFailure({ spawnError }), "binary-missing");
});

test("a docker probe that ran out of time is a timeout, never invalid-response", () => {
  // BI-24D5D7C2 established "a deadline is a deadline". commandHealthy resolved
  // false on its own timer, so that guarantee never reached the shell-out probe.
  assert.equal(classifyDockerProbeFailure({ timedOut: true }), "timeout");
  // A deadline outranks whatever partial stderr was captured before it fired.
  assert.equal(
    classifyDockerProbeFailure({ timedOut: true, exitCode: null, stderrTail: "Is the docker daemon running?" }),
    "timeout",
  );
});

test("an unrecognised docker failure still falls back to invalid-response", () => {
  // The fallback must survive: a reason we cannot classify is not a licence to
  // invent one.
  assert.equal(
    classifyDockerProbeFailure({ exitCode: 1, stderrTail: "something nobody has seen before" }),
    "invalid-response",
  );
  assert.equal(classifyDockerProbeFailure({ exitCode: 1, stderrTail: "" }), "invalid-response");
  assert.equal(classifyDockerProbeFailure({}), "invalid-response");
});

test("the four docker conditions are four distinct reasons", () => {
  const reasons = new Set([
    classifyDockerProbeFailure({ exitCode: 1, stderrTail: "request returned 500 Internal Server Error" }),
    classifyDockerProbeFailure({ exitCode: 1, stderrTail: "Is the docker daemon running?" }),
    classifyDockerProbeFailure({ spawnError: new Error("spawn docker ENOENT") }),
    classifyDockerProbeFailure({ timedOut: true }),
  ]);
  assert.equal(reasons.size, 4, `all four collapsed into: ${[...reasons].join(", ")}`);
});

// ---------------------------------------------------------------------------
// timedProbe must carry a probe's own verdict through, without disturbing the
// boolean probes (portal, mcp, postgres) that share it.
// ---------------------------------------------------------------------------

test("timedProbe passes a probe's own reason and detail through", async () => {
  const result = await timedProbe(async () => ({
    healthy: false,
    reason: "engine-error (500)",
    detail: { exitCode: 1, stderrTail: "request returned 500 Internal Server Error" },
  }));
  assert.equal(result.healthy, false);
  assert.equal(result.reason, "engine-error (500)");
  assert.equal(result.detail.stderrTail, "request returned 500 Internal Server Error");
  assert.equal(typeof result.elapsedMs, "number");
});

test("timedProbe still treats a bare true/false exactly as before", async () => {
  const healthy = await timedProbe(async () => true);
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.reason, undefined, "a healthy probe carries no reason");

  const unhealthy = await timedProbe(async () => false);
  assert.equal(unhealthy.healthy, false);
  assert.equal(unhealthy.reason, "invalid-response");
});

test("timedProbe keeps classifying its own rejections", async () => {
  const timedOut = await timedProbe(async () => {
    throw new Error("mcpCall: get_quiescence_status timed out after 2500ms");
  });
  assert.equal(timedOut.reason, "timeout");

  const failed = await timedProbe(async () => {
    throw new Error("ECONNREFUSED 127.0.0.1:3000");
  });
  assert.equal(failed.reason, "request-failed");
});

// ---------------------------------------------------------------------------
// commandHealthy stops throwing away the evidence.
// ---------------------------------------------------------------------------

/** A spawn stub shaped like the child_process surface commandHealthy uses. */
function fakeSpawn({ exitCode = 0, stderr = "", error = null, hang = false } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    if (hang) return child;
    setImmediate(() => {
      if (error) {
        child.emit("error", error);
        return;
      }
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", exitCode);
    });
    return child;
  };
}

test("commandHealthy reports the exit code and a stderr tail instead of a bare boolean", async () => {
  const outcome = await commandHealthy("docker", ["info"], 1_000, {
    spawnImpl: fakeSpawn({ exitCode: 1, stderr: "request returned 500 Internal Server Error\n" }),
  });
  assert.equal(outcome.healthy, false);
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.stderrTail, /500 Internal Server Error/);
  assert.equal(outcome.timedOut, false);
});

test("commandHealthy is still healthy on exit 0", async () => {
  const outcome = await commandHealthy("docker", ["info"], 1_000, {
    spawnImpl: fakeSpawn({ exitCode: 0 }),
  });
  assert.equal(outcome.healthy, true);
});

test("commandHealthy surfaces a spawn error rather than swallowing it", async () => {
  const error = new Error("spawn docker ENOENT");
  error.code = "ENOENT";
  const outcome = await commandHealthy("docker", ["info"], 1_000, {
    spawnImpl: fakeSpawn({ error }),
  });
  assert.equal(outcome.healthy, false);
  assert.equal(outcome.spawnError?.code, "ENOENT");
});

test("commandHealthy marks its own deadline as a timeout and kills the child", async () => {
  let spawned;
  const outcome = await commandHealthy("docker", ["info"], 20, {
    spawnImpl: () => {
      spawned = fakeSpawn({ hang: true })();
      return spawned;
    },
  });
  assert.equal(outcome.healthy, false);
  assert.equal(outcome.timedOut, true);
  assert.equal(spawned.killed, true, "a probe that gave up must not leave the child running");
});

test("the stderr tail is bounded so a chatty failure cannot bloat the evidence", async () => {
  const outcome = await commandHealthy("docker", ["info"], 1_000, {
    spawnImpl: fakeSpawn({ exitCode: 1, stderr: "x".repeat(20_000) }),
  });
  assert.ok(
    outcome.stderrTail.length <= 2_000,
    `stderr tail was ${outcome.stderrTail.length} chars; evidence payloads are written to disk`,
  );
});

// ---------------------------------------------------------------------------
// The abandonment line must not let "starvation" stand as the cause when the
// engine itself answered badly.
// ---------------------------------------------------------------------------

test("an engine failure earns an advisory that contradicts the starvation wording", () => {
  const advisory = controlPlaneEngineAdvisory(["docker:engine-error (500)", "postgres:engine-unreachable"]);
  assert.ok(advisory, "a wedged engine must not be reported as starvation alone");
  assert.match(advisory, /NOT host memory pressure/);
  assert.match(advisory, /engine-error \(500\)/, "name the reason that was actually observed");
  assert.match(advisory, /BI-DDA569D9/, "point at the recovery that owns this failure");
});

test("an absent engine and a missing binary also earn the advisory", () => {
  assert.ok(controlPlaneEngineAdvisory(["docker:engine-unreachable"]));
  assert.ok(controlPlaneEngineAdvisory(["docker:binary-missing"]));
});

test("genuine host pressure earns NO advisory, so the wording is not diluted", () => {
  // A real timeout or an unclassifiable failure IS consistent with starvation.
  assert.equal(controlPlaneEngineAdvisory(["docker:timeout", "postgres:timeout"]), null);
  assert.equal(controlPlaneEngineAdvisory(["portal:request-failed"]), null);
  assert.equal(controlPlaneEngineAdvisory(["docker:invalid-response"]), null);
  assert.equal(controlPlaneEngineAdvisory([]), null);
  assert.equal(controlPlaneEngineAdvisory(undefined), null);
});

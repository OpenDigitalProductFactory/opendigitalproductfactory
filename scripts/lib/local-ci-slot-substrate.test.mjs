import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assessSlotSubstrate,
  ensureSlotPostgres,
  slotSubstrateRemedy,
} from "./local-ci-slot-substrate.mjs";

// A scripted `docker`: each call returns the next result for its subcommand.
function fakeDocker(script) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push(args.join(" "));
    const queue = script[args[0]] ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next ?? { status: 1, stdout: "", stderr: "unexpected" };
  };
  return { run, calls };
}

const inspected = (status, exitCode = 0) => ({ status: 0, stdout: `${status}|${exitCode}\n`, stderr: "" });
const missing = { status: 1, stdout: "", stderr: "Error: No such object: dpf-local-ci-postgres-0" };

test("a running slot Postgres is available and nothing is started", () => {
  const docker = fakeDocker({ inspect: [inspected("running")] });
  const probe = ensureSlotPostgres("dpf-local-ci-postgres-0", { run: docker.run });
  assert.deepEqual(probe, { container: "dpf-local-ci-postgres-0", state: "running", available: true, started: false });
  assert.equal(docker.calls.some((c) => c.startsWith("start")), false);
});

test("an absent slot Postgres is available: the runner provisions it", () => {
  const docker = fakeDocker({ inspect: [missing] });
  const probe = ensureSlotPostgres("dpf-local-ci-postgres-0", { run: docker.run });
  assert.equal(probe.available, true);
  assert.equal(probe.state, "absent");
});

test("an exited slot Postgres is started before the claim, and counts as available once running", () => {
  const docker = fakeDocker({ inspect: [inspected("exited", 255), inspected("running")], start: [{ status: 0, stdout: "", stderr: "" }] });
  const probe = ensureSlotPostgres("dpf-local-ci-postgres-1", { run: docker.run });
  assert.equal(probe.available, true);
  assert.equal(probe.started, true);
  assert.ok(docker.calls.includes("start dpf-local-ci-postgres-1"));
});

test("an exited slot Postgres that will not start is unavailable and says why", () => {
  const docker = fakeDocker({
    inspect: [inspected("exited", 255)],
    start: [{ status: 1, stdout: "", stderr: "Error response from daemon: driver failed programming external connectivity" }],
  });
  const probe = ensureSlotPostgres("dpf-local-ci-postgres-1", { run: docker.run });
  assert.equal(probe.available, false);
  assert.equal(probe.state, "exited (255)");
  assert.match(probe.error, /driver failed/);
});

test("the pool is blocked only when NO slot's substrate can run", () => {
  const up = { container: "dpf-local-ci-postgres-0", state: "running", available: true };
  const down = { container: "dpf-local-ci-postgres-1", state: "exited (255)", available: false };
  assert.equal(assessSlotSubstrate([up, down]).blocked, false);
  const verdict = assessSlotSubstrate([{ ...up, available: false, state: "dead" }, down]);
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.container, "dpf-local-ci-postgres-0");
  assert.equal(verdict.state, "dead");
  assert.match(verdict.remedy, /dpf-local-ci-postgres-0/);
});

test("the remedy says the gate already tried to start it and carries Docker's refusal", () => {
  const remedy = slotSubstrateRemedy("dpf-local-ci-postgres-1", "port is already allocated");
  assert.match(remedy, /already tried `docker start dpf-local-ci-postgres-1`/);
  assert.match(remedy, /port is already allocated/);
});

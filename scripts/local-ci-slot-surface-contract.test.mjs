import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("gate, runner, freshness, and Compose consume the slot manifest contract", () => {
  const gate = read("scripts/gate-worktree.mjs");
  const runner = read("scripts/local-ci-runner.mjs");
  const shellRunner = read("scripts/local-ci-runner.sh");
  const freshness = read("scripts/sandbox-freshness-preflight.mjs");
  const compose = read("docker-compose.local-ci.yml");

  assert.match(gate, /createLocalCiSlotManifest/);
  assert.match(gate, /localCiSlotEnvironment/);
  assert.doesNotMatch(gate, /ports:\s*\[3010\]/);
  assert.doesNotMatch(gate, /dpf-local-ci-owner\.json/);

  assert.match(runner, /createLocalCiSlotManifest/);
  assert.match(runner, /manifest\.postgres\.container/);
  assert.match(runner, /manifest\.scratch\.workspace/);
  assert.doesNotMatch(runner, /tcpReachable\("127\.0\.0\.1", 5433\)/);
  assert.doesNotMatch(runner, /\["inspect", "dpf-local-ci-postgres"/);

  assert.match(freshness, /DPF_LOCAL_CI_FRESHNESS_LOCK/);
  assert.match(freshness, /DPF_LOCAL_CI_FRESH_STORE/);

  assert.match(compose, /COMPOSE_PROJECT_NAME:\?/);
  assert.match(compose, /DPF_LOCAL_CI_PORT:\?/);
  assert.match(compose, /DPF_LOCAL_CI_TEST_DATABASE_URL:\?/);
  assert.match(compose, /DPF_LOCAL_CI_SOURCE_VOLUME:\?/);
  assert.doesNotMatch(compose, /3010:3000/);
  assert.doesNotMatch(compose, /host\.docker\.internal:5433/);

  assert.match(shellRunner, /exec node .*local-ci-runner\.mjs/);
  assert.doesNotMatch(shellRunner, /docker (run|rm|start)/);
});

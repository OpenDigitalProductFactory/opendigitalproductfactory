import assert from "node:assert/strict";
import test from "node:test";

import { findManualCacheDrops, isExemptPath } from "./check-no-manual-vm-cache-drop.mjs";

// Literal recipes are assembled from parts so this self-test does not trip the
// guard it tests.
const DROP = ["drop", "caches"].join("_");
const PROC = `/proc/sys/vm/${DROP}`;

test("AC-7: flags the sync-then-drop recipe that wedged the Docker VM", () => {
  const hits = findManualCacheDrops(
    `docker run --rm --privileged alpine sh -c 'sync; echo 3 > ${PROC}'\n`,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
});

test("AC-7: flags any write to the drop-caches knob, with or without sync", () => {
  for (const line of [
    `wsl -d docker-desktop -e sh -c 'echo 1 > ${PROC}'`,
    `echo 3 | tee ${PROC}`,
    `sysctl -w vm.${DROP}=3`,
    `sysctl vm.${DROP}=1`,
  ]) {
    assert.equal(findManualCacheDrops(line).length, 1, line);
  }
});

test("prose that only names the knob is not a recipe", () => {
  assert.deepEqual(
    findManualCacheDrops(`The kernel documents vm.${DROP} as a testing aid.\n`),
    [],
  );
  assert.deepEqual(findManualCacheDrops("git sync; npm run build\n"), []);
  assert.deepEqual(
    findManualCacheDrops(`// no session action helps, so nobody reaches for ${DROP} or sync again\n`),
    [],
  );
  assert.equal(findManualCacheDrops(`sync && cat /proc/sys/vm/${DROP}\n`).length, 1);
});

test("design history and the guard's own files are exempt", () => {
  assert.equal(isExemptPath("docs/superpowers/specs/2026-09-25-platform-owned-local-ci-memory-design.md"), true);
  assert.equal(isExemptPath("scripts/check-no-manual-vm-cache-drop.mjs"), true);
  assert.equal(isExemptPath("scripts/check-no-manual-vm-cache-drop.test.mjs"), true);
  assert.equal(isExemptPath("scripts/local-ci-bounded-build.mjs"), false);
  assert.equal(isExemptPath("docs/testing/pre-pr-gate.md"), false);
  assert.equal(isExemptPath("packages/dpf-skill-pack/skills/x/SKILL.md"), false);
});

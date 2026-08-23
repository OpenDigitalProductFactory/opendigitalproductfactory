// Self-test for the twin-artifact set-parity ratchet (BI-788EC51A).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractImageMatrixBlocks,
  compareImageSets,
  parseBaseline,
  findTwinViolations,
} from "./check-no-twin-artifact-drift.mjs";

// ─── Rule 1: image-matrix set parity ─────────────────────────────────────

const WORKFLOW_BOTH_SHAPES = `
jobs:
  build:
    strategy:
      matrix:
        image:
          - name: dpf-portal
            context: .
            file: Dockerfile
          # comment inside the list
          - name: dpf-postgres
            context: .
            file: docker/postgres/Dockerfile
        platform:
          - arch: amd64
  merge:
    strategy:
      matrix:
        image:
          - dpf-portal
          - dpf-postgres
`;

test("extracts object-style (build) and scalar-style (merge) image lists", () => {
  const blocks = extractImageMatrixBlocks(WORKFLOW_BOTH_SHAPES);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { job: "build", line: blocks[0].line, images: ["dpf-portal", "dpf-postgres"] });
  assert.equal(blocks[1].job, "merge");
  assert.deepEqual(blocks[1].images, ["dpf-portal", "dpf-postgres"]);
});

test("ignores a scalar service-container image line (image: pgvector/...)", () => {
  const blocks = extractImageMatrixBlocks(`
jobs:
  test:
    services:
      postgres:
        image: pgvector/pgvector:pg16
`);
  assert.equal(blocks.length, 0);
});

test("GREEN: identical build and merge sets produce no violations", () => {
  const blocks = extractImageMatrixBlocks(WORKFLOW_BOTH_SHAPES);
  assert.deepEqual(compareImageSets("wf.yml", blocks), []);
});

// RED case (incident a, PR #4371): image in the build matrix, missing from merge.
test("RED: one-sided matrix entry (build has dpf-postgres, merge does not) fails", () => {
  const blocks = extractImageMatrixBlocks(`
jobs:
  build:
    strategy:
      matrix:
        image:
          - name: dpf-portal
            context: .
          - name: dpf-postgres
            context: .
  merge:
    strategy:
      matrix:
        image:
          - dpf-portal
`);
  const violations = compareImageSets("publish-image.yml", blocks);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /dpf-postgres/);
  assert.match(violations[0], /"build".*NOT in the "merge"/);
  assert.match(violations[0], /publish-image\.yml/);
});

test("RED: the symmetric direction (merge-only image) also fails", () => {
  const blocks = extractImageMatrixBlocks(`
jobs:
  build:
    strategy:
      matrix:
        image:
          - dpf-portal
  merge:
    strategy:
      matrix:
        image:
          - dpf-portal
          - dpf-ghost
`);
  const violations = compareImageSets("wf.yml", blocks);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /dpf-ghost/);
});

test("a lone image list (single block in a file) is not compared", () => {
  const blocks = extractImageMatrixBlocks(`
jobs:
  only:
    strategy:
      matrix:
        image:
          - dpf-portal
`);
  assert.equal(blocks.length, 1);
  assert.deepEqual(compareImageSets("wf.yml", blocks), []);
});

// ─── Rule 2: sh/ps1 twins ────────────────────────────────────────────────

const EMPTY = () => "";

test("GREEN: paired twins in a norm dir pass with an empty baseline", () => {
  const { violations, staleBaseline } = findTwinViolations(
    ["scripts/hooks/mcp-health.sh", "scripts/hooks/mcp-health.ps1"],
    new Set(),
    EMPTY,
  );
  assert.deepEqual(violations, []);
  assert.deepEqual(staleBaseline, []);
});

// RED case (incident b, BI-68EED40A shape): a norm-dir script with no twin.
test("RED: seeded missing twin (norm-dir .sh with no .ps1) fails", () => {
  const { violations } = findTwinViolations(
    ["scripts/installer/new-thing.sh"],
    new Set(),
    EMPTY,
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /scripts\/installer\/new-thing\.sh/);
  assert.match(violations[0], /missing \.ps1 twin/);
});

test("RED: the ps1-side single is caught too", () => {
  const { violations } = findTwinViolations(
    ["scripts/safety/only-win.ps1"],
    new Set(),
    EMPTY,
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /missing \.sh twin/);
});

test("a baselined single-sided file passes; the entry is not stale", () => {
  const { violations, staleBaseline } = findTwinViolations(
    ["scripts/installer/lib/compose.sh"],
    new Set(["scripts/installer/lib/compose.sh"]),
    EMPTY,
  );
  assert.deepEqual(violations, []);
  assert.deepEqual(staleBaseline, []);
});

test("shrink-only: a baseline entry whose file gained its twin is stale", () => {
  const { violations, staleBaseline } = findTwinViolations(
    ["scripts/installer/lib/compose.sh", "scripts/installer/lib/compose.ps1"],
    new Set(["scripts/installer/lib/compose.sh"]),
    EMPTY,
  );
  assert.deepEqual(violations, []);
  assert.deepEqual(staleBaseline, ["scripts/installer/lib/compose.sh"]);
});

test("shrink-only: a baseline entry whose file is gone is stale", () => {
  const { staleBaseline } = findTwinViolations([], new Set(["scripts/installer/lib/gone.sh"]), EMPTY);
  assert.deepEqual(staleBaseline, ["scripts/installer/lib/gone.sh"]);
});

test("test artifacts (.test.sh / .Tests.ps1) are exempt from twin existence", () => {
  const { violations } = findTwinViolations(
    ["scripts/safety/dpf-shell-guard.test.sh", "scripts/installer/windows-install-drive.Tests.ps1"],
    new Set(),
    EMPTY,
  );
  assert.deepEqual(violations, []);
});

test("outside twin-norm dirs, a single-sided script is not a violation", () => {
  const { violations } = findTwinViolations(["scripts/backup-postgres.sh"], new Set(), EMPTY);
  assert.deepEqual(violations, []);
});

// ─── Rule 2b: twin-contract marker parity ────────────────────────────────

test("GREEN: identical twin-contract key sets pass", () => {
  const contents = {
    "scripts/setup.sh": "#!/bin/sh\n# twin-contract: lockfile-guard\necho hi\n",
    "scripts/setup.ps1": "# twin-contract: lockfile-guard\nWrite-Host hi\n",
  };
  const { violations } = findTwinViolations(
    Object.keys(contents),
    new Set(),
    (f) => contents[f],
  );
  assert.deepEqual(violations, []);
});

// RED case: marker present in one twin, absent from the other.
test("RED: a twin-contract marker missing from the ps1 twin fails", () => {
  const contents = {
    "scripts/setup.sh": "# twin-contract: lockfile-guard\n# twin-contract: state-migration\n",
    "scripts/setup.ps1": "# twin-contract: lockfile-guard\n",
  };
  const { violations } = findTwinViolations(Object.keys(contents), new Set(), (f) => contents[f]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /scripts\/setup\.ps1/);
  assert.match(violations[0], /state-migration/);
});

test("RED: a marker only in the ps1 twin fails the sh side", () => {
  const contents = {
    "scripts/setup.sh": "echo hi\n",
    "scripts/setup.ps1": "# twin-contract: registry-cleanup\n",
  };
  const { violations } = findTwinViolations(Object.keys(contents), new Set(), (f) => contents[f]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /scripts\/setup\.sh/);
  assert.match(violations[0], /registry-cleanup/);
});

test("marker parity applies to pairs OUTSIDE norm dirs too", () => {
  const contents = {
    "scripts/redeploy-portal.sh": "# twin-contract: quiesce-first\n",
    "scripts/redeploy-portal.ps1": "",
  };
  const { violations } = findTwinViolations(Object.keys(contents), new Set(), (f) => contents[f]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /quiesce-first/);
});

// ─── Baseline parsing ────────────────────────────────────────────────────

test("baseline parser skips comments/blanks and returns entries", () => {
  const set = parseBaseline("# header\n\nscripts/installer/lib/compose.sh\n");
  assert.deepEqual([...set], ["scripts/installer/lib/compose.sh"]);
});

test("RED: duplicate baseline paths fail closed", () => {
  assert.throws(
    () => parseBaseline("scripts/installer/lib/compose.sh\nscripts/installer/lib/compose.sh\n"),
    /duplicate baseline entry/,
  );
});

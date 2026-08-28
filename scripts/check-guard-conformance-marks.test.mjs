// Tests for the guard-conformance-marks guard (BI-7B249AFE).
//
// Every fixture here is inline. The guard reads the repository; its test must
// not, or the test becomes the thing the guard exists to catch — and would then
// itself need the mark it is asserting about.

import { test } from "node:test";
import assert from "node:assert/strict";

import { findUnmarkedConformanceCommands } from "./check-guard-conformance-marks.mjs";
import {
  isConformanceAssertionSource,
  liveRepoReads,
} from "./lib/guard-conformance-detect.mjs";
import {
  isPolicyGuardSelfTest,
  isPolicyGuardConformanceCommand,
} from "./lib/ci-policy-guards.mjs";

const CONFORMANCE_SOURCE = `
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
test("the committed baseline matches the plane", () => {
  const text = readFileSync(join(REPO_ROOT, "scripts", "baseline.txt"), "utf8");
  assert.ok(text.length > 0);
});
`;

const UNIT_SOURCE = `
import { evaluate } from "./check-thing.mjs";
test("a dropped rule fails", () => {
  assert.equal(evaluate({ text: "- **A rule.**" }).errors.length, 1);
});
`;

// The exact false-positive shape that made the first detector useless: an
// embedded fixture script, written into a mkdtemp sandbox, whose own body says
// `const root = process.cwd()`. That is the TEMP root, not the repository.
const EMBEDDED_FIXTURE_SOURCE = `
import { fileURLToPath } from "node:url";
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "build-docs-staleness.mjs");
const root = mkdtempSync(join(tmpdir(), "docs-"));
writeFileSync(join(binDir, "fake.mjs"), \`#!/usr/bin/env node
const root = process.cwd();
writeFileSync(join(root, "log.txt"), "x");
\`);
const out = spawnSync("node", [SCRIPT], { cwd: root, encoding: "utf8" });
`;

const guardWith = (commands) => [{ id: "probe", legacyJobId: "probe", name: "Probe", commands }];

test("a test that reads the repo through its own root binding is a conformance assertion", () => {
  assert.equal(isConformanceAssertionSource(CONFORMANCE_SOURCE), true);
  assert.equal(liveRepoReads(CONFORMANCE_SOURCE).length, 1);
});

test("a test built from inline fixtures is not", () => {
  assert.equal(isConformanceAssertionSource(UNIT_SOURCE), false);
});

test("spawning the script under test at a temp root is not a conformance assertion", () => {
  // Both traps in one file: `process.cwd()` inside an embedded fixture string,
  // and a spawn whose cwd is the sandbox rather than the repository.
  assert.equal(isConformanceAssertionSource(EMBEDDED_FIXTURE_SOURCE), false);
});

test("spawning the guard AT the repository root is a conformance assertion", () => {
  const source = `
    const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
    const out = spawnSync("node", [cli], { cwd: REPO_ROOT, encoding: "utf8" });
  `;
  assert.equal(isConformanceAssertionSource(source), true);
});

test("stripSelfTests' predicate keeps a marked command and drops an unmarked one", () => {
  const marked = ["node", ["--test", "scripts/a.test.mjs"], { conformance: true }];
  const unmarked = ["node", ["--test", "scripts/a.test.mjs"]];
  assert.equal(isPolicyGuardSelfTest(marked), false, "a marked command must survive the strip");
  assert.equal(isPolicyGuardSelfTest(unmarked), true);
  assert.equal(isPolicyGuardConformanceCommand(marked), true);
  assert.equal(isPolicyGuardConformanceCommand(unmarked), false);
  // The optimisation itself is untouched: a pnpm package self-test still strips.
  assert.equal(isPolicyGuardSelfTest(["pnpm", ["run", "web:test"]]), true);
});

test("an unmarked repository-reading self-test is reported", () => {
  const findings = findUnmarkedConformanceCommands({
    profiles: { source: guardWith([["node", ["--test", "scripts/a.test.mjs"]]]) },
    profileNames: ["source"],
    readSource: () => CONFORMANCE_SOURCE,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "scripts/a.test.mjs");
  assert.equal(findings[0].guardId, "probe");
  assert.ok(findings[0].reads[0].includes("REPO_ROOT"));
});

test("the same file carried by a marked command is not reported", () => {
  const findings = findUnmarkedConformanceCommands({
    profiles: {
      source: guardWith([["node", ["--test", "scripts/a.test.mjs"], { conformance: true }]]),
    },
    profileNames: ["source"],
    readSource: () => CONFORMANCE_SOURCE,
  });
  assert.deepEqual(findings, []);
});

test("a genuine unit test is never asked to carry the mark", () => {
  const findings = findUnmarkedConformanceCommands({
    profiles: { source: guardWith([["node", ["--test", "scripts/a.test.mjs"]]]) },
    profileNames: ["source"],
    readSource: () => UNIT_SOURCE,
  });
  assert.deepEqual(findings, [], "over-marking would spend the preflight budget on CI's work");
});

test("a multi-file command is reported per offending file, not per command", () => {
  const findings = findUnmarkedConformanceCommands({
    profiles: {
      source: guardWith([["node", ["--test", "scripts/a.test.mjs", "scripts/b.test.mjs"]]]),
    },
    profileNames: ["source"],
    readSource: (file) => (file === "scripts/a.test.mjs" ? CONFORMANCE_SOURCE : UNIT_SOURCE),
  });
  assert.deepEqual(findings.map((entry) => entry.file), ["scripts/a.test.mjs"]);
});

test("a file that cannot be read is skipped rather than failing the guard", () => {
  const findings = findUnmarkedConformanceCommands({
    profiles: { source: guardWith([["node", ["--test", "scripts/gone.test.mjs"]]]) },
    profileNames: ["source"],
    readSource: () => null,
  });
  assert.deepEqual(findings, []);
});

test("non-test commands are never candidates", () => {
  const findings = findUnmarkedConformanceCommands({
    profiles: { source: guardWith([["node", ["scripts/check-thing.mjs"]]]) },
    profileNames: ["source"],
    readSource: () => CONFORMANCE_SOURCE,
  });
  assert.deepEqual(findings, []);
});

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

test("a repo-reading sample held as a STRING is fixture text, not a read", () => {
  // This guard's own test carries conformance samples as string constants, so
  // an unblanked scan reports the test that asserts the detector — caught by
  // running the guard over the real registry.
  const source = [
    'const SAMPLE = `',
    'const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");',
    'readFileSync(join(REPO_ROOT, "scripts", "baseline.txt"), "utf8");',
    '`;',
    'test("detects it", () => { assert.ok(detect(SAMPLE)); });',
  ].join("\n");
  assert.equal(isConformanceAssertionSource(source), false);
});

test("blanking literals does not hide a real read that sits beside one", () => {
  const source = [
    'const ROOT = dirname(fileURLToPath(import.meta.url));',
    'const SAMPLE = "readFileSync(join(ROOT, \'x\'))";',
    'const real = readFileSync(join(ROOT, "AGENTS.md"), "utf8");',
  ].join("\n");
  assert.equal(isConformanceAssertionSource(source), true);
  assert.equal(liveRepoReads(source).length, 1, "the quoted sample must not count as a second read");
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

// ---------------------------------------------------------------------------
// BI-30E3E229 — two surfaces the original detector could not see. Both are
// regressions from PR #5905, where the preflight reported "77 guards clean"
// while CI failed deterministically on scripts/ci-policy-guards.test.mjs.
//
// `exists` is injected throughout: this file must never touch the repository.
// ---------------------------------------------------------------------------

/** A read of a real repo file by cwd-relative literal — and NO root binding. */
const LITERAL_PATH_SOURCE = `
import { readFileSync } from "node:fs";
test("the workflow still pins the shard count", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /shard/);
});
`;

/** The registry-inventory shape: imported collection vs a literal inventory. */
const IMPORTED_REGISTRY_SOURCE = `
import { POLICY_GUARD_PROFILES } from "./lib/ci-policy-guards.mjs";

const EXPECTED_LEGACY_JOBS = [
  "alpha-guard",
  "beta-guard",
];

test("accounts for every registered guard exactly once", () => {
  const entries = Object.values(POLICY_GUARD_PROFILES).flat();
  assert.deepEqual(entries.map((e) => e.legacyJobId).sort(), EXPECTED_LEGACY_JOBS);
});
`;

const yes = () => true;
const no = () => false;

test("surface 2: a repo-relative literal read counts even with no root binding", () => {
  // The original detector returned [] here: with no fileURLToPath binding it
  // abandoned the file before examining a single read.
  assert.equal(isConformanceAssertionSource(LITERAL_PATH_SOURCE, { exists: yes }), true);
  const reads = liveRepoReads(LITERAL_PATH_SOURCE, { exists: yes });
  assert.equal(reads.length, 1);
  assert.match(reads[0].text, /\.github\/workflows\/ci\.yml/);
});

test("surface 2: a literal that names no repository file is not a conformance read", () => {
  assert.equal(isConformanceAssertionSource(LITERAL_PATH_SOURCE, { exists: no }), false);
});

test("surface 2: a read of a sandbox path built at runtime is still not a conformance read", () => {
  const sandbox = `
import { readFileSync, mkdtempSync } from "node:fs";
test("writes into a sandbox", () => {
  const dir = mkdtempSync(join(tmpdir(), "x-"));
  const text = readFileSync(join(dir, "out.json"), "utf8");
  assert.ok(text);
});
`;
  // The path is an expression, not a string literal, so no literal is recovered.
  assert.equal(isConformanceAssertionSource(sandbox, { exists: yes }), false);
});

test("surface 2: a read written inside a fixture string is not counted", () => {
  const embedded = [
    "const FIXTURE = `",
    '  const text = readFileSync(".github/workflows/ci.yml", "utf8");',
    "`;",
    "test(\"parses\", () => { assert.ok(parse(FIXTURE)); });",
  ].join("\n");
  assert.equal(isConformanceAssertionSource(embedded, { exists: yes }), false);
});

test("surface 3: an imported registry deep-compared to a literal inventory is detected", () => {
  assert.equal(isConformanceAssertionSource(IMPORTED_REGISTRY_SOURCE, { exists: no }), true);
  const reads = liveRepoReads(IMPORTED_REGISTRY_SOURCE, { exists: no });
  assert.equal(reads.length, 1);
  assert.match(reads[0].text, /POLICY_GUARD_PROFILES imported from \.\/lib\/ci-policy-guards\.mjs/);
});

test("surface 3: an INVOKED import is the unit under test, not a registry", () => {
  const unit = `
import { evaluate } from "./check-thing.mjs";

const EXPECTED_CODES = ["a", "b"];

test("maps codes", () => {
  assert.deepEqual(evaluate({}).map((r) => r.code), EXPECTED_CODES);
});
`;
  assert.equal(isConformanceAssertionSource(unit, { exists: no }), false);
});

test("surface 3: an imported constant with no inventory to compare against is not detected", () => {
  const plain = `
import { MIN_KEYS } from "./check-thing.mjs";
test("floor is positive", () => {
  assert.ok(MIN_KEYS > 0);
});
`;
  assert.equal(isConformanceAssertionSource(plain, { exists: no }), false);
});

test("surface 3: a bare package import is never a repository read", () => {
  const external = `
import { describe } from "node:test";

const EXPECTED = ["x"];

test("uses a collection", () => {
  assert.deepEqual(Object.values(describe).flat(), EXPECTED);
});
`;
  assert.equal(isConformanceAssertionSource(external, { exists: no }), false);
});

test("the original root-binding surface still works and is not double-counted", () => {
  assert.equal(isConformanceAssertionSource(CONFORMANCE_SOURCE, { exists: no }), true);
  assert.equal(isConformanceAssertionSource(UNIT_SOURCE, { exists: no }), false);
});

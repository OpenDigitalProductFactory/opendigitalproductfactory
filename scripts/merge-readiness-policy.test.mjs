import assert from "node:assert/strict";
import test from "node:test";

import {
  compareProtection,
  evaluateDependencyResults,
  parseWorkflowJobIds,
  validateWorkflowConformance,
} from "./merge-readiness-policy.mjs";

const CANCELLED_HINT = evaluateDependencyResults({ j: { result: "cancelled" } }).failures[0].hint;

const manifest = {
  requiredContexts: ["Merge Readiness", "UX Route Budget Sweep", "DCO"],
  strict: false,
  workflows: { ci: "ci.yml", ux: "ux.yml" },
  aggregateJobId: "merge-readiness",
  aggregateJobName: "Merge Readiness",
  uxJobId: "ux-route-sweep",
  uxJobName: "UX Route Budget Sweep",
  uxRuntimeJobId: "sweep",
  uxRuntimeJobName: "UX Route Sweep Runtime",
};

test("dependency evaluator accepts only success and intentional skips", () => {
  assert.deepEqual(evaluateDependencyResults({
    build: { result: "success" },
    optional: { result: "skipped" },
  }), { ok: true, failures: [] });
  assert.deepEqual(evaluateDependencyResults({
    build: { result: "failure" },
    cancelled: { result: "cancelled" },
  }), {
    ok: false,
    failures: [
      { jobId: "build", result: "failure", hint: "" },
      { jobId: "cancelled", result: "cancelled", hint: CANCELLED_HINT },
    ],
  });
});

test("a cancelled dependency names its likely causes (BI-F75AADB7)", () => {
  // "build concluded cancelled" alone reads as a second, unrelated failure and
  // gives no hint that the cause was a timeout rather than a queue eviction or a
  // user cancel — and a cancelled job keeps no retrievable log to check.
  const { failures } = evaluateDependencyResults({ build: { result: "cancelled" } });
  assert.match(failures[0].hint, /timeout/);
  assert.match(failures[0].hint, /queue eviction/);
  assert.match(failures[0].hint, /log is not retrievable/);
  // Ordinary failures carry their own log, so they get no extra prose.
  assert.equal(evaluateDependencyResults({ build: { result: "failure" } }).failures[0].hint, "");
});

test("workflow conformance requires complete aggregate coverage and merge-group triggers", () => {
  const ci = `on:\n  merge_group:\njobs:\n  build:\n    name: Build\n  lint:\n    name: Lint\n  ux-route-sweep-runtime:\n    name: UX Route Sweep Runtime\n  ux-route-sweep:\n    name: UX Route Budget Sweep\n  merge-readiness:\n    name: Merge Readiness\n    needs:\n      - build\n      - ux-route-sweep-runtime\n      - ux-route-sweep\n`;
  const ux = `on:\n  workflow_call:\njobs:\n  sweep:\n    name: UX Route Sweep Runtime\n`;
  assert.deepEqual(parseWorkflowJobIds(ci), [
    "build",
    "lint",
    "ux-route-sweep-runtime",
    "ux-route-sweep",
    "merge-readiness",
  ]);
  assert.deepEqual(validateWorkflowConformance({ manifest, ciSource: ci, uxSource: ux }), [
    "aggregate is missing CI jobs: lint",
  ]);
});

test("protection comparison de-duplicates legacy contexts and app-bound checks", () => {
  assert.equal(compareProtection(manifest, {
    strict: false,
    contexts: ["DCO"],
    checks: [
      { context: "Merge Readiness", app_id: 1 },
      { context: "UX Route Budget Sweep", app_id: 2 },
    ],
  }).ok, true);
});
import { readFileSync } from 'node:fs';
import { DEFAULT_MANIFEST, parseAggregate } from './merge-readiness-policy.mjs';
const repositoryManifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, 'utf8'));
const ciPath = repositoryManifest.workflows.ci;
const toolchainPath = '.github/workflows/agent-toolchain-bootstrap-smoke.yml';
const sources = () => ({ manifest: repositoryManifest,
  ciSource: readFileSync(ciPath, 'utf8'),
  uxSource: readFileSync(repositoryManifest.workflows.ux, 'utf8'),
  toolchainSource: readFileSync(toolchainPath, 'utf8') });

test('deployment-critical toolchain is bound to the required aggregate', () => {
  const input = sources();
  assert.equal(input.manifest.workflows.toolchain, toolchainPath);
  assert.equal(input.manifest.toolchainJobId, 'agent-toolchain-bootstrap');
  assert.ok(parseAggregate(input.ciSource, 'merge-readiness').needs.includes('agent-toolchain-bootstrap'));
  assert.deepEqual(validateWorkflowConformance(input), []);
});

test('toolchain wiring cannot disappear, redirect, suppress failures or lose callable admission', () => {
  const input = sources();
  const mutations = [
    { ...input, ciSource: input.ciSource.replace('      - agent-toolchain-bootstrap\n', '') },
    { ...input, ciSource: input.ciSource.replace(`uses: ./${toolchainPath}`, 'uses: ./wrong.yml') },
    { ...input, ciSource: input.ciSource.replace('  agent-toolchain-bootstrap:\n', '  agent-toolchain-bootstrap:\n    continue-on-error: true\n') },
    { ...input, ciSource: input.ciSource.replaceAll("if: needs.changes.outputs.heavy == 'true'", 'if: false') },
    { ...input, toolchainSource: input.toolchainSource.replace('  workflow_call:\n', '') },
  ];
  for (const [index, mutation] of mutations.entries()) assert.notEqual(validateWorkflowConformance(mutation).length, 0, `mutation ${index}`);
});

test('a failing or cancelled toolchain blocks aggregate readiness', () => {
  for (const result of ['failure', 'cancelled', undefined]) {
    assert.equal(evaluateDependencyResults({ 'agent-toolchain-bootstrap': { result } }).ok, false);
  }
  assert.equal(evaluateDependencyResults({ 'agent-toolchain-bootstrap': { result: 'success' } }).ok, true);
  assert.equal(evaluateDependencyResults({ 'agent-toolchain-bootstrap': { result: 'skipped' } }).ok, true);
});

// scripts/lib/bootstrap-worktree-deps.test.mjs
// Node built-in test runner (no node_modules needed): node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyReadiness, readinessReason } from "./bootstrap-worktree-deps.mjs";

test("compile-ready ONLY when deps resolved AND the cheap gate passes", () => {
  assert.equal(classifyReadiness({ hasNodeModules: true, depProbeOk: true, gateOk: true }), "compile-ready");
  assert.equal(classifyReadiness({ hasNodeModules: true, depProbeOk: true, gateOk: false }), "source-only");
  assert.equal(classifyReadiness({ hasNodeModules: true, depProbeOk: false, gateOk: false }), "source-only");
  assert.equal(classifyReadiness({ hasNodeModules: false, depProbeOk: false, gateOk: false }), "source-only");
});

test("readinessReason explains the source-only cause", () => {
  assert.equal(readinessReason({ hasNodeModules: false, depProbeOk: false, gateOk: false }), "node_modules_missing");
  assert.equal(readinessReason({ hasNodeModules: true, depProbeOk: false, gateOk: false }), "dependency_resolution_failed");
  assert.equal(readinessReason({ hasNodeModules: true, depProbeOk: true, gateOk: false }), "cheap_gate_failed");
  assert.equal(readinessReason({ hasNodeModules: true, depProbeOk: true, gateOk: true }), "managed_bootstrap_ok");
});

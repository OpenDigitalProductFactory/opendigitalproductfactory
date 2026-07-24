// scripts/lib/bootstrap-worktree-deps.test.mjs
// Node built-in test runner (no node_modules needed): node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyReadiness,
  readinessReason,
  checkWorkspaceLinksResolveLocally,
  probeWorktreeReadiness,
} from "./bootstrap-worktree-deps.mjs";

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

test("readinessReason reports workspace_links_stale ahead of the generic cheap-gate reason", () => {
  assert.equal(
    readinessReason({ hasNodeModules: true, depProbeOk: true, gateOk: false, staleWorkspaceLinks: [{ name: "db", target: "/other" }] }),
    "workspace_links_stale",
  );
  assert.equal(
    readinessReason({ hasNodeModules: true, depProbeOk: true, gateOk: true, staleWorkspaceLinks: [] }),
    "managed_bootstrap_ok",
  );
});

test("checkWorkspaceLinksResolveLocally: no @dpf scope -> ok (nothing to check)", () => {
  const result = checkWorkspaceLinksResolveLocally("/wt/topic", { readdir: () => [] });
  assert.deepEqual(result, { ok: true, stale: [] });
});

test("checkWorkspaceLinksResolveLocally: every link resolves inside the worktree -> ok", () => {
  const result = checkWorkspaceLinksResolveLocally("/wt/topic", {
    readdir: () => ["db", "types"],
    realpath: (p) => p.replace("/node_modules/@dpf/", "/packages/"),
  });
  assert.deepEqual(result, { ok: true, stale: [] });
});

test("checkWorkspaceLinksResolveLocally: flags the 2026-07-24 stale-junction class — a link resolving into a SIBLING worktree", () => {
  const result = checkWorkspaceLinksResolveLocally("/wt/wt-73432", {
    readdir: () => ["db", "types"],
    realpath: (p) =>
      p.endsWith("/db")
        ? "/wt/objective-elion-e68a30/packages/db" // stale: a different worktree entirely
        : p.replace("/node_modules/@dpf/", "/packages/"), // types: fine
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.stale, [{ name: "db", target: "/wt/objective-elion-e68a30/packages/db" }]);
});

test("checkWorkspaceLinksResolveLocally: a broken link is not a staleness finding (dependency_resolution_failed covers it)", () => {
  const result = checkWorkspaceLinksResolveLocally("/wt/topic", {
    readdir: () => ["db"],
    realpath: () => null,
  });
  assert.deepEqual(result, { ok: true, stale: [] });
});

test("probeWorktreeReadiness: no node_modules -> source-only / node_modules_missing, never installs", () => {
  const result = probeWorktreeReadiness("/wt/does-not-exist");
  assert.equal(result.status, "source-only");
  assert.equal(result.reason, "node_modules_missing");
  assert.equal(result.checks.hasNodeModules, false);
});

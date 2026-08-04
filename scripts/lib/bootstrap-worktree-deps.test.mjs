// scripts/lib/bootstrap-worktree-deps.test.mjs
// Node built-in test runner (no node_modules needed): node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyReadiness,
  readinessReason,
  checkWorkspaceLinksResolveLocally,
  probeWorktreeReadiness,
  missingCompileArtifacts,
  formatReadinessBanner,
  diagnoseUnprovisionedFailure,
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

// ── BI-1C1483C6: verification-readiness must be SURFACED, not just computed ──

test("missingCompileArtifacts treats an EMPTY directory as missing", () => {
  // The observed 2026-08-04 shape: apps/web/node_modules EXISTED with 0 entries.
  // existsSync alone would have called that provisioned.
  const present = new Set(["/wt/apps/web/node_modules", "/wt/packages/db/generated"]);
  const missing = missingCompileArtifacts("/wt", {
    exists: (p) => present.has(p),
    readdir: (p) => (p === "/wt/apps/web/node_modules" ? [] : ["client"]),
  });
  const byPath = Object.fromEntries(missing.map((m) => [m.path, m.state]));
  assert.equal(byPath["node_modules"], "absent");
  assert.equal(byPath["apps/web/node_modules"], "empty");
  assert.equal(byPath["packages/db/generated"], undefined, "a populated artifact is not missing");
});

test("missingCompileArtifacts names what each absence FORBIDS", () => {
  const missing = missingCompileArtifacts("/wt", { exists: () => false, readdir: () => [] });
  assert.equal(missing.length, 3);
  assert.ok(missing.every((m) => m.forbids && m.label), "every finding must name a label and a consequence");
  assert.match(
    missing.find((m) => m.path === "apps/web/node_modules").forbids,
    /'next' is not recognized/,
  );
});

test("the banner is silent for a compile-ready worktree", () => {
  assert.deepEqual(formatReadinessBanner({ status: "compile-ready", reason: "managed_bootstrap_ok" }, "/wt"), []);
});

test("the banner names the tree, the gaps, and forbids claiming an unrun gate", () => {
  const lines = formatReadinessBanner(
    {
      status: "source-only",
      reason: "node_modules_missing",
      missing: [{ label: "root node_modules", state: "absent", forbids: "any pnpm script" }],
    },
    "D:/DPF-worktrees/topic",
  );
  assert.match(lines[0], /SOURCE-ONLY/);
  assert.ok(lines.some((l) => l.includes("D:/DPF-worktrees/topic")));
  assert.ok(lines.some((l) => l.includes("root node_modules")));
  assert.ok(lines.some((l) => /do not claim a gate you cannot run/i.test(l)));
  assert.ok(lines.some((l) => /junction/i.test(l)), "the junction foot-gun must travel with the fix instruction");
});

test("an unprovisioned signature is relabelled only when the probe corroborates it", () => {
  const sourceOnly = { status: "source-only", missing: [{ path: "node_modules" }] };
  const hit = diagnoseUnprovisionedFailure("Error: Cannot find package 'react' imported from x", sourceOnly);
  assert.equal(hit.unprovisioned, true);
  assert.match(hit.explanation, /UNPROVISIONED WORKTREE, not a code defect/);
  assert.match(hit.explanation, /never a bare `pnpm install`/);
});

test("the same text in a COMPILE-READY tree stays a real defect", () => {
  const ready = { status: "compile-ready", missing: [] };
  assert.equal(
    diagnoseUnprovisionedFailure("Cannot find package 'react'", ready).unprovisioned,
    false,
    "a broken dependency in a provisioned tree must not be waved through as environmental",
  );
});

test("a signature that does not match what is actually missing is NOT relabelled", () => {
  // Only the Prisma client is missing, but the failure is about react: that is a
  // real dependency problem, not this worktree's provisioning gap.
  const partial = { status: "source-only", missing: [{ path: "packages/db/generated" }] };
  assert.equal(diagnoseUnprovisionedFailure("Cannot find package 'react'", partial).unprovisioned, false);
});

test("the 'next' is not recognized signature maps to apps/web/node_modules", () => {
  const readiness = { status: "source-only", missing: [{ path: "apps/web/node_modules" }] };
  const d = diagnoseUnprovisionedFailure("'next' is not recognized as an internal or external command", readiness);
  assert.equal(d.unprovisioned, true);
  assert.deepEqual(d.matched, ["apps/web/node_modules"]);
});

test("the Prisma client signature maps to packages/db/generated", () => {
  const readiness = { status: "source-only", missing: [{ path: "packages/db/generated" }] };
  const d = diagnoseUnprovisionedFailure("Cannot find module '../generated/client/client'", readiness);
  assert.equal(d.unprovisioned, true);
  assert.deepEqual(d.matched, ["packages/db/generated"]);
});

test("ordinary type errors are never relabelled as environmental", () => {
  const sourceOnly = { status: "source-only", missing: [{ path: "node_modules" }] };
  assert.equal(
    diagnoseUnprovisionedFailure("src/x.ts(4,2): error TS2339: Property 'y' does not exist on type 'Z'.", sourceOnly)
      .unprovisioned,
    false,
  );
});

// scripts/lib/ensure-compile-ready.test.mjs
// Node built-in test runner (no node_modules needed): node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDocsOnlyPath,
  classifyIntent,
  decideReadinessEnforcement,
  ensureCompileReady,
} from "./ensure-compile-ready.mjs";

test("isDocsOnlyPath: markdown and docs/ are docs-only", () => {
  assert.equal(isDocsOnlyPath("README.md"), true);
  assert.equal(isDocsOnlyPath("docs/superpowers/specs/x.md"), true);
  assert.equal(isDocsOnlyPath("notes.mdx"), true);
  assert.equal(isDocsOnlyPath(".changeset/foo.md"), true);
});

test("isDocsOnlyPath: source/config is not docs-only", () => {
  assert.equal(isDocsOnlyPath("apps/web/lib/foo.ts"), false);
  assert.equal(isDocsOnlyPath("scripts/gate.mjs"), false);
  assert.equal(isDocsOnlyPath("package.json"), false);
  assert.equal(isDocsOnlyPath("docs/gen/thing.ts"), false);
});

test("classifyIntent: null (unknown) enforces as code — never wave through on doubt", () => {
  assert.equal(classifyIntent(null), "code");
});

test("classifyIntent: empty change set is docs (nothing to compile)", () => {
  assert.equal(classifyIntent([]), "docs");
});

test("classifyIntent: all-docs is docs; any code file makes it code", () => {
  assert.equal(classifyIntent(["README.md", "docs/x.md"]), "docs");
  assert.equal(classifyIntent(["docs/x.md", "apps/web/lib/a.ts"]), "code");
  assert.equal(classifyIntent(["scripts/foo.mjs"]), "code");
});

test("decideReadinessEnforcement: compile-ready is always ok", () => {
  assert.equal(
    decideReadinessEnforcement({ intent: "code", readinessStatus: "compile-ready" }).action,
    "ok",
  );
});

test("decideReadinessEnforcement: opt-out downgrades to warn for source-only code", () => {
  assert.equal(
    decideReadinessEnforcement({ intent: "code", readinessStatus: "source-only", optedOut: true }).action,
    "warn",
  );
});

test("decideReadinessEnforcement: docs intent on source-only is ok (no install)", () => {
  assert.equal(
    decideReadinessEnforcement({ intent: "docs", readinessStatus: "source-only" }).action,
    "ok",
  );
});

test("decideReadinessEnforcement: code intent on source-only must heal", () => {
  assert.equal(
    decideReadinessEnforcement({ intent: "code", readinessStatus: "source-only" }).action,
    "heal",
  );
});

const compileReady = { status: "compile-ready", missing: [] };
const sourceOnly = {
  status: "source-only",
  reason: "no_node_modules",
  missing: [{ label: "node_modules", state: "absent", forbids: "typecheck" }],
};

test("ensureCompileReady: compile-ready worktree passes without ever bootstrapping", () => {
  let bootstrapped = false;
  const r = ensureCompileReady({
    worktreePath: "/wt",
    changedFiles: ["apps/web/lib/a.ts"],
    env: {},
    probe: () => compileReady,
    bootstrap: () => { bootstrapped = true; return compileReady; },
  });
  assert.equal(r.ok, true);
  assert.equal(r.action, "ok");
  assert.equal(bootstrapped, false);
});

test("ensureCompileReady: docs-only change on source-only tree passes WITHOUT installing", () => {
  let bootstrapped = false;
  const r = ensureCompileReady({
    worktreePath: "/wt",
    changedFiles: ["docs/x.md"],
    env: {},
    probe: () => sourceOnly,
    bootstrap: () => { bootstrapped = true; return compileReady; },
  });
  assert.equal(r.ok, true);
  assert.equal(r.action, "ok");
  assert.equal(r.intent, "docs");
  assert.equal(bootstrapped, false);
});

test("ensureCompileReady: code change on source-only tree auto-heals and passes", () => {
  let bootstrapped = false;
  const r = ensureCompileReady({
    worktreePath: "/wt",
    changedFiles: ["scripts/foo.mjs"],
    env: {},
    probe: () => sourceOnly,
    bootstrap: () => { bootstrapped = true; return compileReady; },
  });
  assert.equal(bootstrapped, true);
  assert.equal(r.ok, true);
  assert.equal(r.action, "healed");
});

test("ensureCompileReady: code change blocks with exact missing items when heal fails", () => {
  const r = ensureCompileReady({
    worktreePath: "/wt",
    changedFiles: ["scripts/foo.mjs"],
    env: {},
    probe: () => sourceOnly,
    bootstrap: () => ({ status: "source-only", reason: "managed_install_failed", missing: sourceOnly.missing }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.action, "blocked");
  assert.match(r.banner.join("\n"), /SOURCE-ONLY/);
  assert.match(r.banner.join("\n"), /node_modules/);
});

test("ensureCompileReady: opt-out never blocks (recorded honesty, CI still enforces)", () => {
  const r = ensureCompileReady({
    worktreePath: "/wt",
    changedFiles: ["scripts/foo.mjs"],
    env: { DPF_SKIP_COMPILE_READY_GATE: "why" },
    probe: () => sourceOnly,
    bootstrap: () => { throw new Error("must not be called"); },
  });
  assert.equal(r.ok, true);
  assert.equal(r.action, "warn");
});

test("ensureCompileReady: a throwing probe fails safe (never wedges the thread)", () => {
  const r = ensureCompileReady({
    worktreePath: "/wt",
    changedFiles: ["scripts/foo.mjs"],
    env: {},
    probe: () => { throw new Error("probe boom"); },
    bootstrap: () => compileReady,
  });
  assert.equal(r.ok, true);
  assert.equal(r.action, "probe-failed");
});

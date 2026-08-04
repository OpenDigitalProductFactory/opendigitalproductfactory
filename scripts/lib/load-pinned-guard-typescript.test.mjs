import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { loadPinnedGuardTypeScript, GuardRuntimeEnvironmentError } from "./load-pinned-guard-typescript.mjs";

// The pin is read from the repo's own lock/manifest; these tests only exercise
// the PATH adjudication, so they stub resolution and the package read.
const PIN = "6.0.3";
const LOCK = [
  "importers:",
  "  packages/repo-guard-runtime:",
  "    devDependencies:",
  "      typescript:",
  `        specifier: ${PIN}`,
  `        version: ${PIN}`,
  "  apps/web:",
].join("\n");

// The manifest/lock/module-load steps are injected so these tests exercise only
// the PATH adjudication — the part BI-A76F0481 got wrong.
function harness({ resolvedPath, repoRoot, version = PIN }) {
  return () =>
    loadPinnedGuardTypeScript({
      repoRoot,
      runtimeManifest: { devDependencies: { typescript: PIN } },
      lockText: LOCK,
      resolvePackage: () => resolvedPath,
      readResolvedPackage: () => ({ version }),
      loadModule: () => ({ version }),
    });
}

test("a hoisted TypeScript under the repo root is accepted", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "guard-root-")));
  const pkg = join(root, "node_modules", "typescript", "package.json");
  mkdirSync(dirname(pkg), { recursive: true });
  writeFileSync(pkg, JSON.stringify({ version: "6.0.3" }));

  assert.doesNotThrow(harness({ resolvedPath: pkg, repoRoot: root }));
});

test("a worktree whose node_modules links to the root clone is accepted (BI-A76F0481)", (t) => {
  // Reproduces the real failure: `repoRoot` is the WORKTREE, but node resolves
  // through the linked node_modules and returns a path under the ROOT clone.
  // Before the realpath fix this threw GuardRuntimeEnvironmentError even though
  // the resolved TypeScript is exactly the pinned one.
  const base = realpathSync(mkdtempSync(join(tmpdir(), "guard-link-")));
  const root = join(base, "root");
  const worktree = join(base, "worktree");

  const realPkg = join(root, "node_modules", "typescript", "package.json");
  mkdirSync(dirname(realPkg), { recursive: true });
  writeFileSync(realPkg, JSON.stringify({ version: "6.0.3" }));

  mkdirSync(worktree, { recursive: true });
  try {
    symlinkSync(join(root, "node_modules"), join(worktree, "node_modules"), "junction");
  } catch {
    t.skip("symlink/junction creation not permitted in this environment");
    return;
  }

  // What node actually hands back: the REAL path, under the root clone.
  assert.doesNotThrow(harness({ resolvedPath: realPkg, repoRoot: worktree }));
});

test("the pnpm store path is accepted, and its dots are literal not wildcards", (t) => {
  // Regression: written inside a template literal, `\.` collapses to `.` and
  // the compiled regex treats those dots as ANY character — so "/Xpnpm/" would
  // have been accepted. The escapes must survive into the RegExp.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "guard-pnpm-")));
  const good = join(root, "node_modules", ".pnpm", `typescript@${PIN}`, "node_modules", "typescript", "package.json");
  mkdirSync(dirname(good), { recursive: true });
  writeFileSync(good, JSON.stringify({ version: PIN }));
  assert.doesNotThrow(harness({ resolvedPath: good, repoRoot: root }));

  const wildcard = join(root, "node_modules", "Xpnpm", `typescript@${PIN}`, "node_modules", "typescript", "package.json");
  mkdirSync(dirname(wildcard), { recursive: true });
  writeFileSync(wildcard, JSON.stringify({ version: PIN }));
  assert.throws(harness({ resolvedPath: wildcard, repoRoot: root }), GuardRuntimeEnvironmentError);
});

test("a TypeScript genuinely outside the pinned graph is still rejected", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "guard-out-")));
  const root = join(base, "root");
  const stray = join(base, "elsewhere", "node_modules", "typescript", "package.json");
  mkdirSync(join(root, "node_modules"), { recursive: true });
  mkdirSync(dirname(stray), { recursive: true });
  writeFileSync(stray, JSON.stringify({ version: "6.0.3" }));

  assert.throws(harness({ resolvedPath: stray, repoRoot: root }), GuardRuntimeEnvironmentError);
});

test("a resolved TypeScript at the wrong version is still rejected", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "guard-ver-")));
  const pkg = join(root, "node_modules", "typescript", "package.json");
  mkdirSync(dirname(pkg), { recursive: true });
  writeFileSync(pkg, JSON.stringify({ version: "5.9.0" }));

  assert.throws(
    harness({ resolvedPath: pkg, repoRoot: root, version: "5.9.0" }),
    GuardRuntimeEnvironmentError,
  );
});

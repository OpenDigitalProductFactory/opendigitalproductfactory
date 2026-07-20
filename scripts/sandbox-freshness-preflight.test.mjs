// Integration tests for the sandbox freshness preflight CLI (BI-ECDF9520).
// Builds a fake pnpm-style workspace on disk — store dirs under
// node_modules/.pnpm plus workspace symlinks — and asserts the CLI detects the
// exact incident shape (apps/web/node_modules/next -> next@16.2.7 store path
// while pnpm-lock.yaml requires 16.2.9, and the same shape for vitest) with the
// reserved exit codes.
// node --test scripts/sandbox-freshness-preflight.test.mjs — pure node, no docker.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./sandbox-freshness-preflight.mjs", import.meta.url));

const PACKAGES = [
  { name: "next", importer: "apps/web", version: "16.2.9" },
  { name: "react", importer: "apps/web", version: "19.2.7" },
  { name: "react-dom", importer: "apps/web", version: "19.2.7" },
  { name: "typescript", importer: ".", version: "5.9.3" },
  { name: "prisma", importer: "packages/db", version: "6.19.1" },
  { name: "vitest", importer: "apps/web", version: "4.1.10" },
];

function lockfileText(versions) {
  const importerBlocks = new Map();
  for (const pkg of PACKAGES) {
    const version = versions[pkg.name] ?? pkg.version;
    const block = importerBlocks.get(pkg.importer) ?? [];
    block.push(`      ${pkg.name}:\n        specifier: ^${version}\n        version: ${version}`);
    importerBlocks.set(pkg.importer, block);
  }
  let text = "lockfileVersion: '9.0'\n\nimporters:\n\n";
  for (const [importer, entries] of importerBlocks) {
    text += `  ${importer}:\n    dependencies:\n${entries.join("\n")}\n\n`;
  }
  text += "packages: {}\n";
  return text;
}

/**
 * Scaffold a fake installed workspace. `installedVersions` controls the store
 * dirs + links actually on disk; `lockedVersions` controls pnpm-lock.yaml;
 * `installedLockVersions` controls node_modules/.pnpm/lock.yaml.
 */
function scaffold({ installedVersions = {}, lockedVersions = {}, installedLockVersions } = {}) {
  const root = mkdtempSync(join(tmpdir(), "dpf-freshness-"));
  writeFileSync(join(root, "pnpm-lock.yaml"), lockfileText(lockedVersions));
  mkdirSync(join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(
    join(root, "node_modules", ".pnpm", "lock.yaml"),
    lockfileText(installedLockVersions ?? installedVersions),
  );
  for (const pkg of PACKAGES) {
    const version = installedVersions[pkg.name] ?? pkg.version;
    const storeDir = join(root, "node_modules", ".pnpm", `${pkg.name}@${version}_fakehash`, "node_modules", pkg.name);
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, "package.json"), JSON.stringify({ name: pkg.name, version }));
    if (pkg.name === "vitest") {
      mkdirSync(join(storeDir, "dist", "chunks"), { recursive: true });
      writeFileSync(join(storeDir, "dist", "cli.js"), "import './chunks/cac.ok.js';\n");
      writeFileSync(join(storeDir, "dist", "chunks", "cac.ok.js"), "export default {};\n");
    }
    const importerNodeModules = pkg.importer === "." ? join(root, "node_modules") : join(root, pkg.importer, "node_modules");
    mkdirSync(importerNodeModules, { recursive: true });
    symlinkSync(storeDir, join(importerNodeModules, pkg.name), process.platform === "win32" ? "junction" : "dir");
  }
  return root;
}

function runPreflight(root, extraArgs = []) {
  const reportPath = join(root, "freshness-report.json");
  const result = spawnSync("node", [cli, "--dir", root, "--report", reportPath, "--skip-install-scan", ...extraArgs], { encoding: "utf8" });
  let report = null;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    // missing report is asserted by callers where relevant
  }
  return { result, report };
}

test("green when workspace links match the lockfile", () => {
  const root = scaffold();
  const { result, report } = runPreflight(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.verdict, "green");
  assert.deepEqual(report.failures, []);
  const next = report.packages.find((p) => p.name === "next");
  assert.equal(next.lockedVersion, "16.2.9");
  assert.equal(next.resolvedVersion, "16.2.9");
  rmSync(root, { recursive: true, force: true });
});

test("detects the incident: stale next@16.2.7 store link while lockfile requires 16.2.9", () => {
  const root = scaffold({
    installedVersions: { next: "16.2.7" },
    lockedVersions: { next: "16.2.9" },
    // The install that created the links also recorded the old resolution.
    installedLockVersions: { next: "16.2.7" },
  });
  const { result, report } = runPreflight(root);
  assert.equal(result.status, 3, `expected SANDBOX_DRIFT exit 3, got ${result.status}\n${result.stderr}`);
  assert.equal(report.verdict, "sandbox_drift");
  const kinds = report.failures.map((f) => f.kind);
  assert.ok(kinds.includes("version_drift"), JSON.stringify(report.failures));
  const next = report.packages.find((p) => p.name === "next");
  assert.equal(next.lockedVersion, "16.2.9");
  assert.equal(next.resolvedVersion, "16.2.7");
  assert.match(next.linkTarget || next.name, /next/);
  assert.match(result.stderr, /16\.2\.7/);
  rmSync(root, { recursive: true, force: true });
});

test("detects stale vitest before the test runner fails on missing packaged chunks", () => {
  const root = scaffold({
    installedVersions: { vitest: "4.1.9" },
    lockedVersions: { vitest: "4.1.10" },
    installedLockVersions: { vitest: "4.1.9" },
  });
  const { result, report } = runPreflight(root);
  assert.equal(result.status, 3, `expected SANDBOX_DRIFT exit 3, got ${result.status}\n${result.stderr}`);
  assert.equal(report.verdict, "sandbox_drift");
  assert.ok(report.failures.some((f) => f.kind === "version_drift" && f.package === "vitest"));
  const vitest = report.packages.find((p) => p.name === "vitest");
  assert.equal(vitest.lockedVersion, "4.1.10");
  assert.equal(vitest.resolvedVersion, "4.1.9");
  rmSync(root, { recursive: true, force: true });
});

test("detects a broken vitest entrypoint even when package.json reports the locked version", () => {
  const root = scaffold();
  rmSync(join(root, "node_modules", ".pnpm", "vitest@4.1.10_fakehash", "node_modules", "vitest", "dist", "chunks", "cac.ok.js"), { force: true });
  const { result, report } = runPreflight(root);
  assert.equal(result.status, 3, `expected SANDBOX_DRIFT exit 3, got ${result.status}\n${result.stderr}`);
  assert.ok(report.failures.some((f) => f.kind === "package_broken" && f.package === "vitest"));
  assert.match(result.stderr, /incomplete/);
  rmSync(root, { recursive: true, force: true });
});

test("resolves hoisted layouts (node-linker=hoisted) via Node-style walk-up", () => {
  // No per-importer links at all: packages live flat at the root node_modules,
  // as pnpm's hoisted linker (and npm) lay them out. The runtime resolves
  // these fine, so the detector must too.
  const root = mkdtempSync(join(tmpdir(), "dpf-freshness-"));
  writeFileSync(join(root, "pnpm-lock.yaml"), lockfileText({}));
  mkdirSync(join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".pnpm", "lock.yaml"), lockfileText({}));
  mkdirSync(join(root, "apps", "web"), { recursive: true });
  mkdirSync(join(root, "packages", "db"), { recursive: true });
  for (const pkg of PACKAGES) {
    const dir = join(root, "node_modules", pkg.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version }));
    if (pkg.name === "vitest") {
      mkdirSync(join(dir, "dist", "chunks"), { recursive: true });
      writeFileSync(join(dir, "dist", "cli.js"), "import './chunks/cac.ok.js';\n");
      writeFileSync(join(dir, "dist", "chunks", "cac.ok.js"), "export default {};\n");
    }
  }
  const { result, report } = runPreflight(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.verdict, "green");
  const next = report.packages.find((p) => p.name === "next");
  assert.equal(next.resolvedVersion, "16.2.9");
  assert.match(next.resolvedFrom, /node_modules[\\/]next$/);
  rmSync(root, { recursive: true, force: true });
});

test("detects a dangling workspace link as drift", () => {
  const root = scaffold();
  // Break the link target: simulate a pruned store dir behind a live symlink.
  rmSync(join(root, "node_modules", ".pnpm", "next@16.2.9_fakehash"), { recursive: true, force: true });
  const { result, report } = runPreflight(root);
  assert.equal(result.status, 3);
  assert.ok(report.failures.some((f) => f.kind === "package_missing"));
  rmSync(root, { recursive: true, force: true });
});

test("classifies a missing install as sandbox_not_ready (exit 4)", () => {
  const root = mkdtempSync(join(tmpdir(), "dpf-freshness-"));
  writeFileSync(join(root, "pnpm-lock.yaml"), lockfileText({}));
  const { result, report } = runPreflight(root);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(report.verdict, "sandbox_not_ready");
  rmSync(root, { recursive: true, force: true });
});

test("refuses to run without a pnpm-lock.yaml (usage error, exit 2)", () => {
  const root = mkdtempSync(join(tmpdir(), "dpf-freshness-"));
  const result = spawnSync("node", [cli, "--dir", root], { encoding: "utf8" });
  assert.equal(result.status, 2);
  rmSync(root, { recursive: true, force: true });
});

test("--converge refuses a duplicate convergence while the lock is held", () => {
  const root = scaffold({
    installedVersions: { next: "16.2.7" },
    lockedVersions: { next: "16.2.9" },
  });
  mkdirSync(join(root, ".dpf-freshness-converge.lock"), { recursive: true });
  const { result, report } = runPreflight(root, ["--converge"]);
  assert.equal(result.status, 4, `${result.stdout}\n${result.stderr}`);
  assert.equal(report.convergence.attempted, false);
  assert.equal(report.convergence.reason, "convergence_lock_held");
  rmSync(root, { recursive: true, force: true });
});

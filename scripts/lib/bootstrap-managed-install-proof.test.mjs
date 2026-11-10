import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubGitRepoLocationEnv } from "./git-hook-env.mjs";
import { beginManagedInstallProof, completeManagedInstallProof, hasManagedInstallProof, managedInstallProofPath } from "./bootstrap-managed-install-proof.mjs";

const version = "10.33.2";
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "dpf-install-proof-"));
  try {
    execFileSync("git", ["init", "--quiet", root], { env: scrubGitRepoLocationEnv() });
    writeFileSync(join(root, "package.json"), JSON.stringify({ packageManager: `pnpm@${version}` }));
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules/.modules.yaml"), "nodeLinker: hoisted\n");
    run(root);
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), "dpf-install-proof-")));
    rmSync(root, { recursive: true, force: true });
  }
}
function qualify(root) {
  const attempt = beginManagedInstallProof(root, version);
  assert.equal(completeManagedInstallProof(attempt, root, version), true);
  assert.equal(hasManagedInstallProof(root, version), true);
}

test("only matching completed managed install evidence is reusable", () => fixture(root => {
  assert.equal(hasManagedInstallProof(root, version), false);
  qualify(root);
  beginManagedInstallProof(root, version);
  assert.equal(hasManagedInstallProof(root, version), false, "an unfinished or failed attempt invalidates prior success");
}));

for (const path of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".pnpmfile.cjs", "node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml"]) {
  test(`changed install input ${path} invalidates proof`, () => fixture(root => {
    qualify(root);
    if (path.includes("/.pnpm/")) mkdirSync(join(root, "node_modules/.pnpm"));
    writeFileSync(join(root, path), "changed\n");
    assert.equal(hasManagedInstallProof(root, version), false);
  }));
}

test("changing policy while installing cannot publish proof", () => fixture(root => {
  const attempt = beginManagedInstallProof(root, version);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\nallowBuilds:\n  new-package: false\n");
  assert.equal(completeManagedInstallProof(attempt, root, version), false);
  assert.equal(hasManagedInstallProof(root, version), false);
}));

for (const change of ["edit", "add", "remove"]) {
  test(`workspace manifest ${change} invalidates retained install proof`, () => fixture(root => {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n  - 'packages/**'\n");
    mkdirSync(join(root, "apps/web"), { recursive: true });
    const manifest = join(root, "apps/web/package.json");
    writeFileSync(manifest, JSON.stringify({ name: "web", dependencies: {} }));
    qualify(root);
    if (change === "remove") rmSync(manifest);
    else if (change === "edit") writeFileSync(manifest, JSON.stringify({ name: "web", dependencies: { missing: "1.0.0" } }));
    else {
      mkdirSync(join(root, "packages/new/nested"), { recursive: true });
      writeFileSync(join(root, "packages/new/nested/package.json"), '{"name":"new"}');
    }
    assert.equal(hasManagedInstallProof(root, version), false);
  }));
}

test("workspace manifest changes during install cannot publish proof", () => fixture(root => {
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  const attempt = beginManagedInstallProof(root, version);
  mkdirSync(join(root, "apps/new"), { recursive: true });
  writeFileSync(join(root, "apps/new/package.json"), '{"name":"new"}');
  assert.equal(completeManagedInstallProof(attempt, root, version), false);
}));

test("a newly introduced pnpm hook invalidates retained proof", () => fixture(root => {
  qualify(root);
  writeFileSync(join(root, ".pnpmfile.js"), "module.exports = {};\n");
  assert.equal(hasManagedInstallProof(root, version), false);
}));

for (const config of ["pnpmfile=./custom-hook.cjs\n", "global-pnpmfile=../shared-hook.cjs\n"]) {
  test(`custom hook configuration cannot qualify retained proof: ${config.trim()}`, () => fixture(root => {
    writeFileSync(join(root, ".npmrc"), config);
    const attempt = beginManagedInstallProof(root, version);
    assert.equal(completeManagedInstallProof(attempt, root, version), false);
  }));
}

test("unsupported workspace configuration cannot qualify retained proof", () => fixture(root => {
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: ['apps/*']\n");
  const attempt = beginManagedInstallProof(root, version);
  assert.equal(completeManagedInstallProof(attempt, root, version), false);
}));

test("missing installed metadata, corrupt evidence and cached banners cannot qualify readiness", () => fixture(root => {
  writeFileSync(join(root, ".dpf-worktree-readiness.json"), JSON.stringify({ state: "compile-ready" }));
  assert.equal(hasManagedInstallProof(root, version), false);
  qualify(root);
  writeFileSync(managedInstallProofPath(root), "not-json");
  assert.equal(hasManagedInstallProof(root, version), false);
  qualify(root);
  rmSync(join(root, "node_modules/.modules.yaml"));
  assert.equal(hasManagedInstallProof(root, version), false);
}));

test("proof is local to its worktree and exact package-manager version", () => fixture(root => {
  qualify(root);
  assert.equal(hasManagedInstallProof(root, "11.0.0"), false);
  fixture(other => {
    writeFileSync(managedInstallProofPath(other), readFileSync(managedInstallProofPath(root)));
    assert.equal(hasManagedInstallProof(other, version), false);
  });
}));

test("effective install configuration changes invalidate proof without storing its values", () => fixture(root => {
  const previous = process.env.npm_config_ignore_scripts;
  try {
    delete process.env.npm_config_ignore_scripts;
    qualify(root);
    process.env.npm_config_ignore_scripts = "true";
    assert.equal(hasManagedInstallProof(root, version), false);
    assert.equal(readFileSync(managedInstallProofPath(root), "utf8").includes("npm_config_ignore_scripts"), false);
  } finally {
    if (previous === undefined) delete process.env.npm_config_ignore_scripts;
    else process.env.npm_config_ignore_scripts = previous;
  }
}));

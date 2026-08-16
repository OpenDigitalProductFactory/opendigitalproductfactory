// The consumer ("Ready to go") install has NO git checkout. Everything the
// installer touches under the install directory must therefore be present in the
// image's /dpf-release-assets bundle, because that bundle IS the install directory.
//
// This broke twice in one week, the same way both times:
//
//   1. The bundle existed in source but the published image predated it, so
//      `docker cp <c>:/dpf-release-assets/.` failed -> consumer_release_asset_export_failed.
//   2. Once that was fixed, the very next step failed:
//        Copy-Item : Cannot find path 'D:\DPF\scripts\safety\dpf-shell-guard.ps1'
//      The installer unconditionally copies the kernel-commandment shell guard out
//      of the install dir, and the bundle never shipped scripts/safety/ at all.
//
// Defect 2 hid behind defect 1, and CI could not see either: the publish workflow's
// E2E install verification runs `install-dpf.sh --release` from an actions/checkout,
// so $REPO_ROOT is a FULL SOURCE TREE. It exercises release *mode* but never the
// no-checkout consumer *scenario* that the Windows README actually instructs
// (download install-dpf.ps1 alone, no clone).
//
// So this asserts the contract statically instead: every path the installers copy
// unconditionally out of the install directory must be in the Dockerfile's bundle.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
const psInstaller = readFileSync(join(repoRoot, "install-dpf.ps1"), "utf8");
const shInstaller = readFileSync(join(repoRoot, "install-dpf.sh"), "utf8");

/**
 * Repo-relative paths the installers copy out of the install directory with no
 * mode guard, so the consumer path always needs them. Keep in sync deliberately:
 * test "every required path is actually referenced" fails on a stale entry.
 */
const REQUIRED_IN_BUNDLE = Object.freeze([
  "scripts/safety/dpf-shell-guard.ps1",
  "scripts/safety/dpf-shell-guard.sh",
  "scripts/safety/dpf-shell-guard-fallback-patterns.json",
  "scripts/installer/lib/state.ps1",
  "scripts/bootstrap-organization-pki.ps1",
]);

/** The single RUN block that assembles /dpf-release-assets. */
function releaseAssetBlock(source) {
  const start = source.indexOf("/dpf-release-assets");
  assert.notEqual(start, -1, "Dockerfile must still build /dpf-release-assets");
  const lineStart = source.lastIndexOf("RUN ", start);
  // The block ends at the SHA256SUMS generation that closes it.
  const end = source.indexOf("SHA256SUMS", source.indexOf("find .", lineStart));
  assert.ok(end > lineStart, "release-asset block must end by generating SHA256SUMS");
  return source.slice(lineStart, end);
}

const block = releaseAssetBlock(dockerfile);

test("every file the installers unconditionally copy is shipped in the bundle", () => {
  const missing = REQUIRED_IN_BUNDLE.filter((p) => !block.includes(p));
  assert.deepEqual(
    missing,
    [],
    "the consumer install has no git checkout, so these must ship in /dpf-release-assets. " +
      "Missing: " + missing.join(", "),
  );
});

test("every required path is actually referenced by an installer (no stale entries)", () => {
  for (const p of REQUIRED_IN_BUNDLE) {
    const win = p.replace(/\//g, "\\\\");
    const referenced =
      psInstaller.includes(p) || psInstaller.includes(p.replace(/\//g, "\\")) ||
      psInstaller.includes(win) || shInstaller.includes(p);
    assert.ok(referenced, `${p} is shipped/required but no installer references it — stale entry?`);
  }
});

test("every required path exists in the repo", () => {
  for (const p of REQUIRED_IN_BUNDLE) {
    assert.ok(existsSync(join(repoRoot, p)), `${p} is required by the installer but absent from the repo`);
  }
});

test("the shell guard the installer copies is in the bundle — the exact defect", () => {
  // install-dpf.ps1: Copy-Item -Path (Join-Path $DPF_DIR "scripts\safety\dpf-shell-guard.ps1")
  assert.match(
    psInstaller,
    /Join-Path \$DPF_DIR "scripts\\safety\\dpf-shell-guard\.ps1"/,
    "installer should still copy the guard; if this moved, update the contract list",
  );
  assert.ok(
    block.includes("scripts/safety/dpf-shell-guard.ps1"),
    "Dockerfile must ship scripts/safety/dpf-shell-guard.ps1 or the consumer install dies at safety-bin setup",
  );
});

test("SHA256SUMS is generated last, so newly added assets are covered", () => {
  const shaIdx = dockerfile.indexOf("sha256sum > SHA256SUMS");
  const safetyIdx = dockerfile.indexOf("/dpf-release-assets/scripts/safety");
  assert.ok(shaIdx > 0, "the bundle must still be checksummed");
  assert.ok(
    safetyIdx > 0 && safetyIdx < shaIdx,
    "assets must be copied BEFORE the manifest is generated, or the installer's " +
      "Test-DPFReleaseAssetManifest -RejectUnlisted will reject them",
  );
});

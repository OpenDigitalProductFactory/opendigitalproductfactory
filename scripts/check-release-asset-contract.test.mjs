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
const promoteScript = readFileSync(join(repoRoot, "scripts/promote.sh"), "utf8");
const agentPointerPath = "config/consumer-install/agent-pointer.md";

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
  "scripts/installer/lib/compose-chain.ps1",
  "scripts/installer/install-release-assets.mjs",
  "scripts/installer/local-model-policy.json",
  "scripts/bootstrap-organization-pki.ps1",
  // The install guides tell operators to run these by name, so a consumer install
  // that lacks them fails the documented uninstall with "file not found" — the
  // only offered route to zero footprint (IMP-073).
  "uninstall-dpf.sh",
  "uninstall-dpf.ps1",
  "uninstall-dpf.bat",
]);

/**
 * Commands the published install guides instruct an operator to run by name.
 * A documented command whose file never ships is worse than an undocumented gap:
 * the operator follows the guide and gets "file not found".
 */
const DOCUMENTED_COMMANDS = Object.freeze([
  { doc: "docs/install/linux.md", file: "uninstall-dpf.sh" },
  { doc: "docs/install/cloud-single-vm.md", file: "uninstall-dpf.sh" },
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

test("every bundled asset is also COPYed into the build stage that assembles it", () => {
  // Asserting only on the `cp` is half the chain and lets a broken image build
  // through: the init stage COPYs each asset explicitly, so a file that is cp'd
  // but never COPYed fails the build with a bare `exit code: 1`. That exact gap
  // shipped once -- the cp was added without the COPY.
  const initStageStart = dockerfile.indexOf("FROM deps AS init");
  const releaseAssetStart = dockerfile.indexOf("RUN ", dockerfile.indexOf("/dpf-release-assets"));
  assert.ok(initStageStart >= 0, "Dockerfile must still declare the init stage");
  assert.ok(releaseAssetStart > initStageStart, "release assets must still be assembled in the init stage");
  const copiedIntoStage = dockerfile
    .slice(initStageStart, releaseAssetStart)
    .split(/\r?\n/)
    .filter((l) => /^COPY\s/.test(l) || /^\s{5,}scripts\//.test(l))
    .join("\n");
  const notStaged = REQUIRED_IN_BUNDLE.filter((p) => !copiedIntoStage.includes(p));
  assert.deepEqual(
    notStaged,
    [],
    "these are cp'd into /dpf-release-assets but never COPYed into the stage, so the " +
      "build will fail: " + notStaged.join(", "),
  );
});

test("every documented command's file actually ships in the bundle", () => {
  // IMP-073: docs/install/linux.md and cloud-single-vm.md both list
  // `bash uninstall-dpf.sh` in their command tables, while the file shipped only
  // in source. Following the guide on a Ready-to-go install produced "file not found".
  const block = releaseAssetBlock(dockerfile);
  for (const { doc, file } of DOCUMENTED_COMMANDS) {
    const docPath = join(repoRoot, doc);
    if (!existsSync(docPath)) continue;
    const body = readFileSync(docPath, "utf8");
    if (!body.includes(file)) continue;
    assert.ok(
      block.includes(file),
      `${doc} tells the operator to run ${file}, but it is not in /dpf-release-assets — ` +
        `the consumer install has no git checkout, so the documented command cannot work`,
    );
  }
});

test("every required path is actually referenced by an installer (no stale entries)", () => {
  for (const p of REQUIRED_IN_BUNDLE) {
    // The uninstallers are referenced by the install GUIDES rather than by
    // install-dpf.*, so the installer-reference check does not apply to them.
    if (p.startsWith("uninstall-dpf.")) continue;
    const win = p.replace(/\//g, "\\\\");
    const referenced =
      psInstaller.includes(p) || psInstaller.includes(p.replace(/\//g, "\\")) ||
      psInstaller.includes(win) || shInstaller.includes(p) || promoteScript.includes(p) ||
      promoteScript.includes(p.replace(/^scripts\//, ""));
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

test("consumer installs ship a minimal AGENTS.md pointer before checksums", () => {
  assert.ok(existsSync(join(repoRoot, agentPointerPath)), "consumer agent pointer source must exist");
  assert.ok(
    block.includes(`${agentPointerPath} /dpf-release-assets/AGENTS.md`),
    "the neutral source asset must be renamed to AGENTS.md only in the release bundle",
  );
  const pointer = readFileSync(join(repoRoot, agentPointerPath), "utf8");
  assert.match(pointer, /runtime install/i);
  assert.match(pointer, /not a source (checkout|repository)/i);
  assert.match(pointer, /MCP/i);
  assert.match(pointer, /authoritative/i);
  // The install must POINT at the contributor rulebook, never restate it.
  assert.match(pointer, /AGENTS\.md/, "the pointer must name the rulebook it points at");

  // What "does not duplicate the rulebook" actually means, asserted directly
  // rather than proxied by a word count alone (BI-649C1F7E). The count stayed at
  // <120 while the file sat at 118, so the next legitimate pointer sentence — a
  // reference TO the rulebook, the opposite of duplication — could not be added
  // without deleting shipped guidance. A proxy that blocks its own intent is the
  // failure `Principle-Based Rules Over Enumeration` names.
  assert.doesNotMatch(pointer, /§/, "no rulebook section citations — point at the rulebook, do not quote it");
  assert.doesNotMatch(
    pointer,
    /(^|\s)([A-Za-z]:[\\/]|\/(?:home|Users|opt|srv|mnt|var)\/)/,
    "no absolute path literals — checkout locations differ per host",
  );
  assert.doesNotMatch(
    pointer,
    /^\s*(?:[-*+]|\d+\.)\s+/m,
    "no rule list — an enumerated list here is the rulebook leaking into the install",
  );
  // Backstop only. Generous enough for the next honest pointer, and orders of
  // magnitude below the rulebook it must not become.
  assert.ok(
    pointer.split(/\s+/).length < 200,
    "the pointer must stay a pointer, not grow into the contributor rulebook",
  );
});

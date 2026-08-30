import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installReleaseAssets } from "./install-release-assets.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dpf-release-assets-"));
  const source = join(root, "source");
  const install = join(root, "install");
  const statePath = join(root, "state", "install-state.json");
  const hostInstallPath = process.platform === "win32" ? "D:\\DPF" : "/opt/dpf";
  await mkdir(join(source, "scripts"), { recursive: true });
  await mkdir(join(install, "scripts"), { recursive: true });
  await mkdir(join(root, "state"), { recursive: true });
  await writeFile(join(source, "docker-compose.yml"), "new-compose\n");
  await writeFile(join(source, "scripts", "new.mjs"), "new-script\n");
  await writeFile(join(source, "SHA256SUMS"), [
    `${digest("new-compose\n")}  ./docker-compose.yml`,
    `${digest("new-script\n")}  ./scripts/new.mjs`,
  ].join("\n") + "\n");
  await writeFile(join(install, "old-managed.txt"), "old\n");
  await writeFile(join(install, "operator-owned.txt"), "keep\n");
  await writeFile(join(install, ".verified-release-assets.sha256"), `${digest("old\n")}  ./old-managed.txt\n`);
  await writeFile(join(install, ".verified-release-assets-version"), "v1.0.0");
  await writeFile(join(install, ".env"), "CUSTOM_SETTING=kept\nDPF_IMAGE_TAG=v1.0.0\nGHCR_OWNER=old-owner\n");
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 2,
    installerVersion: "v1.0.0",
    lastSuccessfulInstallVersion: "v1.0.0",
    platform: "linux",
    arch: "amd64",
    enabledRuntimeCapabilities: ["runtime:core"],
    capabilityCatalogHash: "a".repeat(64),
    capabilityStateVersion: "b".repeat(64),
    installPath: hostInstallPath,
    installMode: "consumer",
    composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
    imageTag: "v1.0.0",
  }) + "\n");
  return { root, source, install, statePath, hostInstallPath };
}

test("verified release assets replace only managed files and converge durable identity", async () => {
  const f = await fixture();
  await installReleaseAssets({
    sourceDir: f.source,
    installDir: f.install,
    statePath: f.statePath,
    releaseTag: "v2.0.0",
    ghcrOwner: "opendigitalproductfactory",
    recoveryDir: join(f.root, "recovery"),
  });

  await assert.rejects(readFile(join(f.install, "old-managed.txt")), /ENOENT/);
  assert.equal(await readFile(join(f.install, "operator-owned.txt"), "utf8"), "keep\n");
  assert.equal(await readFile(join(f.install, "docker-compose.yml"), "utf8"), "new-compose\n");
  const env = await readFile(join(f.install, ".env"), "utf8");
  assert.match(env, /^CUSTOM_SETTING=kept$/m);
  assert.match(env, /^DPF_IMAGE_TAG=v2\.0\.0$/m);
  assert.match(env, /^GHCR_OWNER=opendigitalproductfactory$/m);
  assert.equal(await readFile(join(f.install, ".verified-release-assets-version"), "utf8"), "v2.0.0");
  await assert.rejects(readFile(join(f.source, ".env")), /ENOENT/);
  await assert.rejects(readFile(join(f.source, ".verified-release-assets-version")), /ENOENT/);
  assert.equal(await readFile(join(f.source, "docker-compose.yml"), "utf8"), "new-compose\n");
  const state = JSON.parse(await readFile(f.statePath, "utf8"));
  assert.equal(state.imageTag, "v2.0.0");
  assert.equal(state.installerVersion, "v2.0.0");
  assert.equal(state.lastSuccessfulInstallVersion, "v2.0.0");
  assert.equal(state.installPath, f.hostInstallPath);
  assert.equal(state.installMode, "consumer");
});

test("rejects tampering and rolls back files, env, markers, and state on injected failure", async () => {
  const tampered = await fixture();
  await writeFile(join(tampered.source, "docker-compose.yml"), "tampered\n");
  await assert.rejects(installReleaseAssets({
    sourceDir: tampered.source,
    installDir: tampered.install,
    statePath: tampered.statePath,
    releaseTag: "v2.0.0",
    ghcrOwner: "owner",
    recoveryDir: join(tampered.root, "recovery"),
  }), /release_asset_integrity_failed/);

  const rollback = await fixture();
  const priorState = await readFile(rollback.statePath, "utf8");
  await assert.rejects(installReleaseAssets({
    sourceDir: rollback.source,
    installDir: rollback.install,
    statePath: rollback.statePath,
    releaseTag: "v2.0.0",
    ghcrOwner: "owner",
    recoveryDir: join(rollback.root, "recovery"),
    failAfter: "files",
  }), /injected_failure:files/);
  assert.equal(await readFile(join(rollback.install, "old-managed.txt"), "utf8"), "old\n");
  await assert.rejects(readFile(join(rollback.install, "scripts", "new.mjs")), /ENOENT/);
  assert.match(await readFile(join(rollback.install, ".env"), "utf8"), /^DPF_IMAGE_TAG=v1\.0\.0$/m);
  assert.equal(await readFile(rollback.statePath, "utf8"), priorState);
});

test("release promotion commits identity to the canonical install root, not the source carrier", async () => {
  const source = await readFile(new URL("../promote.sh", import.meta.url), "utf8");
  assert.match(source, /--install\s+"\$PROMOTE_INSTALL_ROOT"/);
  assert.doesNotMatch(source, /--install\s+"\$PROMOTE_SOURCE"/);
});

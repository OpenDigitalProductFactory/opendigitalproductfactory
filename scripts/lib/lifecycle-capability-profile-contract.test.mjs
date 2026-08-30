import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { signTransitionPayload } from "./transition-signing.mjs";
import test from "node:test";

const root = resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const bashPath = (path) => resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll("\\", "/");
const runBash = (body, env = {}) => spawnSync("bash", [], { cwd: root, encoding: "utf8", input: body, env: { ...process.env, ...env } });

async function signedInstallStateHandoff(statePath, dir) {
  const secret = "lifecycle-contract-secret-value-32";
  const secretPath = join(dir, "transition.secret");
  await writeFile(secretPath, secret);
  const sourceHash = createHash("sha256").update(await readFile(statePath)).digest("hex");
  const envelope = {
    kind: "install-state-migration", version: 1, runId: "SUR-lifecycle-contract", promoterDigest: "sha256:lifecycle-contract",
    sourceHash, projectionHash: "a".repeat(64), fromSchemaVersion: 1, toSchemaVersion: 1,
    hostIdentity: { platform: "win32", arch: "amd64", provenance: "explicit", capabilityHostPlatform: "windows" },
    issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const handoff = {
    DPF_INSTALL_STATE_MIGRATION_ENVELOPE: Buffer.from(JSON.stringify(envelope)).toString("base64url"),
    DPF_INSTALL_STATE_MIGRATION_SIGNATURE: signTransitionPayload(envelope, secret),
    DPF_RUNTIME_TRANSITION_SECRET_FILE: bashPath(secretPath),
    DPF_SELF_UPGRADE_RUN_ID: envelope.runId,
    DPF_PROMOTER_DIGEST: envelope.promoterDigest,
  };
  const verified = spawnSync(process.execPath, [join(root, "scripts", "promoter-migration-envelope.mjs")], {
    encoding: "utf8",
    env: { ...process.env, ...handoff, DPF_RUNTIME_TRANSITION_SECRET_FILE: secretPath, DPF_PROMOTER_STATE_DIR: resolve(statePath, "..") },
  });
  assert.equal(verified.status, 0, verified.stderr);
  return handoff;
}
const bashExports = (values) => Object.entries(values).map(([key, value]) => `export ${key}='${value}'`).join("; ");
const signingWslenv = [
  "DPF_INSTALL_STATE_MIGRATION_ENVELOPE",
  "DPF_INSTALL_STATE_MIGRATION_SIGNATURE",
  "DPF_RUNTIME_TRANSITION_SECRET_FILE/p",
  "DPF_SELF_UPGRADE_RUN_ID",
  "DPF_PROMOTER_DIGEST",
  "DPF_PROMOTER_STATE_DIR/p",
].join(":");
const windowsNodeShim = `#!/usr/bin/env bash
converted=()
for arg in "$@"; do
  case "$arg" in /mnt/*) arg="$(wslpath -w "$arg")" ;; esac
  converted+=("$arg")
done
exec '${bashPath(process.execPath)}' "\${converted[@]}"
`;

test("the real install-state handoff verifier rejects every mutated binding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-signed-handoff-"));
  try {
    const stateDir = join(dir, "state");
    const statePath = join(stateDir, "install-state.json");
    await mkdir(stateDir);
    await writeFile(statePath, "signed-state\n");
    const handoff = await signedInstallStateHandoff(statePath, dir);
    const verifier = join(root, "scripts", "promoter-migration-envelope.mjs");
    const validEnv = { ...process.env, ...handoff, DPF_RUNTIME_TRANSITION_SECRET_FILE: join(dir, "transition.secret"), DPF_PROMOTER_STATE_DIR: stateDir };
    const run = (overrides = {}) => spawnSync(process.execPath, [verifier], { encoding: "utf8", env: { ...validEnv, ...overrides } });
    assert.equal(run().status, 0);
    assert.notEqual(run({ DPF_SELF_UPGRADE_RUN_ID: "SUR-wrong-run" }).status, 0);
    assert.notEqual(run({ DPF_PROMOTER_DIGEST: "sha256:wrong-digest" }).status, 0);
    await writeFile(statePath, "mutated-state\n");
    assert.notEqual(run().status, 0);
    await writeFile(statePath, "signed-state\n");
    const wrongSecret = join(dir, "wrong.secret");
    await writeFile(wrongSecret, "wrong-lifecycle-contract-secret-32");
    assert.notEqual(run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: wrongSecret }).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("consumer release assets are integrity-bound and execute the canonical adapter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-consumer-assets-"));
  try {
    const carrier = join(dir, "carrier");
    const install = join(dir, "install");
    const files = [
      "docker-compose.yml",
      "docker-compose.release.yml",
      "scripts/lib/resolve-capability-compose-profiles.mjs",
      "scripts/lib/govern-capability-compose-args.mjs",
      "scripts/lib/capability-state-hash.mjs",
      "scripts/capability-service-catalog.generated.json",
      "scripts/installer/install-state.schema.json",
      "scripts/installer/install-state.v1.schema.json",
      "scripts/installer/install-state.v2.schema.json",
      "scripts/installer/install-state-schema-registry.mjs",
      "scripts/installer/validate-install-state.mjs",
      "scripts/installer/install-state-transaction.mjs",
      "scripts/installer/install-state-lock-contract.json",
      "scripts/installer/native-edge-host.ps1",
      "scripts/installer/lib/state.ps1",
      "scripts/installer/lib/compose-chain.ps1",
    ];
    const manifest = [];
    for (const relative of files) {
      const target = join(carrier, relative);
      await mkdir(resolve(target, ".."), { recursive: true });
      await copyFile(join(root, relative), target);
      const bytes = await readFile(target);
      manifest.push(`${createHash("sha256").update(bytes).digest("hex")}  ${relative.replaceAll("\\", "/")}`);
    }
    await writeFile(join(carrier, "SHA256SUMS"), `${manifest.join("\n")}\n`);
    await mkdir(install, { recursive: true });
    await writeFile(join(install, ".env"), "# operator setting\nKEEP_ME=yes\nDPF_IMAGE_TAG=old\n");
    const trace = join(dir, "docker.txt");
    const stateDir = join(dir, "state");
    const exportCommand = [
      `. '${join(root, "install-dpf.ps1")}' -LibraryOnly`,
      `Export-DPFConsumerReleaseAssets -InstallDir '${install}' -Version 'v-test-42' -AssetSource '${carrier}'`,
    ].join("; ");
    const exported = spawnSync("pwsh", ["-NoProfile", "-Command", exportCommand], { encoding: "utf8" });
    assert.equal(exported.status, 0, exported.stderr);
    const command = [
      `. '${join(root, "install-dpf.ps1")}' -LibraryOnly`,
      `Set-DPFConsumerReleaseIdentity -InstallDir '${install}' -Version 'v-test-42'`,
      `[IO.File]::WriteAllText('${join(install, "dpf-start.ps1")}', (Get-DPFStartScriptContent), [Text.Encoding]::ASCII)`,
      `$env:DPF_STATE_DIR='${stateDir}'`,
      `. '${join(install, "scripts", "installer", "lib", "state.ps1")}'`,
      `Initialize-DpfState -InstallPath '${install}'`,
      `function docker { Add-Content -LiteralPath '${trace}' -Value ($args -join ' ') }`,
      `function Invoke-WebRequest { [pscustomobject]@{StatusCode=200} }`,
      `& '${join(install, "dpf-start.ps1")}' -DPF_DIR '${install}' -NoBrowser`,
    ].join("; ");
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const compose = await readFile(join(install, "docker-compose.yml"), "utf8");
    assert.doesNotMatch(compose, /^  (neo4j|qdrant):/m);
    assert.equal(await readFile(join(install, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), "utf8"), await readFile(join(root, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), "utf8"));
    assert.equal(await readFile(join(install, "scripts", "lib", "govern-capability-compose-args.mjs"), "utf8"), await readFile(join(root, "scripts", "lib", "govern-capability-compose-args.mjs"), "utf8"));
    assert.match(await readFile(trace, "utf8"), /compose -f docker-compose\.yml -f docker-compose\.release\.yml up -d/);
    const installedEnv = await readFile(join(install, ".env"), "utf8");
    assert.match(installedEnv, /^DPF_IMAGE_TAG=v-test-42$/m);
    assert.match(installedEnv, /^GHCR_OWNER=opendigitalproductfactory$/m);
    assert.match(installedEnv, /^KEEP_ME=yes$/m);
    assert.match(installedEnv, /^# operator setting$/m);
    const releaseCompose = await readFile(join(install, "docker-compose.release.yml"), "utf8");
    const releaseImages = [...releaseCompose.matchAll(/^\s+image:\s+(\S+)$/gm)].map((match) => match[1]);
    const renderedImages = releaseImages.map((image) => image
      .replace("${GHCR_OWNER:-opendigitalproductfactory}", "opendigitalproductfactory")
      .replace("${DPF_IMAGE_TAG:-latest}", "v-test-42"));
    assert.ok(renderedImages.length > 0);
    assert.ok(renderedImages.every((image) => image.endsWith(":v-test-42")), renderedImages.join("\n"));
    const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
    assert.match(dockerfile, /COPY --from=init \/dpf-release-assets \/dpf-release-assets/);
    assert.match(dockerfile, /sha256sum > SHA256SUMS/);
    const installer = await readFile(join(root, "install-dpf.ps1"), "ascii");
    assert.doesNotMatch(installer, /consumerAssetsVerifiedThisRun/);
    assert.match(installer, /if \(\$InstallMode -eq "consumer"\) \{\s+Set-DPFConsumerReleaseIdentity/s);

    const beforeInjectedFailure = Buffer.from("# exact bytes\r\nKEEP_ME=yes\r\nDPF_IMAGE_TAG=previous-good\r\nGHCR_OWNER=mirror\r\n", "utf8");
    await writeFile(join(install, ".env"), beforeInjectedFailure);
    const injected = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; Set-DPFConsumerReleaseIdentity -InstallDir '${install}' -Version 'v-test-42' -BeforeReplace { throw 'injected_pre_replace_failure' }`], { encoding: "utf8" });
    assert.notEqual(injected.status, 0);
    assert.match(injected.stderr, /injected_pre_replace_failure/);
    assert.deepEqual(await readFile(join(install, ".env")), beforeInjectedFailure);

    const missingEnv = join(dir, "missing-env-resume");
    const missingPrepared = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; Export-DPFConsumerReleaseAssets -InstallDir '${missingEnv}' -Version 'v-resume' -AssetSource '${carrier}'`], { encoding: "utf8" });
    assert.equal(missingPrepared.status, 0, missingPrepared.stderr);
    const missingResumed = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; Set-DPFConsumerReleaseIdentity -InstallDir '${missingEnv}' -Version 'v-resume'`], { encoding: "utf8" });
    assert.equal(missingResumed.status, 0, missingResumed.stderr);
    assert.match(await readFile(join(missingEnv, ".env"), "utf8"), /^DPF_IMAGE_TAG=v-resume$/m);

    const mismatch = join(dir, "mismatch-resume");
    await mkdir(mismatch);
    await writeFile(join(mismatch, ".env"), "DPF_IMAGE_TAG=previous-good\n");
    const mismatchPrepared = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; Export-DPFConsumerReleaseAssets -InstallDir '${mismatch}' -Version 'v-next' -AssetSource '${carrier}'`], { encoding: "utf8" });
    assert.equal(mismatchPrepared.status, 0, mismatchPrepared.stderr);
    await writeFile(join(mismatch, ".verified-release-assets-version"), "wrong-version");
    const mismatchResume = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; Set-DPFConsumerReleaseIdentity -InstallDir '${mismatch}' -Version 'v-next'`], { encoding: "utf8" });
    assert.notEqual(mismatchResume.status, 0);
    assert.match(mismatchResume.stderr, /consumer_release_assets_version_mismatch/);
    assert.equal(await readFile(join(mismatch, ".env"), "utf8"), "DPF_IMAGE_TAG=previous-good\n");

    const corrupt = join(dir, "corrupt-resume");
    await mkdir(corrupt);
    await writeFile(join(corrupt, ".env"), "DPF_IMAGE_TAG=previous-good\n");
    const prepared = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; Export-DPFConsumerReleaseAssets -InstallDir '${corrupt}' -Version 'v-next' -AssetSource '${carrier}'`], { encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    await writeFile(join(corrupt, "docker-compose.release.yml"), "corrupted\n");
    const corruptResume = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; Set-DPFConsumerReleaseIdentity -InstallDir '${corrupt}' -Version 'v-next'`], { encoding: "utf8" });
    assert.notEqual(corruptResume.status, 0);
    assert.match(corruptResume.stderr, /consumer_release_asset_integrity_failed/);
    assert.equal(await readFile(join(corrupt, ".env"), "utf8"), "DPF_IMAGE_TAG=previous-good\n");

    await writeFile(join(carrier, "unverified.txt"), "not in manifest\n");
    const rejected = join(dir, "rejected");
    await mkdir(rejected);
    await writeFile(join(rejected, ".env"), "DPF_IMAGE_TAG=previous-good\n");
    const unverified = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; Export-DPFConsumerReleaseAssets -InstallDir '${rejected}' -Version 'v-rejected' -AssetSource '${carrier}'; Set-DPFConsumerReleaseIdentity -InstallDir '${rejected}' -Version 'v-rejected'`], { encoding: "utf8" });
    assert.notEqual(unverified.status, 0);
    assert.match(unverified.stderr, /consumer_release_asset_unverified/);
    assert.equal(await readFile(join(rejected, ".env"), "utf8"), "DPF_IMAGE_TAG=previous-good\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows installer converges release identity as one multi-key state transaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-win-state-identity-"));
  try {
    const stateDir = join(dir, "state");
    const install = join(dir, "install");
    await mkdir(install, { recursive: true });
    const command = [
      `$env:DPF_STATE_DIR='${stateDir}'`,
      `. '${join(root, "scripts", "installer", "lib", "state.ps1")}'`,
      `Initialize-DpfState -InstallerVersion 'old' -InstallPath '${install}'`,
      `Set-DpfStateValues -Values @{ installerVersion='v2.0.0'; lastSuccessfulInstallVersion='v2.0.0'; installPath='${install}'; installMode='consumer'; composeFiles=@('docker-compose.yml','docker-compose.release.yml'); imageTag='v2.0.0' }`,
    ].join("; ");
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const state = JSON.parse(await readFile(join(stateDir, "install-state.json"), "utf8"));
    assert.equal(state.installerVersion, "v2.0.0");
    assert.equal(state.lastSuccessfulInstallVersion, "v2.0.0");
    assert.equal(state.installMode, "consumer");
    assert.equal(state.imageTag, "v2.0.0");
    assert.deepEqual(state.composeFiles, ["docker-compose.yml", "docker-compose.release.yml"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated Windows start script executes the canonical adapter before Compose", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-win-start-"));
  try {
    const generated = join(dir, "dpf-start.ps1");
    const generation = spawnSync("pwsh", ["-NoProfile", "-Command", `. '${join(root, "install-dpf.ps1")}' -LibraryOnly; [IO.File]::WriteAllText('${generated}', (Get-DPFStartScriptContent), [Text.Encoding]::ASCII)`], { encoding: "utf8" });
    assert.equal(generation.status, 0, generation.stderr);
    const source = await readFile(generated, "ascii");
    assert.match(source, /Resolve-DpfConsumerReleaseImageTag -InstallDir \$DPF_DIR/);
    assert.ok(source.indexOf("Resolve-DpfConsumerReleaseImageTag") < source.indexOf("docker compose"));
    assert.match(source, /Resolve-DpfCapabilityComposeProfiles/);
    assert.match(source, /COMPOSE_PROFILES/);
    assert.doesNotMatch(source, /Join-Path \$HOME "\.dpf\\install-state\.json"/);
    const installer = await readFile(join(root, "install-dpf.ps1"), "ascii");
    assert.match(installer, /Resolve-DpfCapabilityComposeProfiles -InstallDir \$DPF_DIR/);
    assert.match(installer, /dpf-start\.ps1" -Encoding ASCII/);
    for (const checkedIn of ["dpf-start.ps1", "scripts/dpf-start.ps1"]) {
      const checkedInSource = await readFile(join(root, checkedIn), "utf8");
      assert.match(checkedInSource, /Resolve-DpfConsumerReleaseImageTag -InstallDir \$DPF_DIR/);
      assert.ok(checkedInSource.indexOf("Resolve-DpfConsumerReleaseImageTag") < checkedInSource.indexOf("docker compose"));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows consumer start projects the recorded immutable release tag and fails closed without it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-win-consumer-tag-"));
  try {
    const stateDir = join(dir, "state");
    await mkdir(stateDir, { recursive: true });
    const statePath = join(stateDir, "install-state.json");
    const base = {
      schemaVersion: 2,
      installerVersion: "v2026.08.29",
      platform: "win32",
      arch: "amd64",
      enabledRuntimeCapabilities: [],
      capabilityCatalogHash: null,
      capabilityStateVersion: null,
      installPath: dir,
      installMode: "consumer",
    };
    await writeFile(statePath, `${JSON.stringify({ ...base, imageTag: "v2026.08.29-release.1" })}\n`);
    const helper = join(root, "scripts", "installer", "lib", "state.ps1");
    const resolve = [
      `$env:DPF_STATE_DIR='${stateDir}'`,
      `$env:DPF_IMAGE_TAG='latest'`,
      `. '${helper}'`,
      `$tag=Resolve-DpfConsumerReleaseImageTag -InstallDir '${dir}'`,
      `Write-Output "$tag|$env:DPF_IMAGE_TAG"`,
    ].join("; ");
    const resolved = spawnSync("pwsh", ["-NoProfile", "-Command", resolve], { encoding: "utf8" });
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.match(resolved.stdout, /overrides environment tag 'latest'/);
    assert.match(resolved.stdout, /v2026\.08\.29-release\.1\|v2026\.08\.29-release\.1\s*$/);

    await writeFile(statePath, `${JSON.stringify({ ...base, imageTag: null })}\n`);
    const missing = spawnSync("pwsh", ["-NoProfile", "-Command", resolve], { encoding: "utf8" });
    assert.notEqual(missing.status, 0);
    assert.match(`${missing.stdout}\n${missing.stderr}`, /consumer_release_identity_missing/);

    await writeFile(statePath, `${JSON.stringify({ ...base, imageTag: "latest" })}\n`);
    const mutable = spawnSync("pwsh", ["-NoProfile", "-Command", resolve], { encoding: "utf8" });
    assert.notEqual(mutable.status, 0);
    assert.match(`${mutable.stdout}\n${mutable.stderr}`, /consumer_release_identity_invalid/);

    await writeFile(statePath, `${JSON.stringify({ ...base, installMode: "contributor", imageTag: null })}\n`);
    const contributor = spawnSync("pwsh", ["-NoProfile", "-Command", resolve], { encoding: "utf8" });
    assert.equal(contributor.status, 0, contributor.stderr);
    assert.equal(contributor.stdout.trim(), "|latest");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("POSIX autostart resolves and executes the XDG state snapshot", async () => {
  const dir = await mkdtemp(join(root, ".task5-xdg-"));
  try {
    const xdg = join(dir, "xdg");
    const bin = join(dir, "bin");
    const trace = join(dir, "trace.txt");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "node"), `#!/bin/sh\nprintf 'node:%s\\n' "$*" >> '${bashPath(trace)}'\nprintf '%s\\n' '{"composeProfiles":["runtime-build"]}'\n`);
    await writeFile(join(bin, "docker"), `#!/bin/sh\nprintf 'docker:%s\\n' "$*" >> '${bashPath(trace)}'\n`);
    await chmod(join(bin, "node"), 0o755);
    await chmod(join(bin, "docker"), 0o755);
    const command = `unset DPF_LIB_AUTOSTART_LOADED DPF_LIB_LOGGING_LOADED DPF_LIB_PLATFORM_LOADED DPF_LIB_STATE_LOADED; export HOME='${bashPath(join(dir, "home"))}' XDG_STATE_HOME='${bashPath(xdg)}' PATH='${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin'; source scripts/installer/lib/state.sh; source scripts/installer/lib/autostart.sh; launch=$(_dpf_autostart_write_launch_script '${bashPath(root)}' '-f docker-compose.yml'); "$launch"`;
    const result = runBash(command);
    assert.equal(result.status, 0, result.stderr);
    const lines = await readFile(trace, "utf8");
    assert.match(lines, new RegExp(`node:.*--state ${bashPath(join(xdg, "dpf", "install-state.json")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(lines, /docker:compose -f docker-compose\.yml up -d/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("POSIX lifecycle preserves a governed COMPOSE_PROFILES host overlay", async () => {
  const dir = await mkdtemp(join(root, ".task5-compose-overlay-"));
  try {
    const command = `unset DPF_LIB_COMPOSE_LOADED DPF_LIB_PLATFORM_LOADED DPF_LIB_STATE_LOADED; export HOME='${bashPath(join(dir, "home"))}' XDG_STATE_HOME='${bashPath(join(dir, "xdg"))}' REPO_ROOT='${bashPath(root)}'; source scripts/installer/lib/state.sh; dpf_state_init test '${bashPath(root)}'; source scripts/installer/lib/compose.sh; DPF_PLATFORM=linux COMPOSE_PROFILES=linux-host-network; dpf_compose_profiles; printf '%s' "$COMPOSE_PROFILES"`;
    const result = runBash(command);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "linux-host-network");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dpf-compose uses XDG state and effective roots outside the working directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-compose-context-"));
  try {
    const install = join(dir, "install");
    const elsewhere = join(dir, "elsewhere");
    const xdg = join(dir, "xdg");
    const stateDir = join(xdg, "dpf");
    await mkdir(join(install, "scripts", "lib"), { recursive: true });
    await mkdir(elsewhere); await mkdir(stateDir, { recursive: true });
    await copyFile(join(root, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), join(install, "scripts", "lib", "resolve-capability-compose-profiles.mjs"));
    await copyFile(join(root, "scripts", "lib", "govern-capability-compose-args.mjs"), join(install, "scripts", "lib", "govern-capability-compose-args.mjs"));
    await copyFile(join(root, "scripts", "lib", "capability-state-hash.mjs"), join(install, "scripts", "lib", "capability-state-hash.mjs"));
    await mkdir(join(install, "scripts", "installer"), { recursive: true });
    for (const file of ["install-state-transaction.mjs", "install-state-lock-contract.json", "validate-install-state.mjs", "install-state-schema-registry.mjs", "install-state.schema.json", "install-state.v1.schema.json", "install-state.v2.schema.json"]) {
      await copyFile(join(root, "scripts", "installer", file), join(install, "scripts", "installer", file));
    }
    await copyFile(join(root, "scripts", "capability-service-catalog.generated.json"), join(install, "scripts", "capability-service-catalog.generated.json"));
    await writeFile(join(install, "docker-compose.yml"), "name: dpf-context\nservices: {}\n");
    await writeFile(join(stateDir, "install-state.json"), `\uFEFF${JSON.stringify({ schemaVersion: 1, installerVersion: "test", installPath: install, platform: "win32", arch: "amd64", enabledRuntimeCapabilities: [] })}\n`);
    const env = { ...process.env, XDG_STATE_HOME: xdg, COMPOSE_PROJECT_NAME: "dpf-context" };
    const byProjectDirectory = spawnSync(process.execPath, [join(root, "scripts", "dpf-compose.mjs"), "--project-directory", install, "-f", join(install, "docker-compose.yml"), "ps"], { cwd: elsewhere, env, encoding: "utf8" });
    assert.equal(byProjectDirectory.status, 0, byProjectDirectory.stderr);
    const byFile = spawnSync(process.execPath, [join(root, "scripts", "dpf-compose.mjs"), "-f", join(install, "docker-compose.yml"), "ps"], { cwd: elsewhere, env, encoding: "utf8" });
    assert.equal(byFile.status, 0, byFile.stderr);
    const migrated = JSON.parse(await readFile(join(stateDir, "install-state.json"), "utf8"));
    assert.equal(typeof migrated.capabilityCatalogHash, "string");
    assert.equal(typeof migrated.capabilityStateVersion, "string");

    await writeFile(join(stateDir, "install-state.json"), `${JSON.stringify({ schemaVersion: 1, installerVersion: "test", installPath: join(dir, "other"), platform: "win32", arch: "amd64" })}\n`);
    const mismatch = spawnSync(process.execPath, [join(root, "scripts", "dpf-compose.mjs"), "--project-directory", install, "ps"], { cwd: elsewhere, env, encoding: "utf8" });
    assert.equal(mismatch.status, 2);
    assert.match(mismatch.stderr, /capability_install_state_mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("promotion refuses stale state before Docker", async () => {
  const dir = await mkdtemp(join(root, ".task5-promote-stale-"));
  try {
    const source = join(dir, "source");
    const state = join(dir, "state");
    const bin = join(dir, "bin");
    await mkdir(join(source, "scripts", "lib"), { recursive: true });
    await mkdir(state); await mkdir(bin);
    await writeFile(join(state, "install-state.json"), "original\n");
    await writeFile(join(source, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), "process.stderr.write('capability_state_stale\\n'); process.exit(2);\n");
    await writeFile(join(bin, "node"), windowsNodeShim);
    await writeFile(join(bin, "docker"), `#!/bin/sh\ntouch '${bashPath(join(dir, "docker-called"))}'\n`);
    await chmod(join(bin, "node"), 0o755); await chmod(join(bin, "docker"), 0o755);
    const handoff = await signedInstallStateHandoff(join(state, "install-state.json"), dir);
    const result = runBash(`${bashExports({ ...handoff, WSLENV: signingWslenv })}; PATH='${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin' DPF_PROMOTER_STATE_DIR='${bashPath(state)}' PROMOTE_SOURCE='${bashPath(source)}' PROMOTE_TARGET_SHA=x PROMOTE_BACKUP_PATH='${bashPath(join(dir, "backup"))}' PROMOTE_HEALTH_URL=http://invalid bash scripts/promote.sh --self-upgrade`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /capability_state_stale/);
    assert.equal(spawnSync("pwsh", ["-NoProfile", "-Command", `Test-Path '${join(dir, "docker-called")}'`], { encoding: "utf8" }).stdout.trim(), "False");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("promotion recovery snapshot is copied and restored after a simulated Docker failure", async () => {
  const dir = await mkdtemp(join(root, ".task5-promote-rollback-"));
  try {
    const source = join(dir, "source"); const state = join(dir, "state"); const bin = join(dir, "bin"); const backup = join(dir, "backup");
    await mkdir(join(source, "scripts", "lib"), { recursive: true }); await mkdir(state); await mkdir(bin);
    await writeFile(join(source, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), "process.stdout.write('{\"composeProfiles\":[],\"requiredServices\":[]}\\n');\n");
    const originalSnapshot = `${JSON.stringify({ schemaVersion: 2, installerVersion: "test", platform: "linux", arch: "amd64", enabledRuntimeCapabilities: [], capabilityCatalogHash: null, capabilityStateVersion: null })}\n`;
    await writeFile(join(state, "install-state.json"), originalSnapshot);
    spawnSync("git", ["init", "-q", source]); spawnSync("git", ["-C", source, "config", "user.email", "test@example.com"]); spawnSync("git", ["-C", source, "config", "user.name", "Test"]); spawnSync("git", ["-C", source, "add", "."]); spawnSync("git", ["-C", source, "commit", "-q", "-m", "fixture"]);
    const sha = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    await writeFile(join(bin, "node"), windowsNodeShim);
    await writeFile(join(bin, "docker"), `#!/bin/sh\nprintf 'corrupted\\n' > '${bashPath(join(state, "install-state.json"))}'\nexit 42\n`);
    await chmod(join(bin, "node"), 0o755); await chmod(join(bin, "docker"), 0o755);
    const handoff = await signedInstallStateHandoff(join(state, "install-state.json"), dir);
    const result = runBash(`${bashExports({ ...handoff, WSLENV: signingWslenv })}; PATH='${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin' DPF_PROMOTER_STATE_DIR='${bashPath(state)}' PROMOTE_SOURCE='${bashPath(source)}' PROMOTE_TARGET_SHA='${sha}' PROMOTE_BACKUP_PATH='${bashPath(backup)}' PROMOTE_HEALTH_URL=http://invalid bash scripts/promote.sh --self-upgrade`);
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(join(backup, "install-state.json"), "utf8"), originalSnapshot);
    assert.equal(await readFile(join(state, "install-state.json"), "utf8"), originalSnapshot);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("explicit optional-service gates execute from enabled and disabled projections", async () => {
  const dir = await mkdtemp(join(root, ".task5-service-gate-"));
  try {
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "node"), "#!/bin/sh\npayload=$(cat)\nprintf '%s' \"$payload\" | grep -q \"\\\"$3\\\"\"\n");
    await chmod(join(bin, "node"), 0o755);
    const command = `export PATH='${bashPath(bin)}:/usr/local/bin:/usr/bin:/bin'; DPF_LIB_PLATFORM_LOADED=1 DPF_LIB_STATE_LOADED=1; source scripts/installer/lib/compose.sh; DPF_CAPABILITY_PROJECTION='{\"requiredServices\":[\"dpf-tts\"]}'; dpf_capability_service_required dpf-tts; DPF_CAPABILITY_PROJECTION='{\"requiredServices\":[]}'; if dpf_capability_service_required dpf-tts; then exit 9; fi`;
    const result = runBash(command);
    assert.equal(result.status, 0, result.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("all touched PowerShell lifecycle files are ASCII and parse under PowerShell 5.1 grammar", () => {
  const files = ["install-dpf.ps1", "dpf-start.ps1", "scripts/dpf-start.ps1", "scripts/fresh-install.ps1", "scripts/installer/lib/state.ps1", "scripts/setup.ps1"];
  const command = `$errors=@(); ${files.map((file) => `$bytes=[IO.File]::ReadAllBytes('${join(root, file)}'); if($bytes | Where-Object {$_ -gt 127}){throw 'non_ascii:${file}'}; [void][Management.Automation.Language.Parser]::ParseFile('${join(root, file)}',[ref]$null,[ref]$errors)`).join("; ")}; if($errors.Count){throw ($errors -join ';')}`;
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

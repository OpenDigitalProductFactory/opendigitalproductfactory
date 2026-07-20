import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const execFileAsync = promisify(execFile);

test("stable releases publish integrity-bound native Edge binaries", async () => {
  const workflow = await read(".github/workflows/publish-release.yml");

  assert.match(workflow, /actions\/setup-go@/);
  assert.match(workflow, /git\s+checkout\s+--detach\s+"refs\/tags\/\$\{TAG\}"/);
  assert.ok(
    workflow.indexOf('git checkout --detach "refs/tags/${TAG}"') < workflow.indexOf("make -C services/edge-node-go"),
    "release binaries must be built from the resolved tag",
  );
  assert.match(workflow, /make\s+-C\s+services\/edge-node-go\s+build-darwin-arm64/);
  assert.match(workflow, /make\s+-C\s+services\/edge-node-go\s+build-windows-amd64/);
  assert.match(workflow, /dpf-edge-node-checksums\.sha256/);
  assert.match(workflow, /gh release upload/);
});

test("the standalone Windows bootstrap does not require release companions before export", async () => {
  const installer = await read("install-dpf.ps1");

  assert.match(installer, /function Resolve-DPFNativeEdgeModulePath/);
  assert.match(installer, /Resolve-DPFNativeEdgeModulePath -InstallDir \$InstallDir/);
  assert.doesNotMatch(installer, /^\. \(Join-Path \$PSScriptRoot "scripts\\installer\\native-edge-host\.ps1"\)$/m);
});

test("macOS installer provisions the host-native Edge process instead of the Docker Edge service", async () => {
  const installer = await read("install-dpf.sh");
  const hostInstaller = await read("scripts/installer/native-edge-host.sh");
  const launchAgent = await read("scripts/installer/macos-edge-node.plist.tmpl");

  assert.match(installer, /dpf_native_edge_install/);
  assert.match(hostInstaller, /dpf-edge-node-darwin-arm64/);
  assert.match(hostInstaller, /dpf-edge-node-checksums\.sha256/);
  assert.match(hostInstaller, /shasum\s+-a\s+256\s+-c/);
  assert.match(hostInstaller, /DPF_AUTHORITY_URL/);
  assert.match(hostInstaller, /DPF_EDGE_STATE_DIR/);
  assert.match(launchAgent, /local\.dpf-edge-node/);
  assert.match(launchAgent, /KeepAlive/);
});

test("Windows installer provisions a verified native Edge binary and supervised task", async () => {
  const installer = await read("install-dpf.ps1");
  const hostInstaller = await read("scripts/installer/native-edge-host.ps1");

  assert.match(installer, /Install-DPFNativeEdgeNode/);
  assert.match(hostInstaller, /dpf-edge-node-windows-amd64\.exe/);
  assert.match(hostInstaller, /dpf-edge-node-checksums\.sha256/);
  assert.match(hostInstaller, /Get-FileHash/);
  assert.match(hostInstaller, /Register-ScheduledTask/);
  assert.match(hostInstaller, /New-NetFirewallRule/);
  assert.match(hostInstaller, /LocalPort\s+5353/);
  assert.match(hostInstaller, /DPF_AUTHORITY_URL/);
  assert.match(hostInstaller, /DPF_EDGE_STATE_DIR/);
});

test("Docker Desktop installers retire the legacy container after native host installation", async () => {
  const shellInstaller = await read("install-dpf.sh");
  const windowsInstaller = await read("install-dpf.ps1");

  assert.match(shellInstaller, /stop\s+edge-node/);
  assert.match(windowsInstaller, /stop\s+edge-node/);
});

test("native host enrollment uses a LAN Authority URL and never silently claims trusted HTTPS", async () => {
  const shellInstaller = await read("scripts/installer/native-edge-host.sh");
  const windowsInstaller = await read("scripts/installer/native-edge-host.ps1");

  for (const source of [shellInstaller, windowsInstaller]) {
    assert.match(source, /DPF_LAN_AUTHORITY_URL/);
    assert.match(source, /https/i);
    assert.match(source, /automatic pairing/i);
  }
  assert.match(shellInstaller, /ipconfig\s+getifaddr/);
  assert.match(windowsInstaller, /Get-NetIPAddress/);
  assert.doesNotMatch(shellInstaller, /authority_url="http:\/\/\$\(hostname[^\n]+\.local:3000"/);
});

test("host installers emit the install mode accepted by the native binary", async () => {
  const shellInstaller = await read("scripts/installer/native-edge-host.sh");
  const windowsInstaller = await read("scripts/installer/native-edge-host.ps1");

  assert.match(shellInstaller, /DPF_INSTALL_MODE=native(?:\\n|'|\")/);
  assert.doesNotMatch(shellInstaller, /DPF_INSTALL_MODE=native-host/);
  assert.match(windowsInstaller, /DPF_INSTALL_MODE\s*=\s*'native'/);
  assert.doesNotMatch(windowsInstaller, /DPF_INSTALL_MODE\s*=\s*'native-host'/);
});

test("macOS host install clears quarantine and signs the verified binary before launchd", async () => {
  const shellInstaller = await read("scripts/installer/native-edge-host.sh");

  assert.match(shellInstaller, /xattr\s+-d\s+com\.apple\.quarantine/);
  assert.match(shellInstaller, /codesign\s+--force\s+--sign\s+-/);
  assert.ok(
    shellInstaller.indexOf("shasum -a 256 -c") < shellInstaller.indexOf("codesign --force --sign -"),
    "release checksum verification must precede local signing",
  );
});

test("macOS host install preserves the one-time token in its protected runtime env", async () => {
  const root = await mkdtemp(join(tmpdir(), "dpf-native-edge-test-"));
  const repo = join(root, "repo");
  const fakeBin = join(root, "fake-bin");
  const state = join(root, "state");
  const home = join(root, "home");
  await mkdir(join(repo, "services/edge-node-go/bin"), { recursive: true });
  await mkdir(join(repo, "scripts/installer"), { recursive: true });
  await mkdir(join(home, "Library/LaunchAgents"), { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(join(repo, "services/edge-node-go/bin/dpf-edge-node-darwin-arm64"), "#!/bin/sh\nexit 0\n");
  await chmod(join(repo, "services/edge-node-go/bin/dpf-edge-node-darwin-arm64"), 0o755);
  await writeFile(
    join(repo, "scripts/installer/macos-edge-node.plist.tmpl"),
    "@@DPF_EDGE_LAUNCH_SCRIPT@@\n@@DPF_EDGE_LOG_DIR@@\n",
  );
  for (const [name, body] of [
    ["uname", "#!/bin/sh\necho Darwin\n"],
    ["hostname", "#!/bin/sh\necho test-mac\n"],
    ["ipconfig", "#!/bin/sh\necho 192.168.50.25\n"],
    ["xattr", "#!/bin/sh\nexit 0\n"],
    ["codesign", "#!/bin/sh\nexit 0\n"],
    ["launchctl", "#!/bin/sh\nexit 0\n"],
  ]) {
    await writeFile(join(fakeBin, name), body);
    await chmod(join(fakeBin, name), 0o755);
  }

  const installerPath = new URL("./native-edge-host.sh", import.meta.url).pathname;
  await execFileAsync("/bin/bash", ["-c", [
    "warn() { :; }", "ok() { :; }", `. ${JSON.stringify(installerPath)}`,
    `dpf_native_edge_install ${JSON.stringify(repo)} dpfboot_TEST_TOKEN test-mac`,
  ].join("; ")], {
    env: { ...process.env, HOME: home, DPF_STATE_DIR: state, PATH: `${fakeBin}:${process.env.PATH}` },
  });

  const runtimeEnv = await readFile(join(state, "edge-node.env"), "utf8");
  assert.match(runtimeEnv, /^DPF_BOOTSTRAP_TOKEN=dpfboot_TEST_TOKEN$/m);
  assert.match(runtimeEnv, /^DPF_INSTALL_MODE=native$/m);
  assert.match(runtimeEnv, /^DPF_AUTHORITY_URL=http:\/\/192\.168\.50\.25:3000$/m);
});

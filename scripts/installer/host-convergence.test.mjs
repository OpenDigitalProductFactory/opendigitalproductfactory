// BI-084F85E5: host-side convergence on an existing install. Drives the
// shipped PowerShell module with the host commands (scheduled tasks, docker,
// the native agent installer) replaced by recorders, and checks the observable
// contract: what is installed, for which release and role, and what is logged.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const module = join(root, "scripts", "installer", "lib", "host-convergence.ps1");
const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;

async function fixture({ version = "v2026.10.15-test.1", enrolled = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dpf-host-converge-"));
  const install = join(dir, "install");
  const state = join(dir, "state");
  await mkdir(join(install, "scripts", "installer"), { recursive: true });
  await mkdir(join(state, "edge-node"), { recursive: true });
  if (version) await writeFile(join(install, ".verified-release-assets-version"), version);
  if (enrolled) await writeFile(join(state, "edge-node", "state.json"), "{}");
  // The release's agent installer, replaced by a recorder.
  await writeFile(join(install, "scripts", "installer", "native-edge-host.ps1"), [
    "function Install-DPFNativeEdgeNode {",
    "  param($InstallDir, [AllowEmptyString()]$BootstrapToken, $Version, $Role)",
    "  if ($env:FAKE_INSTALL_THROWS -eq '1') { throw 'download_failed' }",
    "  Add-Content -LiteralPath $env:FAKE_TRACE -Value \"install token=$BootstrapToken version=$Version role=$Role\"",
    "  return $true",
    "}",
  ].join("\n"));
  return { dir, install, state, trace: join(dir, "trace.txt") };
}

function converge(fx, { role = "host-upkeep", taskExists = false, tokenOk = true, installThrows = false } = {}) {
  const command = [
    `$env:DPF_STATE_DIR = '${fx.state}'`,
    `$env:FAKE_TRACE = '${fx.trace}'`,
    `$env:FAKE_INSTALL_THROWS = '${installThrows ? "1" : "0"}'`,
    `function Get-ScheduledTask { param($TaskName, $ErrorAction) if ('${taskExists ? "1" : "0"}' -eq '1') { [pscustomobject]@{ TaskName = $TaskName } } }`,
    `function docker { Add-Content -LiteralPath $env:FAKE_TRACE -Value ("docker " + ($args -join ' ')); $global:LASTEXITCODE = 0; if ('${tokenOk ? "1" : "0"}' -eq '1') { 'dpfboot_TESTTOKEN' } else { 'not a token' } }`,
    `. '${module}'`,
    `Invoke-DPFHostConvergence -InstallDir '${fx.install}' -Role '${role}'`,
  ].join("; ");
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/).at(-1);
}

const read = async path => (existsSync(path) ? (await readFile(path, "utf8")) : "");

test("a fresh host enrolls the agent at the install's release and records it", { skip: !hasPwsh && "no PowerShell" }, async () => {
  const fx = await fixture();
  try {
    assert.equal(converge(fx), "converged");
    const trace = await read(fx.trace);
    assert.match(trace, /docker exec \S+ sh -c .*issue-edge-bootstrap-token\.ts --ttl-minutes 30 --auto-approve/);
    assert.match(trace, /install token=dpfboot_TESTTOKEN version=v2026\.10\.15-test\.1 role=host-upkeep/);
    assert.equal(await read(join(fx.state, "edge-node", "installed-version")), "v2026.10.15-test.1|host-upkeep");
    assert.match(await read(join(fx.state, "logs", "host-convergence.log")), /converged version=v2026\.10\.15-test\.1 role=host-upkeep/);
  } finally { await rm(fx.dir, { recursive: true, force: true }); }
});

test("a converged host on the same release and role does nothing", { skip: !hasPwsh && "no PowerShell" }, async () => {
  const fx = await fixture();
  try {
    assert.equal(converge(fx), "converged");
    await rm(fx.trace, { force: true });
    assert.equal(converge(fx, { taskExists: true }), "current");
    assert.equal(await read(fx.trace), "", "no token minted, no download");
  } finally { await rm(fx.dir, { recursive: true, force: true }); }
});

test("a new release, a changed role, or a missing task converges again", { skip: !hasPwsh && "no PowerShell" }, async () => {
  const fx = await fixture({ enrolled: true });
  try {
    assert.equal(converge(fx), "converged");
    assert.equal(converge(fx, { taskExists: true, role: "full" }), "converged");
    await writeFile(join(fx.install, ".verified-release-assets-version"), "v2026.10.16-test.2");
    assert.equal(converge(fx, { taskExists: true, role: "full" }), "converged");
    assert.equal(await read(join(fx.state, "edge-node", "installed-version")), "v2026.10.16-test.2|full");
    assert.equal(converge(fx, { taskExists: false, role: "full" }), "converged", "a deleted task is reinstalled");
  } finally { await rm(fx.dir, { recursive: true, force: true }); }
});

test("an enrolled host keeps its machine identity: no new token is minted", { skip: !hasPwsh && "no PowerShell" }, async () => {
  const fx = await fixture({ enrolled: true });
  try {
    assert.equal(converge(fx), "converged");
    const trace = await read(fx.trace);
    assert.doesNotMatch(trace, /^docker /m);
    assert.match(trace, /install token= version=/);
  } finally { await rm(fx.dir, { recursive: true, force: true }); }
});

test("failures are reported and logged, never thrown, and record nothing", { skip: !hasPwsh && "no PowerShell" }, async () => {
  const noToken = await fixture();
  const broken = await fixture({ enrolled: true });
  try {
    assert.equal(converge(noToken, { tokenOk: false }), "token-failed");
    assert.doesNotMatch(await read(noToken.trace), /^install /m);
    assert.equal(converge(broken, { installThrows: true }), "failed");
    assert.match(await read(join(broken.state, "logs", "host-convergence.log")), /failed .*reason=download_failed/);
    assert.equal(await read(join(broken.state, "edge-node", "installed-version")), "");
  } finally {
    await rm(noToken.dir, { recursive: true, force: true });
    await rm(broken.dir, { recursive: true, force: true });
  }
});

test("an install with no release record follows the latest release", { skip: !hasPwsh && "no PowerShell" }, async () => {
  const fx = await fixture({ version: null, enrolled: true });
  try {
    assert.equal(converge(fx), "converged");
    assert.match(await read(fx.trace), /version=latest role=host-upkeep/);
  } finally { await rm(fx.dir, { recursive: true, force: true }); }
});

test("the release ships the start script and the module, and the start script converges after health", async () => {
  const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /cp scripts\/installer\/dpf-start\.consumer\.ps1 \/dpf-release-assets\/dpf-start\.ps1/);
  assert.match(dockerfile, /scripts\/installer\/lib\/host-convergence\.ps1 [^\n]*\/dpf-release-assets\/scripts\/installer\/lib\//);
  const start = await readFile(join(root, "scripts", "installer", "dpf-start.consumer.ps1"), "utf8");
  const health = start.indexOf("$healthy = $true");
  const convergence = start.indexOf("Invoke-DPFHostConvergence");
  assert.ok(health > 0 && convergence > health, "convergence runs only after the portal is healthy");
  assert.match(start, /if \(\$healthy -and \(Test-Path -LiteralPath \$hostConvergenceModule\)\)/);
  assert.doesNotMatch(start, /Restart-Computer|shutdown(\.exe)? \/r|Stop-Computer/i, "never reboots the host");
  const installer = await readFile(join(root, "install-dpf.ps1"), "utf8");
  assert.match(installer, /scripts\\installer\\dpf-start\.consumer\.ps1/, "the installer reads the shipped script, not an embedded copy");
  assert.match(installer, /New-DPFEdgeBootstrapToken -PortalContainer/, "the installer uses the shipped token issuance");
});

// ── macOS / Linux twin (host-convergence.sh) ────────────────────────────────
// Drives real bash with the host commands (uname, systemctl, docker) replaced by
// recorders on PATH. POSIX hosts only: the Windows bash here is WSL or Git Bash,
// and these paths are host paths.
const shModule = join(root, "scripts", "installer", "lib", "host-convergence.sh");
const posix = process.platform !== "win32";

async function shFixture({ version = "v2026.10.15-test.1", enrolled = false, installFails = false } = {}) {
  const fx = await fixture({ version, enrolled });
  const bin = join(fx.dir, "bin");
  await mkdir(bin, { recursive: true });
  const stub = async (name, body) => { await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`); spawnSync("chmod", ["0755", join(bin, name)]); };
  await stub("uname", "echo Linux");
  await stub("systemctl", `[ -f '${fx.dir}/service-enabled' ]`);
  await stub("docker", `echo "docker $*" >> '${fx.trace}'; case "$1" in ps) echo portal-id ;; exec) echo 'noise'; echo 'dpfboot_SHTOKEN' ;; esac`);
  await writeFile(join(fx.install, "scripts", "installer", "native-edge-host.sh"), [
    "dpf_native_edge_install() {",
    `  echo "install token=$2 version=$DPF_NATIVE_EDGE_VERSION role=$4" >> '${fx.trace}'`,
    installFails ? "  return 1" : `  touch '${fx.dir}/service-enabled'`,
    "}",
  ].join("\n"));
  return { ...fx, bin };
}

function shConverge(fx, role = "host-upkeep") {
  const result = spawnSync("bash", ["-c", `. '${shModule}'; dpf_host_converge '${fx.install}' '${role}'`], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, DPF_STATE_DIR: fx.state },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split("\n").at(-1);
}

test("macOS/Linux: a fresh host enrolls the agent at the release, then stays current", { skip: !posix && "POSIX host only" }, async () => {
  const fx = await shFixture();
  try {
    assert.equal(shConverge(fx), "converged");
    const trace = await read(fx.trace);
    assert.match(trace, /docker exec portal-id sh -c .*issue-edge-bootstrap-token\.ts/);
    assert.match(trace, /install token=dpfboot_SHTOKEN version=v2026\.10\.15-test\.1 role=host-upkeep/);
    assert.equal(await read(join(fx.state, "edge-node", "installed-version")), "v2026.10.15-test.1|host-upkeep");
    await rm(fx.trace, { force: true });
    assert.equal(shConverge(fx), "current");
    assert.equal(await read(fx.trace), "");
    assert.equal(shConverge(fx, "full"), "converged", "a changed role converges again");
  } finally { await rm(fx.dir, { recursive: true, force: true }); }
});

test("macOS/Linux: enrolled hosts mint no token; failures report and record nothing", { skip: !posix && "POSIX host only" }, async () => {
  const enrolled = await shFixture({ enrolled: true });
  const broken = await shFixture({ enrolled: true, installFails: true });
  try {
    assert.equal(shConverge(enrolled), "converged");
    assert.doesNotMatch(await read(enrolled.trace), /^docker /m);
    assert.equal(shConverge(broken), "failed");
    assert.equal(await read(join(broken.state, "edge-node", "installed-version")), "");
    assert.match(await read(join(broken.state, "logs", "host-convergence.log")), /failed version=/);
  } finally {
    await rm(enrolled.dir, { recursive: true, force: true });
    await rm(broken.dir, { recursive: true, force: true });
  }
});

// ── Self-upgrade bridge for launch scripts written before BI-084F85E5 ───────
const BRIDGE_CASES = {
  // install-dpf.sh since 2026-07-18 (#3266): the resolver runs inline.
  july: [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'cd "/opt/dpf"',
    '_dpf_projection="$(node scripts/lib/resolve-capability-compose-profiles.mjs --state "/home/a/.dpf/install-state.json" --host "$(uname)" --migrate --write)"',
    "export COMPOSE_PROFILES",
    "exec docker compose -f docker-compose.yml -f docker-compose.release.yml up -d",
    "",
  ].join("\n"),
  // install-dpf.sh 2026-05-10 .. 2026-07-18 (#427): compose only, no shipped code at boot.
  may: ["#!/usr/bin/env bash", "set -euo pipefail", 'cd "/Users/ops/dpf"', "exec docker compose -f docker-compose.yml up -d", ""].join("\n"),
};

async function bridgeFixture(launchText, { entrypoint = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dpf-bridge-"));
  const stateDir = join(dir, "state");
  const installRoot = join(dir, "install");
  await mkdir(stateDir, { recursive: true });
  await mkdir(join(installRoot, "scripts", "installer"), { recursive: true });
  if (entrypoint) await writeFile(join(installRoot, "scripts", "installer", "dpf-start.consumer.sh"), "#!/bin/sh\n");
  if (launchText !== null) await writeFile(join(stateDir, "dpf-autostart.sh"), launchText);
  return { dir, stateDir, installRoot, launcher: join(stateDir, "dpf-autostart.sh") };
}

test("the self-upgrade bridges every launch script generation to the shipped pointer, once", async () => {
  const { bridgeAutostartLaunchScript } = await import("./autostart-bridge.mjs");
  for (const [generation, text] of Object.entries(BRIDGE_CASES)) {
    const fx = await bridgeFixture(text);
    try {
      assert.equal(bridgeAutostartLaunchScript(fx), "bridged", generation);
      const pointer = await readFile(fx.launcher, "utf8");
      const install = text.match(/^cd "([^"]+)"$/m)[1];
      const chain = text.match(/^exec docker compose (.+) up -d$/m)[1];
      assert.ok(pointer.includes(`exec /bin/bash "${install}/scripts/installer/dpf-start.consumer.sh" "${install}" "$(cd "$(dirname "$0")" && pwd)/install-state.json" ${chain}`), `${generation}: ${pointer}`);
      assert.equal(bridgeAutostartLaunchScript(fx), "unchanged", `${generation}: a bridged script is left alone`);
    } finally { await rm(fx.dir, { recursive: true, force: true }); }
  }
});

test("the bridge leaves Windows, operator scripts and installs without the entrypoint untouched", async () => {
  const { bridgeAutostartLaunchScript } = await import("./autostart-bridge.mjs");
  const none = await bridgeFixture(null);
  const custom = await bridgeFixture("#!/bin/sh\necho my own start\n");
  const noEntrypoint = await bridgeFixture(BRIDGE_CASES.july, { entrypoint: false });
  try {
    assert.equal(bridgeAutostartLaunchScript(none), "no-launch-script");
    assert.equal(bridgeAutostartLaunchScript(custom), "unchanged");
    assert.equal(await readFile(custom.launcher, "utf8"), "#!/bin/sh\necho my own start\n");
    assert.equal(bridgeAutostartLaunchScript(noEntrypoint), "entrypoint-missing");
    assert.equal(await readFile(noEntrypoint.launcher, "utf8"), BRIDGE_CASES.july, "never points at a file that is not there");
    assert.equal(bridgeAutostartLaunchScript({}), "no-state-dir");
  } finally {
    for (const fx of [none, custom, noEntrypoint]) await rm(fx.dir, { recursive: true, force: true });
  }
});

test("the bridged pointer starts the shipped entrypoint with the state beside it", { skip: !posix && "POSIX host only" }, async () => {
  const { bridgeAutostartLaunchScript } = await import("./autostart-bridge.mjs");
  const fx = await bridgeFixture(BRIDGE_CASES.may);
  try {
    const text = BRIDGE_CASES.may.replace('cd "/Users/ops/dpf"', `cd "${fx.installRoot}"`);
    await writeFile(fx.launcher, text);
    await writeFile(join(fx.installRoot, "scripts", "installer", "dpf-start.consumer.sh"), '#!/bin/sh\nprintf "%s\n" "$@"\n');
    assert.equal(bridgeAutostartLaunchScript(fx), "bridged");
    const run = spawnSync("/bin/bash", [fx.launcher], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.stdout.trim().split("\n"), [fx.installRoot, join(fx.stateDir, "install-state.json"), "-f", "docker-compose.yml"]);
  } finally { await rm(fx.dir, { recursive: true, force: true }); }
});

test("promote.sh runs the bridge from the install root after the release commit; new launch scripts are pointers", async () => {
  const promote = await readFile(join(root, "scripts", "promote.sh"), "utf8");
  const commit = promote.indexOf("emit_step release-identity-commit");
  const bridge = promote.indexOf('node "$_bridge_root/scripts/installer/autostart-bridge.mjs"');
  assert.ok(commit > 0 && bridge > commit, "the bridge runs after the verified assets are committed");
  assert.match(promote, /_bridge_root="\$\{PROMOTE_INSTALL_ROOT:-\$\{PROMOTE_SOURCE:-\}\}"/);
  assert.match(promote, /--state-dir "\$DPF_PROMOTER_STATE_DIR"/);
  const autostart = await readFile(join(root, "scripts", "installer", "lib", "autostart.sh"), "utf8");
  assert.match(autostart, /exec \/bin\/bash "\$install_path\/scripts\/installer\/dpf-start\.consumer\.sh" "\$install_path" "\$state_path" \$compose_chain/);
  const start = await readFile(join(root, "scripts", "installer", "dpf-start.consumer.sh"), "utf8");
  assert.ok(start.indexOf("healthy=1") < start.indexOf("dpf_host_converge"), "convergence runs only after the portal is healthy");
  assert.doesNotMatch(start + autostart, /\breboot\b|shutdown -r|systemctl (reboot|poweroff)/, "never reboots the host");
  const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /cp scripts\/installer\/dpf-start\.consumer\.sh scripts\/installer\/native-edge-host\.sh scripts\/installer\/autostart-bridge\.mjs \/dpf-release-assets\/scripts\/installer\//);
  assert.match(dockerfile, /scripts\/installer\/lib\/host-convergence\.sh \/dpf-release-assets\/scripts\/installer\/lib\//);
  const resolver = await readFile(join(root, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), "utf8");
  assert.doesNotMatch(resolver, /autostart-bridge/, "the resolver carries no side effect");
});

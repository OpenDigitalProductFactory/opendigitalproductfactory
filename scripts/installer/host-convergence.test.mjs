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
  assert.match(dockerfile, /scripts\/installer\/lib\/host-convergence\.ps1 \/dpf-release-assets\/scripts\/installer\/lib\//);
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

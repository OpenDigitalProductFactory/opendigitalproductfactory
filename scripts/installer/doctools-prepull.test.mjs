// Fresh installs pull the release's dpf-doctools with the other release images
// (BI-698B7F9A, AC-2), so the portal can read Word, Excel and PDF files at first
// boot instead of waiting for its own reconciler to pull the converter.
//
// The installers are single scripts, so each test lifts the ONE function out of
// the real installer and runs it against a fake `docker`: the behaviour is
// proven by running it, not by reading it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");
const TAG = "v2026.09.25-office.1";
const IMAGE = `ghcr.io/opendigitalproductfactory/dpf-doctools:${TAG}`;

// --- install-dpf.sh ---------------------------------------------------------

function shellFunction() {
  const source = read("install-dpf.sh");
  const match = /^dpf_prepull_doctools\(\) \{\n[\s\S]*?\n\}\n/m.exec(source);
  assert.ok(match, "install-dpf.sh must define dpf_prepull_doctools()");
  return match[0];
}

function bashHost() {
  const probe = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" });
  return probe.status === 0 && probe.stdout.trim() === "ok";
}
const NEEDS_BASH = { skip: bashHost() ? false : "no bash on this machine; the installer function cannot run" };

function runShell({ tag = TAG, owner = "OpenDigitalProductFactory", dockerExit = 0, dockerOutput = "" } = {}) {
  const script = [
    "set -euo pipefail",
    // The installer captures `docker pull ... 2>&1`, so the fake logs its calls
    // on fd 3, which the capture does not redirect.
    "exec 3>&2",
    'ok() { printf "OK %s\\n" "$*"; }',
    'info() { printf "INFO %s\\n" "$*"; }',
    'warn() { printf "WARN %s\\n" "$*"; }',
    `docker() { printf 'DOCKER %s\\n' "$*" >&3; printf '%s\\n' ${JSON.stringify(dockerOutput)}; return ${dockerExit}; }`,
    shellFunction(),
    `dpf_prepull_doctools ${JSON.stringify(tag)} ${JSON.stringify(owner)}`,
    'echo "INSTALL CONTINUES"',
  ].join("\n");
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("install-dpf.sh pulls the release tag of dpf-doctools", NEEDS_BASH, () => {
  const out = runShell();
  assert.equal(out.status, 0);
  assert.match(out.stderr, new RegExp(`DOCKER pull ${IMAGE.replaceAll(".", "\\.")}`));
  assert.match(out.stdout, /^OK /m);
  assert.match(out.stdout, /INSTALL CONTINUES/);
});

test("install-dpf.sh treats a release with no converter as converter-less, not as a failure", NEEDS_BASH, () => {
  const out = runShell({ dockerExit: 1, dockerOutput: `Error response from daemon: manifest unknown` });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^INFO .*no document converter/m);
  assert.doesNotMatch(out.stdout, /^WARN /m);
  assert.match(out.stdout, /INSTALL CONTINUES/);
});

test("install-dpf.sh warns, and never fails the install, when the pull does not land", NEEDS_BASH, () => {
  const out = runShell({ dockerExit: 1, dockerOutput: "toomanyrequests: rate limit exceeded" });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^WARN /m);
  assert.match(out.stdout, /INSTALL CONTINUES/);
});

test("install-dpf.sh pulls nothing for a moving tag: the portal only pins an immutable release", NEEDS_BASH, () => {
  for (const tag of ["latest", "", "main"]) {
    const out = runShell({ tag });
    assert.equal(out.status, 0);
    assert.doesNotMatch(out.stderr, /DOCKER/);
  }
});

test("install-dpf.sh pulls it in customer mode, after the release image probe and before compose up", () => {
  const source = read("install-dpf.sh");
  const probe = source.indexOf("docker pull ghcr.io/opendigitalproductfactory/dpf-portal:latest");
  const call = source.indexOf('dpf_prepull_doctools "$(_dpf_env_value DPF_IMAGE_TAG)" "$(_dpf_env_value GHCR_OWNER)"');
  const up = source.indexOf('docker compose "${DPF_COMPOSE_FILES[@]}" up -d\n');
  assert.ok(probe > 0 && call > probe && up > call, "the pre-pull must sit between the release image probe and compose up");
  const customerBlock = source.slice(source.lastIndexOf('if [ "$DPF_INSTALL_MODE" = "customer" ]; then', call), call);
  assert.doesNotMatch(customerBlock, /\nfi\n/, "the pre-pull must run inside the customer-mode block");
});

// --- install-dpf.ps1 --------------------------------------------------------

function powershellHost() {
  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}
const pwsh = powershellHost();
const NEEDS_POWERSHELL = { skip: pwsh ? false : "no PowerShell host on this machine; the installer function cannot run" };

function runPowerShell({ version = TAG, dockerExit = 0, dockerOutput = "" } = {}) {
  const installer = join(root, "install-dpf.ps1").replaceAll("'", "''");
  const script = `
$ErrorActionPreference = 'Stop'
function Write-OK($msg) { Write-Host "OK $msg" }
function Write-Warn($msg) { Write-Host "WARN $msg" }
function docker { [Console]::Error.WriteLine("DOCKER " + ($args -join ' ')); ${JSON.stringify(dockerOutput)}; $global:LASTEXITCODE = ${dockerExit} }
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${installer}', [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-DPFDoctoolsPrePull' }, $true)
if (-not $fn) { throw 'install-dpf.ps1 must define Invoke-DPFDoctoolsPrePull' }
Invoke-Expression $fn.Extent.Text
$outcome = Invoke-DPFDoctoolsPrePull -Version '${version}'
Write-Host "OUTCOME $outcome"
Write-Host 'INSTALL CONTINUES'
`;
  const result = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("install-dpf.ps1 pulls the release tag of dpf-doctools", NEEDS_POWERSHELL, () => {
  const out = runPowerShell();
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stderr, new RegExp(`DOCKER pull ${IMAGE.replaceAll(".", "\\.")}`));
  assert.match(out.stdout, /OUTCOME pulled/);
  assert.match(out.stdout, /INSTALL CONTINUES/);
});

test("install-dpf.ps1 treats a release with no converter as converter-less, not as a failure", NEEDS_POWERSHELL, () => {
  const out = runPowerShell({ dockerExit: 1, dockerOutput: "Error response from daemon: manifest unknown" });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /OUTCOME not-published/);
  assert.doesNotMatch(out.stdout, /^WARN /m);
});

test("install-dpf.ps1 warns, and never fails the install, when the pull does not land", NEEDS_POWERSHELL, () => {
  const out = runPowerShell({ dockerExit: 1, dockerOutput: "toomanyrequests: rate limit exceeded" });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^WARN /m);
  assert.match(out.stdout, /OUTCOME failed/);
  assert.match(out.stdout, /INSTALL CONTINUES/);
});

test("install-dpf.ps1 pulls nothing for a moving tag: the portal only pins an immutable release", NEEDS_POWERSHELL, () => {
  const out = runPowerShell({ version: "latest" });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /OUTCOME not-release/);
  assert.doesNotMatch(out.stderr, /DOCKER/);
});

test("install-dpf.ps1 pulls it in consumer mode, after the compose image pull and before compose up", () => {
  const source = read("install-dpf.ps1");
  const pull = source.indexOf("docker compose @coreComposeArgs --progress plain pull");
  const call = source.indexOf("Invoke-DPFDoctoolsPrePull -Version $Version | Out-Null");
  const build = source.indexOf("docker compose @coreComposeArgs build --quiet");
  const up = source.indexOf("docker compose @coreComposeArgs up -d");
  assert.ok(pull > 0 && call > pull && build > call && up > call, "the pre-pull must follow the consumer image pull, inside the consumer branch");
});

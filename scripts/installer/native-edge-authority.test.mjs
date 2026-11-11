import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const shellPath = fileURLToPath(new URL("./native-edge-host.sh", import.meta.url));
const windowsPath = fileURLToPath(new URL("./native-edge-host.ps1", import.meta.url));

async function fixture(body) {
  const root = await mkdtemp(join(tmpdir(), "dpf-edge-authority-"));
  try {
    await mkdir(join(root, "state"));
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function environment(root, extra = {}) {
  const env = { ...process.env };
  for (const key of ["PUBLIC_URL", "DPF_CANONICAL_PUBLIC_URL", "DPF_LAN_AUTHORITY_URL"]) delete env[key];
  return { ...env, DPF_STATE_DIR: join(root, "state"), DPF_FIXTURE_REPO: root, ...extra };
}

async function chooseShell(root, platform, role, extra = {}) {
  const source = await readFile(shellPath, "utf8");
  const name = platform === "Darwin" ? "dpf_native_edge_install" : "dpf_native_edge_install_linux";
  const start = source.indexOf(`${name}() {`) + `${name}() {`.length;
  const end = source.indexOf("\n  mkdir -p", start);
  assert.ok(start > name.length && end > start, "selection must precede the first install effect");
  // Run the actual installer's selection block, stopping before any host file,
  // service, binary or enrollment mutation. HOME and real service commands are
  // never changed; only read-only address discovery is stubbed.
  const command = `source "$DPF_FIXTURE_SCRIPT"
uname() { if [ "$1" = -s ]; then printf '%s' "$DPF_FIXTURE_PLATFORM"; else printf arm64; fi; }
hostname() { printf fixture; }
ipconfig() { printf '%s' "$DPF_FIXTURE_LAN"; }
systemctl() { return 0; }
warn() { :; }
dpf_fixture_select() { ${source.slice(start, end)}
printf '%s' "$authority_url"
}
dpf_fixture_select "$DPF_FIXTURE_REPO" "" fixture "$DPF_FIXTURE_ROLE"`;
  return (await exec("bash", ["-c", command], {
    env: environment(root, { DPF_FIXTURE_SCRIPT: shellPath, DPF_FIXTURE_PLATFORM: platform,
      DPF_FIXTURE_LAN: "192.0.2.4", DPF_FIXTURE_ROLE: role, ...extra }), timeout: 5000,
  })).stdout.trim();
}

for (const platform of ["Darwin", "Linux"]) {
  test(`${platform}: co-located upkeep follows the canonical origin across LAN changes`, () => fixture(async root => {
    await writeFile(join(root, ".env"), "PUBLIC_URL=https://localhost\n");
    for (const lan of ["192.0.2.4", "198.51.100.9"]) {
      assert.equal(await chooseShell(root, platform, "host-upkeep", { DPF_FIXTURE_LAN: lan }), "https://localhost");
    }
  }));

  test(`${platform}: setup's resolved canonical origin has precedence over saved defaults`, () => fixture(async root => {
    await writeFile(join(root, ".env"), "PUBLIC_URL=https://saved.example.test\n");
    assert.equal(await chooseShell(root, platform, "host-upkeep", {
      DPF_CANONICAL_PUBLIC_URL: "https://configured.example.test:9443",
    }), "https://configured.example.test:9443");
  }));

  test(`${platform}: an explicit Edge authority retains its precedence`, () => fixture(async root => {
    await writeFile(join(root, ".env"), "PUBLIC_URL=https://localhost\n");
    assert.equal(await chooseShell(root, platform, "host-upkeep", {
      DPF_LAN_AUTHORITY_URL: "https://remote.example.test:9443",
    }), "https://remote.example.test:9443");
  }));

  test(`${platform}: full Edge selection keeps its existing LAN behavior`, () => fixture(async root => {
    await writeFile(join(root, ".env"), "PUBLIC_URL=https://localhost\n");
    assert.equal(await chooseShell(root, platform, "full"),
      platform === "Darwin" ? "http://192.0.2.4:3000" : "http://127.0.0.1:3000");
  }));

  test(`${platform}: unconfigured local upkeep uses the existing loopback fallback`, () => fixture(async root => {
    assert.equal(await chooseShell(root, platform, "host-upkeep"), "http://127.0.0.1:3000");
  }));

  test(`${platform}: quoted canonical origins are read without shell evaluation`, () => fixture(async root => {
    await writeFile(join(root, ".env"), 'PUBLIC_URL="https://localhost/"\n');
    assert.equal(await chooseShell(root, platform, "host-upkeep"), "https://localhost");
  }));

  test(`${platform}: malformed canonical origins refuse before installation`, () => fixture(async root => {
    for (const origin of ["https://localhost/not-an-origin", "https://userinfo@example.test", "https://localhost?other=1", "file:///tmp/authority", "https://localhost:0", "https://localhost:65536", " https://localhost"]) {
      await writeFile(join(root, ".env"), `PUBLIC_URL=${origin}\n`);
      await assert.rejects(chooseShell(root, platform, "host-upkeep"), /canonical|origin/i);
    }
  }));
}

const powershell = process.platform === "win32" ? "powershell" : "pwsh";
const hasPowerShell = spawnSync(powershell, ["-NoProfile", "-Command", "exit 0"], { timeout: 5000 }).status === 0;
test("Windows: canonical upkeep and explicit/full Edge boundaries", { skip: !hasPowerShell }, () => fixture(async root => {
  await writeFile(join(root, ".env"), "PUBLIC_URL=https://localhost\n");
  const command = `
$ErrorActionPreference = 'Stop'
. $env:DPF_FIXTURE_SCRIPT
$source = Get-Content -LiteralPath $env:DPF_FIXTURE_SCRIPT -Raw
$start = $source.IndexOf('function Install-DPFNativeEdgeNode {')
$end = $source.IndexOf('    $stateRoot =', $start)
if ($start -lt 0 -or $end -lt $start) { throw 'Missing side-effect boundary' }
Invoke-Expression ($source.Substring($start, $end - $start) + '\n return $AuthorityUrl\n}'.Replace('\n', [Environment]::NewLine))
function Get-NetIPAddress { [pscustomobject]@{ IPAddress = '192.0.2.4'; PrefixOrigin = 'Dhcp' } }
function Write-Warn { param($Message) }
$local = Install-DPFNativeEdgeNode -InstallDir $env:DPF_FIXTURE_REPO -BootstrapToken '' -Role host-upkeep
$explicit = Install-DPFNativeEdgeNode -InstallDir $env:DPF_FIXTURE_REPO -BootstrapToken '' -Role host-upkeep -AuthorityUrl 'https://remote.example.test'
$full = Install-DPFNativeEdgeNode -InstallDir $env:DPF_FIXTURE_REPO -BootstrapToken '' -Role full
@{ local = $local; explicit = $explicit; full = $full } | ConvertTo-Json -Compress
`;
  const result = await exec(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
    env: environment(root, { DPF_FIXTURE_SCRIPT: windowsPath }), timeout: 10000,
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    local: "https://localhost", explicit: "https://remote.example.test", full: "http://192.0.2.4:3000",
  });
}));

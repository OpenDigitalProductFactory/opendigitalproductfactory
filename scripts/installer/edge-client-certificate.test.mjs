import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {resolveGuardBash} from '../lib/guard-bash.mjs';

const subject = 'dpf-edge-localhost';
const stamp = ms => new Date(ms).toISOString().replace(/[-:TZ]/g, '').slice(0, 14) + 'Z';
const powershell = process.env.DPF_TEST_POWERSHELL || (process.platform === 'win32' ? 'powershell' : 'pwsh');
// A PowerShell 7 host exports module paths Windows PowerShell cannot load.
// Let the selected interpreter find its own built-ins for this isolated fixture.
const powershellEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
const hasPowerShell = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {env: powershellEnv, timeout: 10000}).status === 0;

test('PowerShell first issuance retains its checkpoint when rollback cannot remove a partial key', {skip: !hasPowerShell}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dpf-client-rollback-test-'));
  try {
    const source = await readFile(new URL('../bootstrap-organization-pki.ps1', import.meta.url), 'utf8');
    const owner = source.match(/^function Repair-DpfAuthorityEdgeClient \{[\s\S]*?^\}/m)?.[0];
    assert.ok(owner, 'execute the production recovery owner without running the full bootstrap');
    const script = join(dir, 'rollback.ps1');
    await writeFile(script, `param([string]$OutDir, [string]$Failure)
$ErrorActionPreference = 'Stop'
$RepoRoot = $OutDir
$RootCert = Join-Path $OutDir 'root_ca.crt'
$EdgeClientCert = Join-Path $OutDir 'edge-client.crt'
$EdgeClientKey = Join-Path $OutDir 'edge-client.key'
function icacls { $global:LASTEXITCODE = 0 }
function node { $global:LASTEXITCODE = 0; 'issue fixture-root' }
function Invoke-DpfPkiCompose { param($Arguments); 'FIXTURE-TOKEN' }
function Invoke-DpfLocalStepClient {
  param($Arguments)
  if ($Arguments[0] -eq 'ca') {
    [IO.File]::WriteAllText((Join-Path $OutDir $Arguments[3].Substring(6)), 'fixture-certificate')
    [IO.File]::WriteAllText((Join-Path $OutDir $Arguments[4].Substring(6)), 'fixture-key')
  } elseif ($Arguments[1] -eq 'key') { 'fixture-public-key' }
}
function Move-Item {
  [CmdletBinding()]param([string]$LiteralPath, [string]$Destination, [switch]$Force)
  if ($Destination -eq $EdgeClientCert) { throw 'fixture-certificate-publication-failed' }
  Microsoft.PowerShell.Management\\Move-Item @PSBoundParameters
}
function Remove-Item {
  [CmdletBinding()]param([string[]]$LiteralPath, [switch]$Force, [switch]$Recurse)
  if ($Failure -eq 'deletion' -and $LiteralPath -contains $EdgeClientKey) {
    Write-Error 'fixture-sharing-violation'
    return
  }
  Microsoft.PowerShell.Management\\Remove-Item @PSBoundParameters
}
${owner}
$failureMessage = $null
try { Repair-DpfAuthorityEdgeClient -Subject 'dpf-edge-localhost' } catch { $failureMessage = $_.Exception.Message }
@{ failure=$failureMessage; key=(Test-Path -LiteralPath $EdgeClientKey); cert=(Test-Path -LiteralPath $EdgeClientCert);
   lock=(Test-Path -LiteralPath (Join-Path $OutDir '.edge-client-recovery.lock'));
   checkpoints=@(Get-ChildItem -LiteralPath $OutDir -Force -Directory | Where-Object { $_.Name -like '.edge-client-*' -and $_.Name -ne '.edge-client-recovery.lock' }).Count } | ConvertTo-Json -Compress
`);
    for (const failure of ['deletion', 'clean']) {
      const host = join(dir, failure);
      await mkdir(host);
      await writeFile(join(host, 'root_ca.crt'), 'fixture-public-root');
      const child = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', script, host, failure], {env: powershellEnv, encoding: 'utf8', timeout: 15000});
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout.trim());
      assert.equal(result.cert, false);
      if (failure === 'deletion') {
        assert.equal(result.failure, 'edge_client_restoration_unproven');
        assert.equal(result.key, true);
        assert.equal(result.lock, true);
        assert.equal(result.checkpoints, 1);
      } else {
        assert.equal(result.failure, 'fixture-certificate-publication-failed');
        assert.equal(result.key, false);
        assert.equal(result.lock, false);
        assert.equal(result.checkpoints, 0);
      }
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dpf-client-cert-test-'));
  const run = args => execFileSync('openssl', args, {cwd: dir, stdio: ['ignore', 'pipe', 'pipe']});
  await mkdir(join(dir, 'newcerts'));
  await writeFile(join(dir, 'index'), '');
  await writeFile(join(dir, 'serial'), '1000\n');
  await writeFile(join(dir, 'ca.cnf'), `[ca]
default_ca=issuer
[issuer]
database=index
serial=serial
new_certs_dir=newcerts
certificate=root.crt
private_key=root.key
default_md=sha256
policy=identity
unique_subject=no
[identity]
commonName=supplied
[root]
basicConstraints=critical,CA:true
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
[client]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
[server]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
`);
  const key = name => run(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', name + '.key']);
  key('root');
  run(['req', '-new', '-key', 'root.key', '-subj', '/CN=FixtureRoot', '-out', 'root.csr']);
  run(['ca', '-batch', '-selfsign', '-config', 'ca.cnf', '-extensions', 'root', '-startdate', '20200101000000Z',
    '-enddate', '20400101000000Z', '-in', 'root.csr', '-out', 'root.crt', '-notext']);
  const now = Date.now();
  for (const [name, cn, extension, start, end] of [
    ['valid', subject, 'client', now - 86400000, now + 86400000],
    ['expired', subject, 'client', now - 172800000, now - 86400000],
    ['wrong-subject', 'another-node', 'client', now - 86400000, now + 86400000],
    ['wrong-usage', subject, 'server', now - 86400000, now + 86400000],
    ['future', subject, 'client', now + 86400000, now + 172800000],
  ]) {
    key(name);
    run(['req', '-new', '-key', name + '.key', '-subj', '/CN=' + cn, '-out', name + '.csr']);
    run(['ca', '-batch', '-config', 'ca.cnf', '-extensions', extension, '-startdate', stamp(start),
      '-enddate', stamp(end), '-in', name + '.csr', '-out', name + '.crt', '-notext']);
  }
  return {dir, now, rootPem: await readFile(join(dir, 'root.crt')), cert: name => readFile(join(dir, name + '.crt'))};
}

test('authority recovery distinguishes expiry from wrong identity, trust or usage', async () => {
  const f = await fixture();
  try {
    const {inspectEdgeClientCertificate} = await import('./edge-client-certificate.mjs');
    const inspect = async (name, allowExpired = false) => inspectEdgeClientCertificate({
      certificatePem: await f.cert(name), rootPem: f.rootPem, subject, nowMs: f.now, allowExpired,
    });
    assert.equal((await inspect('valid')).disposition, 'renew');
    assert.equal((await inspect('expired', true)).disposition, 'issue');
    await assert.rejects(() => inspect('expired'), /expired/);
    await assert.rejects(() => inspect('wrong-subject', true), /identity/);
    await assert.rejects(() => inspect('wrong-usage', true), /usage/);
    await assert.rejects(() => inspect('future', true), /validity/);
    assert.throws(() => inspectEdgeClientCertificate({certificatePem: f.rootPem, rootPem: f.rootPem, subject, nowMs: f.now}), /identity/);
    const valid = await f.cert('valid');
    assert.throws(() => inspectEdgeClientCertificate({certificatePem: valid, rootPem: valid, subject, nowMs: f.now}), /root/);
    assert.throws(() => inspectEdgeClientCertificate({certificatePem: Buffer.from('invalid'), rootPem: f.rootPem, subject, nowMs: f.now}), /certificate/);
    const other = await fixture();
    try {
      assert.throws(() => inspectEdgeClientCertificate({certificatePem: valid, rootPem: other.rootPem, subject, nowMs: f.now}), /issuer/);
    } finally { await rm(other.dir, {recursive: true, force: true}); }
    const cli = fileURLToPath(new URL('./edge-client-certificate.mjs', import.meta.url));
    const args = certificate => [cli, '--certificate', certificate, '--root', join(f.dir, 'root.crt'), '--subject', subject];
    assert.equal(spawnSync(process.execPath, args(join(f.dir, 'valid.crt')), {encoding: 'utf8'}).status, 0);
    await writeFile(join(f.dir, 'oversized.crt'), Buffer.alloc(65537, 32));
    assert.notEqual(spawnSync(process.execPath, args(join(f.dir, 'oversized.crt')), {encoding: 'utf8'}).status, 0);
    await link(join(f.dir, 'valid.crt'), join(f.dir, 'linked.crt'));
    assert.notEqual(spawnSync(process.execPath, args(join(f.dir, 'linked.crt')), {encoding: 'utf8'}).status, 0);
  } finally { await rm(f.dir, {recursive: true, force: true}); }
});

test('the Bash authority owner stages and verifies recovery without losing the previous pair', async () => {
  const f = await fixture();
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const source = await readFile(join(repo, 'scripts/bootstrap-organization-pki.sh'), 'utf8');
  const owner = source.match(/^repair_authority_edge_client\(\) \{ \([\s\S]*?^\); \}/m)?.[0];
  assert.ok(owner, 'authority recovery owner must be callable without starting the live bootstrap');
  const cases = [
    {name: 'valid', initial: 'valid', replacement: 'valid', expected: 'renew'},
    {name: 'expired', initial: 'expired', replacement: 'valid', expected: 'issue'},
    {name: 'partial-issue', initial: 'expired', replacement: 'valid', failure: 'issue'},
    {name: 'failed-renewal', initial: 'valid', replacement: 'valid', failure: 'renew'},
    {name: 'wrong-subject', initial: 'expired', replacement: 'wrong-subject'},
    {name: 'wrong-usage', initial: 'expired', replacement: 'wrong-usage'},
    {name: 'key-mismatch', initial: 'expired', replacement: 'valid', failure: 'key'},
    {name: 'publish-failure', initial: 'expired', replacement: 'valid', failure: 'publish'},
    {name: 'occupied', initial: 'expired', replacement: 'valid', failure: 'occupied'},
  ];
  try {
    for (const item of cases) {
      const host = join(f.dir, item.name + '-host');
      await mkdir(host, {mode: 0o700});
      await writeFile(join(host, 'root_ca.crt'), f.rootPem, {mode: 0o600});
      const beforeCert = await f.cert(item.initial);
      const beforeKey = await readFile(join(f.dir, item.initial + '.key'));
      await writeFile(join(host, 'edge-client.crt'), beforeCert, {mode: 0o600});
      await writeFile(join(host, 'edge-client.key'), beforeKey, {mode: 0o600});
      if (item.failure === 'occupied') await mkdir(join(host, '.edge-client-recovery.lock'));
      const adapter = `set -eu
OUT_DIR="$1"; REPO_ROOT="$2"; fixture_dir="$3"; replacement="$4"; failure="$5"
ROOT_CERT="$OUT_DIR/root_ca.crt"; EDGE_CLIENT_CERT="$OUT_DIR/edge-client.crt"; EDGE_CLIENT_KEY="$OUT_DIR/edge-client.key"
compose() { printf 'issue\\n' >> "$OUT_DIR/calls"; printf 'FAKE-FIXTURE-TOKEN\\n'; }
run_local_step_client() {
  if [ "$1 $2" = "certificate key" ]; then openssl x509 -in "$OUT_DIR/\${3#/work/}" -pubkey -noout; return; fi
  if [ "$1 $2" = "crypto key" ]; then openssl pkey -in "$OUT_DIR/\${4#/work/}" -pubout; return; fi
  if [ "$1 $2" = "certificate verify" ]; then openssl verify -CAfile "$ROOT_CERT" -purpose sslclient "$OUT_DIR/\${3#/work/}"; return; fi
  if [ "$1 $2" = "ca renew" ]; then
    printf 'renew\\n' >> "$OUT_DIR/calls"
    [ "$failure" != renew ] || return 42
    target_cert="$OUT_DIR/\${3#/work/}"; target_key="$OUT_DIR/\${4#/work/}"
  else
    target_cert="$OUT_DIR/\${4#/work/}"; target_key="$OUT_DIR/\${5#/work/}"
  fi
  command cp "$fixture_dir/$replacement.crt" "$target_cert"
  [ "$failure" != issue ] || return 42
  if [ "$failure" = key ]; then command cp "$fixture_dir/expired.key" "$target_key"
  else command cp "$fixture_dir/$replacement.key" "$target_key"; fi
}
mv() { if [ "$failure" = publish ] && [ "$2" = "$EDGE_CLIENT_CERT" ]; then return 42; fi; command mv "$@"; }
`;
      const child = spawnSync(resolveGuardBash(), ['-c', adapter + '\n' + owner + '\nrepair_authority_edge_client dpf-edge-localhost\n',
        'fixture', ...[host, repo, f.dir].map(path => path.replaceAll('\\', '/')), item.replacement, item.failure ?? ''], {encoding: 'utf8', timeout: 10000});
      if (item.expected) {
        assert.equal(child.status, 0, item.name + ': ' + child.stderr);
        assert.equal((await readFile(join(host, 'calls'), 'utf8')).trim(), item.expected);
        assert.deepEqual(await readFile(join(host, 'edge-client.crt')), await f.cert('valid'));
      } else {
        assert.notEqual(child.status, 0, item.name + ' must fail before selecting a broken identity');
        assert.deepEqual(await readFile(join(host, 'edge-client.crt')), beforeCert, item.name + ': prior certificate');
        assert.deepEqual(await readFile(join(host, 'edge-client.key')), beforeKey, item.name + ': prior key');
      }
      assert.deepEqual(await readFile(join(host, 'root_ca.crt')), f.rootPem, item.name + ': root continuity');
      assert.ok(!child.stdout.includes('PRIVATE KEY') && !child.stderr.includes('PRIVATE KEY'));
    }
  } finally { await rm(f.dir, {recursive: true, force: true}); }
});

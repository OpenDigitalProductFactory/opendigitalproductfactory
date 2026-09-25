import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

/**
 * Can this host represent POSIX permission bits? (BI-C69C13AC)
 *
 * bootstrap-organization-pki.sh requires the join package to be mode 0600 and
 * refuses otherwise — a real control over enrolment material, and not one to
 * weaken so a test passes. Windows has no permission bits: chmod(0o600) reads
 * back as 666, so the script correctly refuses every fixture and the
 * assertions BEYOND that gate never get to run.
 *
 * Those cases are therefore skipped here rather than failed. AGENTS.md §4: a
 * check that could not run is not a verdict, and recording it as one is worse
 * than not running it. Everything that does not depend on file mode still
 * runs on every host.
 */
async function posixModesRepresentable() {
  const probeDir = await mkdtemp(join(tmpdir(), "dpf-mode-probe-"));
  const probe = join(probeDir, "probe");
  try {
    await writeFile(probe, "probe");
    await chmod(probe, 0o600);
    const { mode } = await stat(probe);
    return (mode & 0o777) === 0o600;
  } catch {
    return false;
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }
}

const MODE_GATED = {
  skip: (await posixModesRepresentable())
    ? false
    : "host cannot represent POSIX file modes, so the 0600 join-package gate refuses every fixture before the behaviour under test (BI-C69C13AC)",
};


test("organization PKI compose pins the approved image and protects CA custody", async () => {
  const compose = await read("docker-compose.pki.yml");
  const trust = await read("docker-compose.organization-trust.yml");

  assert.match(
    compose,
    /smallstep\/step-ca:0\.30\.2@sha256:a2b17872915c193259b75a5474c398326f41bd199f0842093e52cf4182bc8270/,
  );
  assert.doesNotMatch(compose, /smallstep\/step-ca:latest/);
  assert.match(compose, /DPF_PKI_PASSWORD_FILE/);
  assert.match(compose, /DOCKER_STEPCA_INIT_PASSWORD_FILE/);
  assert.doesNotMatch(compose, /DOCKER_STEPCA_INIT_PASSWORD:/);
  assert.match(compose, /DPF_PKI_BIND_ADDRESS:-127\.0\.0\.1/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /step_ca_data/);
  assert.doesNotMatch(compose, /NODE_EXTRA_CA_CERTS/);
  assert.doesNotMatch(compose, /\n\s{2}portal:/);
  assert.match(trust, /NODE_EXTRA_CA_CERTS/);
  assert.match(trust, /DPF_PKI_TRUST_BUNDLE/);
  assert.doesNotMatch(trust, /step-ca:/);
});

test("installers consume an organization join package without asking operators to manage PKI", async () => {
  const [shellInstaller, windowsInstaller] = await Promise.all([
    read("install-dpf.sh"),
    read("install-dpf.ps1"),
  ]);

  assert.match(shellInstaller, /--organization-join-package/);
  assert.match(shellInstaller, /Organization join package was not found/);
  assert.match(shellInstaller, /bootstrap-organization-pki\.sh[\s\S]*--mode[\s\S]*join[\s\S]*--no-start-tls/);
  assert.match(windowsInstaller, /OrganizationJoinPackage/);
  assert.match(windowsInstaller, /organization_join_package_not_found/);
  assert.match(windowsInstaller, /bootstrap-organization-pki\.ps1[\s\S]*-Mode[\s\S]*join[\s\S]*-NoStartTls/);
});

test("successful PKI bootstrap persists member trust and Edge actions for normal restart lifecycle", async () => {
  const [shellBootstrap, windowsBootstrap, shellStart, windowsStartScript, windowsComposeChain, windowsInstaller, composeLib] = await Promise.all([
    read("scripts/bootstrap-organization-pki.sh"),
    read("scripts/bootstrap-organization-pki.ps1"),
    read("dpf-start.sh"),
    read("scripts/dpf-start.ps1"),
    read("scripts/installer/lib/compose-chain.ps1"),
    read("install-dpf.ps1"),
    read("scripts/installer/lib/compose.sh"),
  ]);
  // dpf-start.ps1 resolves its chain through Get-DPFComposeArgs, so the overlay
  // names live in compose-chain.ps1; the start script must still route through it.
  assert.match(windowsStartScript, /Get-DPFComposeArgs/);
  const windowsStart = windowsComposeChain;

  for (const source of [shellBootstrap, windowsBootstrap]) {
    assert.match(source, /DPF_ORGANIZATION_TRUST_ENABLED/);
    assert.match(source, /DPF_PKI_TRUST_BUNDLE/);
    assert.match(source, /DPF_TLS_DIR/);
  }
  assert.match(composeLib, /docker-compose\.organization-trust\.yml/);
  assert.match(composeLib, /docker-compose\.tls\.yml/);
  assert.match(composeLib, /DPF_EDGE_ACTION_DISPATCH_CONFIGURED/);
  assert.match(composeLib, /docker-compose\.edge-actions\.yml/);
  assert.match(shellStart, /DPF_ORGANIZATION_TRUST_ENABLED|organization-trust/);
  assert.match(windowsStart, /docker-compose\.organization-trust\.yml/);
  assert.match(windowsStart, /docker-compose\.tls\.yml/);
  assert.match(windowsStart, /DPF_EDGE_ACTION_DISPATCH_CONFIGURED/);
  assert.match(windowsStart, /docker-compose\.edge-actions\.yml/);
  // install-dpf.ps1 also resolves its chain through Get-DPFComposeArgs, so the
  // Edge-actions overlay is wired once in compose-chain.ps1 for both entry points.
  assert.match(windowsInstaller, /Get-DPFComposeArgs|compose-chain\.ps1/);
  assert.match(windowsComposeChain, /DPF_EDGE_ACTION_DISPATCH_CONFIGURED/);
  assert.match(windowsComposeChain, /docker-compose\.edge-actions\.yml/);
});

test("Windows consumer release carries the verified organization-join lifecycle assets", async () => {
  const dockerfile = await read("Dockerfile");

  for (const asset of [
    "docker-compose.pki.yml",
    "docker-compose.organization-trust.yml",
    "docker-compose.tls.yml",
    "docker-compose.edge-actions.yml",
    "scripts/pki/edge-client.tpl",
    "scripts/bootstrap-organization-pki.ps1",
  ]) {
    assert.match(dockerfile, new RegExp(asset.replaceAll(".", "\\.")));
  }
});

test("Bash and PowerShell PKI bootstraps expose the same safe lifecycle", async () => {
  const [shell, powershell] = await Promise.all([
    read("scripts/bootstrap-organization-pki.sh"),
    read("scripts/bootstrap-organization-pki.ps1"),
  ]);

  for (const source of [shell, powershell]) {
    assert.match(source, /authority/i);
    assert.match(source, /issue-join/i);
    assert.match(source, /join/i);
    assert.match(source, /DPF_ORGANIZATION_JOIN_V1/);
    assert.match(source, /expires/i);
    assert.match(source, /intended/i);
    assert.match(source, /fingerprint/i);
    assert.match(source, /root_ca\.crt/);
    assert.match(source, /authority\.crt/);
    assert.match(source, /authority\.key/);
    assert.match(source, /Caddyfile/);
    assert.match(source, /private/i);
    assert.doesNotMatch(source, /insecure|skip.?verify/i);
  }

  assert.match(shell, /Bash 3\.2/);
  assert.match(shell, /chmod 0600/);
  assert.doesNotMatch(shell, /declare -A|mapfile|readarray/);
  assert.match(powershell, /PowerShell 5\.1/);
  assert.doesNotMatch(powershell, /ConvertFrom-Json -AsHashtable|ForEach-Object -Parallel/);
});

test("join packages are short-lived, intended-peer-bound, and never require a CA private key", async () => {
  const [shell, powershell] = await Promise.all([
    read("scripts/bootstrap-organization-pki.sh"),
    read("scripts/bootstrap-organization-pki.ps1"),
  ]);

  for (const source of [shell, powershell]) {
    assert.match(source, /package_id/i);
    assert.match(source, /ca_url/i);
    assert.match(source, /root_fingerprint/i);
    assert.match(source, /intended_hostname/i);
    assert.match(source, /expires_at/i);
    assert.match(source, /enrollment_token/i);
    assert.match(source, /15m|900/);
    assert.doesNotMatch(source, /root_ca\.key[^\n]*(?:package|join)/i);
  }
});

test("Bash join rejects an expired package before Docker is invoked", MODE_GATED, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dpf-join-expired-"));
  const packagePath = join(directory, "expired.dpfjoin");
  const script = fileURLToPath(new URL("../bootstrap-organization-pki.sh", import.meta.url));

  try {
    await writeFile(packagePath, [
      "DPF_ORGANIZATION_JOIN_V1",
      "package_id=0123456789abcdef0123456789abcdef",
      "ca_url=https://192.168.0.10:9000",
      `root_fingerprint=${"a".repeat(64)}`,
      "intended_hostname=peer.local",
      "intended_sans=192.168.0.20",
      "expires_at=1",
      "enrollment_token=fixture-enrollment-token-expired",
      "",
    ].join("\n"), { mode: 0o600 });
    await chmod(packagePath, 0o600);

    const result = spawnSync("bash", [script, "--mode", "join", "--hostname", "peer.local", "--join-package", packagePath], { encoding: "utf8" });
    assert.equal(result.status, 77);
    assert.match(result.stderr, /expired/i);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Docker is required/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Bash join rejects a package intended for a different installation", MODE_GATED, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dpf-join-peer-"));
  const packagePath = join(directory, "wrong-peer.dpfjoin");
  const script = fileURLToPath(new URL("../bootstrap-organization-pki.sh", import.meta.url));

  try {
    await writeFile(packagePath, [
      "DPF_ORGANIZATION_JOIN_V1",
      "package_id=0123456789abcdef0123456789abcdef",
      "ca_url=https://192.168.0.10:9000",
      `root_fingerprint=${"a".repeat(64)}`,
      "intended_hostname=other.local",
      "intended_sans=192.168.0.20",
      `expires_at=${Math.floor(Date.now() / 1000) + 900}`,
      "enrollment_token=fixture-enrollment-token-wrong-peer",
      "",
    ].join("\n"), { mode: 0o600 });
    await chmod(packagePath, 0o600);

    const result = spawnSync("bash", [script, "--mode", "join", "--hostname", "peer.local", "--join-package", packagePath], { encoding: "utf8" });
    assert.equal(result.status, 77);
    assert.match(result.stderr, /intended for another installation/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Bash join rejects a public CA origin before Docker is invoked", MODE_GATED, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dpf-join-public-ca-"));
  const packagePath = join(directory, "public-ca.dpfjoin");
  const script = fileURLToPath(new URL("../bootstrap-organization-pki.sh", import.meta.url));

  try {
    await writeFile(packagePath, [
      "DPF_ORGANIZATION_JOIN_V1",
      "package_id=0123456789abcdef0123456789abcdef",
      "ca_url=https://example.com:9000",
      `root_fingerprint=${"a".repeat(64)}`,
      "intended_hostname=peer.local",
      "intended_sans=192.168.0.20",
      `expires_at=${Math.floor(Date.now() / 1000) + 900}`,
      "enrollment_token=fixture-enrollment-token-public-ca",
      "",
    ].join("\n"), { mode: 0o600 });
    await chmod(packagePath, 0o600);

    const result = spawnSync("bash", [script, "--mode", "join", "--join-package", packagePath], { encoding: "utf8" });
    assert.equal(result.status, 77);
    assert.match(result.stderr, /private or local/i);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Docker is required/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PKI bootstrap refuses silent CA replacement and never prints enrollment secrets", async () => {
  const [shell, powershell] = await Promise.all([
    read("scripts/bootstrap-organization-pki.sh"),
    read("scripts/bootstrap-organization-pki.ps1"),
  ]);

  assert.match(shell, /refus|already exists|reuse/i);
  assert.match(powershell, /refus|already exists|reuse/i);
  assert.doesNotMatch(shell, /echo[^\n]*(?:\$token|\$PASSWORD_FILE)/i);
  assert.doesNotMatch(
    powershell,
    /Write-(?:Host|Output)[^\n]*(?:\$enrollmentToken|\$PasswordFile)/i,
  );
});

test("the organization CA server certificate includes operator-supplied private SANs", async () => {
  const [shell, powershell] = await Promise.all([
    read("scripts/bootstrap-organization-pki.sh"),
    read("scripts/bootstrap-organization-pki.ps1"),
  ]);

  assert.match(shell, /DPF_PKI_DNS_NAMES="\$HOSTNAME_VALUE,\$SANS,/);
  assert.match(powershell, /DPF_PKI_DNS_NAMES[^\n]*\$San/);
});

test("Edge action PKI uses a dedicated client-auth profile and host-owned keys", async () => {
  const [shell, powershell, compose, template] = await Promise.all([
    read("scripts/bootstrap-organization-pki.sh"),
    read("scripts/bootstrap-organization-pki.ps1"),
    read("docker-compose.pki.yml"),
    read("scripts/pki/edge-client.tpl"),
  ]);

  assert.match(template, /clientAuth/);
  assert.doesNotMatch(template, /serverAuth/);
  assert.match(compose, /edge-client\.tpl/);
  for (const source of [shell, powershell]) {
    assert.match(source, /dpf-edge-client/);
    assert.match(source, /--x509-template/);
    assert.match(source, /--x509-max-dur["']?,?[\s\S]*720h/);
    assert.match(source, /edge-client\.crt/);
    assert.match(source, /edge-client\.key/);
    assert.match(source, /edge-action-signing-public\.pem/);
    assert.match(source, /edge-action-signing-private\.pem/);
    assert.match(source, /DPF_ORGANIZATION_JOIN_V2/);
    assert.match(source, /--network["']?,?\s*["']?container:/);
    assert.doesNotMatch(source, /--ca-url["']?,?\s*["']https:\/\/step-ca:9000/);
  }
});

test("Caddy exposes a dedicated verified-client action listener and strips spoofable identity", async () => {
  const [shell, powershell, tlsCompose, actionCompose] = await Promise.all([
    read("scripts/bootstrap-organization-pki.sh"),
    read("scripts/bootstrap-organization-pki.ps1"),
    read("docker-compose.tls.yml"),
    read("docker-compose.edge-actions.yml"),
  ]);
  for (const source of [shell, powershell]) {
    assert.match(source, /:8443/);
    assert.match(source, /require_and_verify/);
    assert.match(source, /trust_pool file/);
    assert.match(source, /header_up -X-DPF-Edge-Cert/);
    assert.match(source, /tls_client_fingerprint/);
    assert.match(source, /tls_client_certificate_der_base64/);
  }
  assert.match(tlsCompose, /DPF_EDGE_ACTION_HTTPS_PORT:-8443/);
  assert.match(tlsCompose, /caddy:2\.10\.2-alpine@sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(tlsCompose, /image:\s+caddy:2-alpine/);
  assert.match(actionCompose, /DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE/);
  assert.match(actionCompose, /DPF_EDGE_MTLS_PROXY_SECRET_FILE/);
});

test("Bash bootstrap rejects public binds and argument injection before Docker", () => {
  const script = fileURLToPath(new URL("../bootstrap-organization-pki.sh", import.meta.url));
  const publicBind = spawnSync("bash", [script, "--hostname", "dpf.local", "--bind-address", "8.8.8.8"], { encoding: "utf8" });
  assert.equal(publicBind.status, 64);
  assert.match(publicBind.stderr, /private IPv4/i);

  const injected = spawnSync("bash", [script, "--hostname", "dpf.local;touch-bad"], { encoding: "utf8" });
  assert.equal(injected.status, 64);
  assert.match(injected.stderr, /unsupported characters/i);
});

// BI-6DC1CD5B: canonical https on every install (design §12).
function stepTokenCommands(source) {
  const commands = [];
  const bash = /step ca token[\s\S]*?\)"/g;
  const powershell = /"step", "ca", "token"[^\n]*/g;
  for (const match of source.matchAll(bash)) commands.push(match[0]);
  for (const match of source.matchAll(powershell)) commands.push(match[0]);
  return commands;
}

test("every organization-CA enrollment token names the local CA explicitly (BI-6DC1CD5B)", async () => {
  // Without --ca-url, `step ca token` falls back to the CA's defaults.json,
  // which carries the name the CA was FIRST initialised under. On DEV that was
  // an unresolvable host, and every token request failed (no such host).
  for (const path of ["scripts/bootstrap-organization-pki.sh", "scripts/bootstrap-organization-pki.ps1"]) {
    const commands = stepTokenCommands(await read(path));
    assert.ok(commands.length >= 4, `${path}: expected the portal, edge and join token requests`);
    for (const command of commands) {
      assert.match(command, /--ca-url"?,? "?https:\/\/127\.0\.0\.1:9000/, `${path}: token request without --ca-url: ${command.slice(0, 120)}`);
    }
  }
});

test("the PKI bootstrap composes with the install's own file set, never a source build (BI-6DC1CD5B)", async () => {
  // A consumer install ships docker-compose.release.yml and no Dockerfile.
  // Composing without the release overlay made `up portal portal-tls` try to
  // BUILD portal-init ("open Dockerfile: no such file or directory").
  for (const path of ["scripts/bootstrap-organization-pki.sh", "scripts/bootstrap-organization-pki.ps1"]) {
    const source = await read(path);
    assert.match(source, /docker-compose\.release\.yml/, `${path}: release overlay never considered`);
    assert.match(source, /Dockerfile/, `${path}: release install not detected by the absence of a build context`);
  }
});

test("a changed certificate name set reissues the portal leaf instead of renewing old names (BI-6DC1CD5B)", async () => {
  // `step ca renew` keeps the subject alternative names of the old leaf, so
  // adding a canonical host or alias would otherwise never reach the certificate.
  const [shell, powershell] = await Promise.all([
    read("scripts/bootstrap-organization-pki.sh"),
    read("scripts/bootstrap-organization-pki.ps1"),
  ]);
  const shellReissue = shell.match(/portal_leaf_needs_reissue\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const powershellReissue = powershell.match(/function Test-DpfPortalLeafNeedsReissue \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(shellReissue, /subjectAltName/, "bash reissue check ignores the certificate names");
  assert.match(powershellReissue, /subject_alt_name|dns_names/, "PowerShell reissue check ignores the certificate names");
});

test("portal-tls publishes its ports through the install bind address (BI-6DC1CD5B)", async () => {
  const tlsCompose = await read("docker-compose.tls.yml");
  for (const port of ["DPF_TLS_HTTP_PORT:-80", "DPF_TLS_HTTPS_PORT:-443", "DPF_EDGE_ACTION_HTTPS_PORT:-8443"]) {
    assert.ok(
      tlsCompose.includes(`"\${DPF_HOST_BIND_ADDRESS:-127.0.0.1}:\${${port}}`),
      `docker-compose.tls.yml publishes ${port} on every interface`,
    );
  }
});

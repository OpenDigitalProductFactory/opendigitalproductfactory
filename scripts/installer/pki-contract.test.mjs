import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("organization PKI compose pins the approved image and protects CA custody", async () => {
  const compose = await read("docker-compose.pki.yml");

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
  assert.match(compose, /NODE_EXTRA_CA_CERTS/);
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

test("Bash join rejects an expired package before Docker is invoked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dpf-join-expired-"));
  const packagePath = join(directory, "expired.dpfjoin");
  const script = new URL("../bootstrap-organization-pki.sh", import.meta.url).pathname;

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

test("Bash join rejects a package intended for a different installation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dpf-join-peer-"));
  const packagePath = join(directory, "wrong-peer.dpfjoin");
  const script = new URL("../bootstrap-organization-pki.sh", import.meta.url).pathname;

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

test("Bash join rejects a public CA origin before Docker is invoked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dpf-join-public-ca-"));
  const packagePath = join(directory, "public-ca.dpfjoin");
  const script = new URL("../bootstrap-organization-pki.sh", import.meta.url).pathname;

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

test("Bash bootstrap rejects public binds and argument injection before Docker", () => {
  const script = new URL("../bootstrap-organization-pki.sh", import.meta.url).pathname;
  const publicBind = spawnSync("bash", [script, "--hostname", "dpf.local", "--bind-address", "8.8.8.8"], { encoding: "utf8" });
  assert.equal(publicBind.status, 64);
  assert.match(publicBind.stderr, /private IPv4/i);

  const injected = spawnSync("bash", [script, "--hostname", "dpf.local;touch-bad"], { encoding: "utf8" });
  assert.equal(injected.status, 64);
  assert.match(injected.stderr, /unsupported characters/i);
});

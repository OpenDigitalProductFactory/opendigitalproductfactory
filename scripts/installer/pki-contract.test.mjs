import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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
    assert.match(source, /join/i);
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

test("Bash bootstrap rejects public binds and argument injection before Docker", () => {
  const script = new URL("../bootstrap-organization-pki.sh", import.meta.url).pathname;
  const publicBind = spawnSync("bash", [script, "--hostname", "dpf.local", "--bind-address", "8.8.8.8"], { encoding: "utf8" });
  assert.equal(publicBind.status, 64);
  assert.match(publicBind.stderr, /private IPv4/i);

  const injected = spawnSync("bash", [script, "--hostname", "dpf.local;touch-bad"], { encoding: "utf8" });
  assert.equal(injected.status, 64);
  assert.match(injected.stderr, /unsupported characters/i);
});

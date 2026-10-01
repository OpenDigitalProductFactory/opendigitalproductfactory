// Canonical install origin resolver (BI-6DC1CD5B, design section 12.4.1).
//
// Runs the PowerShell resolver itself, with injected name lookups, so the
// choice order is proven by behaviour rather than by reading the source.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = join(root, "scripts/installer/lib/canonical-origin.ps1");

function powershellHost() {
  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}
const shell = powershellHost();
const NEEDS_POWERSHELL = { skip: shell ? false : "no PowerShell host on this machine; the resolver cannot run" };

function resolve({ env = "", args = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-canonical-"));
  try {
    if (env) writeFileSync(join(dir, ".env"), env);
    const script = `. '${lib.replaceAll("'", "''")}'; Resolve-DpfCanonicalOrigin -InstallDir '${dir.replaceAll("'", "''")}' ${args} | ConvertTo-Json -Compress`;
    const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
    if (result.status !== 0) return { error: `${result.stderr}${result.stdout}` };
    return JSON.parse(result.stdout.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const resolvesHere = "-ResolvesHere { param($n) $true }";
const resolvesNowhere = "-ResolvesHere { param($n) $false }";

test("an explicit operator name wins over everything", NEEDS_POWERSHELL, () => {
  const out = resolve({ env: "DPF_HOST_BIND_ADDRESS=0.0.0.0\nPUBLIC_URL=https://old.example\n", args: `-ExplicitHost Portal.Example.Lan -MachineDnsName desk.lan ${resolvesHere}` });
  assert.equal(out.Host, "portal.example.lan");
  assert.equal(out.Source, "explicit");
  assert.equal(out.PublicUrl, "https://portal.example.lan");
  assert.equal(out.McpUrl, "https://portal.example.lan/api/mcp/v1?tier=full");
});

test("an existing https PUBLIC_URL is kept on re-run and upgrade", NEEDS_POWERSHELL, () => {
  const out = resolve({ env: "DPF_HOST_BIND_ADDRESS=0.0.0.0\nPUBLIC_URL=\"https://dpf.corp.example\"\n", args: `-MachineDnsName desk.lan ${resolvesHere}` });
  assert.equal(out.Host, "dpf.corp.example");
  assert.equal(out.Source, "existing-public-url");
});

test("an http PUBLIC_URL is not canonical: OAuth needs https", NEEDS_POWERSHELL, () => {
  const out = resolve({ env: "DPF_HOST_BIND_ADDRESS=127.0.0.1\nPUBLIC_URL=http://192.168.1.5:3000\n", args: resolvesNowhere });
  assert.equal(out.Host, "localhost");
  assert.equal(out.Source, "loopback-bind");
});

test("a loopback-bound install is canonical at localhost even with a resolvable machine name", NEEDS_POWERSHELL, () => {
  const out = resolve({ env: "DPF_HOST_BIND_ADDRESS=127.0.0.1\n", args: `-MachineDnsName desk.lan ${resolvesHere}` });
  assert.equal(out.Host, "localhost");
  assert.equal(out.Source, "loopback-bind");
  assert.deepEqual([...out.CertificateSans].sort(), ["127.0.0.1"]);
});

test("a network-served install uses its machine DNS name when the network resolves it here", NEEDS_POWERSHELL, () => {
  const out = resolve({ env: "DPF_HOST_BIND_ADDRESS=0.0.0.0\n", args: `-MachineDnsName desk.lan ${resolvesHere}` });
  assert.equal(out.Host, "desk.lan");
  assert.equal(out.Source, "machine-dns-name");
  assert.deepEqual([...out.CertificateSans].sort(), ["127.0.0.1", "localhost"]);
});

test("a network-served install without a resolvable name falls back to localhost and says why", NEEDS_POWERSHELL, () => {
  const out = resolve({ env: "DPF_HOST_BIND_ADDRESS=0.0.0.0\n", args: `-MachineDnsName desk.lan ${resolvesNowhere}` });
  assert.equal(out.Host, "localhost");
  assert.equal(out.Source, "no-network-name");
});

test("a host name outside the DNS alphabet is refused", NEEDS_POWERSHELL, () => {
  const out = resolve({ args: "-ExplicitHost 'bad host;rm'" });
  assert.match(out.error ?? "", /canonical_host_invalid/);
});

// The bash twin (install-dpf.sh on macOS/Linux) must make the same choice.
const bashLib = join(root, "scripts/installer/lib/canonical-origin.sh");
const hasBash = spawnSync("bash", ["-c", "true"]).status === 0;
const NEEDS_BASH = { skip: hasBash ? false : "no bash on this machine" };

function resolveBash({ env = "", explicit = "", machine = "desk.lan", resolvesHere } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-canonical-sh-"));
  try {
    if (env) writeFileSync(join(dir, ".env"), env);
    const script = `. "$LIB"; dpf_resolve_canonical_origin "$DIR" "$EXPLICIT" || exit $?; printf '%s|%s|%s|%s' "$DPF_CANONICAL_HOST" "$DPF_CANONICAL_SOURCE" "$DPF_CANONICAL_CERT_SANS" "$DPF_CANONICAL_MCP_URL"`;
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env, LIB: bashLib.replaceAll("\\", "/"), DIR: dir.replaceAll("\\", "/"), EXPLICIT: explicit,
        DPF_CANONICAL_MACHINE_DNS_NAME: machine, DPF_CANONICAL_RESOLVES_HERE: resolvesHere ? "1" : "0",
        DPF_HOST_BIND_ADDRESS: "",
      },
    });
    if (result.status !== 0) return { error: result.stderr };
    const [host, source, sans, mcp] = result.stdout.split("|");
    return { host, source, sans, mcp };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("bash twin: explicit name wins", NEEDS_BASH, () => {
  const out = resolveBash({ env: "DPF_HOST_BIND_ADDRESS=0.0.0.0\n", explicit: "Portal.Example.Lan", resolvesHere: true });
  assert.equal(out.host, "portal.example.lan");
  assert.equal(out.source, "explicit");
  assert.equal(out.mcp, "https://portal.example.lan/api/mcp/v1?tier=full");
});

test("bash twin: existing https PUBLIC_URL is kept; http is not canonical", NEEDS_BASH, () => {
  assert.equal(resolveBash({ env: "DPF_HOST_BIND_ADDRESS=0.0.0.0\nPUBLIC_URL=https://dpf.corp.example/\n", resolvesHere: true }).host, "dpf.corp.example");
  assert.equal(resolveBash({ env: "DPF_HOST_BIND_ADDRESS=127.0.0.1\nPUBLIC_URL=http://192.168.1.5:3000\n" }).source, "loopback-bind");
});

test("bash twin: loopback bind, resolvable machine name, and fallback", NEEDS_BASH, () => {
  assert.equal(resolveBash({ env: "DPF_HOST_BIND_ADDRESS=127.0.0.1\n", resolvesHere: true }).host, "localhost");
  const named = resolveBash({ env: "DPF_HOST_BIND_ADDRESS=0.0.0.0\n", resolvesHere: true });
  assert.equal(named.host, "desk.lan");
  assert.equal(named.sans, "localhost,127.0.0.1");
  assert.equal(resolveBash({ env: "DPF_HOST_BIND_ADDRESS=0.0.0.0\n", resolvesHere: false }).source, "no-network-name");
});

test("bash twin: invalid host refused", NEEDS_BASH, () => {
  assert.match(resolveBash({ explicit: "bad host;rm" }).error ?? "", /canonical_host_invalid/);
});

// Machine trust for the install's own CA (BI-2D545A0C AC-1).
const trustLib = join(root, "scripts/installer/lib/machine-trust.ps1");
const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
const NEEDS_TRUST_TOOLS = { skip: shell && hasOpenssl ? false : "needs PowerShell and openssl to mint a fixture root" };

function withFixtureRoot(run) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-trust-"));
  try {
    const cert = join(dir, "root_ca.crt");
    const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"),
      "-out", cert, "-days", "1", "-subj", "/CN=dpf-fixture-root"], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    return run(cert);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function installTrust(cert, { trustedBefore, addExit, trustedAfter }) {
  // $script:added records whether the store write ran; the fake store flips to
  // trusted only after a successful add when trustedAfter is set.
  const script = `. '${trustLib.replaceAll("'", "''")}'; $script:added = $false;
    $result = Install-DpfRootTrust -RootCertificatePath '${cert.replaceAll("'", "''")}' \`
      -IsTrusted { param($t) if ($script:added) { $${trustedAfter} } else { $${trustedBefore} } } \`
      -AddToStore { param($p) $script:added = $true; ${addExit} };
    "$result|$($script:added)"`;
  const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const [outcome, added] = result.stdout.trim().split("|");
  return { outcome, added: added === "True" };
}

test("a root already trusted is not added again (no second OS prompt)", NEEDS_TRUST_TOOLS, () => {
  withFixtureRoot((cert) => {
    assert.deepEqual(installTrust(cert, { trustedBefore: "true", addExit: 0, trustedAfter: "true" }), { outcome: "already-trusted", added: false });
  });
});

test("an untrusted root is added once and verified in the store", NEEDS_TRUST_TOOLS, () => {
  withFixtureRoot((cert) => {
    assert.deepEqual(installTrust(cert, { trustedBefore: "false", addExit: 0, trustedAfter: "true" }), { outcome: "trusted", added: true });
  });
});

test("a declined OS prompt is reported, not thrown", NEEDS_TRUST_TOOLS, () => {
  withFixtureRoot((cert) => {
    assert.deepEqual(installTrust(cert, { trustedBefore: "false", addExit: 1, trustedAfter: "false" }), { outcome: "declined", added: true });
    // certutil can exit 0 and still leave the store unchanged (dialog dismissed).
    assert.deepEqual(installTrust(cert, { trustedBefore: "false", addExit: 0, trustedAfter: "false" }), { outcome: "declined", added: true });
  });
});

test("bash trust helper refuses a missing root and declines on an unknown platform", NEEDS_BASH, () => {
  const lib = join(root, "scripts/installer/lib/machine-trust.sh").replaceAll("\\", "/");
  const missing = spawnSync("bash", ["-c", `. "${lib}"; dpf_install_root_trust /nonexistent/root.crt`], { encoding: "utf8" });
  assert.equal(missing.status, 66);
  if (hasOpenssl) {
    withFixtureRoot((cert) => {
      const other = spawnSync("bash", ["-c", `. "${lib}"; dpf_install_root_trust "$ROOT"`], {
        encoding: "utf8", env: { ...process.env, ROOT: cert.replaceAll("\\", "/"), DPF_TRUST_PLATFORM: "Plan9" },
      });
      assert.equal(other.stdout.trim(), "declined");
    });
  }
});

// Installer wiring (BI-6DC1CD5B AC-1): every install is https at its canonical
// origin, not only an install that joins an organization.
test("the Windows installer makes a standalone install https at its canonical origin", () => {
  const installer = readFileSync(join(root, "install-dpf.ps1"), "utf8");
  assert.match(installer, /scripts\\installer\\lib"/);
  assert.match(installer, /"canonical-origin\.ps1"/);
  assert.match(installer, /"machine-trust\.ps1"/);
  assert.match(installer, /Resolve-DpfCanonicalOrigin/);
  assert.match(installer, /-Mode authority[^\n]*-Hostname \$[a-zA-Z.]+Host[^\n]*-San/);
  assert.match(installer, /Set-DpfEnvValue[^\n]*PUBLIC_URL/);
  assert.match(installer, /Install-DpfRootTrust/);
  const finalStep = installer.slice(installer.indexOf('Write-Step 10 10'));
  assert.match(finalStep, /Start-Process \$script:DpfPortalUrl/);
  // http://localhost:3000 survives only as the fallback when HTTPS setup failed.
  assert.doesNotMatch(finalStep, /Start-Process "http:\/\/localhost:3000"/);
  assert.doesNotMatch(finalStep, /URL:\s+http:\/\/localhost:3000/);
});

test("the macOS/Linux installer makes a standalone install https at its canonical origin", () => {
  const installer = readFileSync(join(root, "install-dpf.sh"), "utf8");
  assert.match(installer, /lib\/canonical-origin\.sh/);
  assert.match(installer, /lib\/machine-trust\.sh/);
  assert.match(installer, /dpf_resolve_canonical_origin/);
  assert.match(installer, /--mode authority[\s\S]{0,200}--hostname "\$DPF_CANONICAL_HOST"/);
  assert.match(installer, /dpf_set_env_value[^\n]*PUBLIC_URL/);
  assert.match(installer, /dpf_install_root_trust/);
});

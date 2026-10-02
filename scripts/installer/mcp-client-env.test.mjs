// Machine trust and persisted MCP endpoint (BI-2D545A0C, design section 12.4.3).
//
// Setup makes the install's own machine know its MCP address and trust its CA:
// DPF_MCP_URL = <PUBLIC_URL>/api/mcp/v1?tier=full and NODE_EXTRA_CA_CERTS are
// persisted for the installing user, and the root goes into the OS trust store
// once. Every case runs the real shell libraries in a TEMPORARY home with a
// FAKE trust store / launchctl / user environment, so the operator's keychain,
// certificate store, ~/.dpf and client configs are never touched.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const posix = (path) => path.replaceAll("\\", "/");
const envLib = posix(join(root, "scripts/installer/lib/mcp-client-env.sh"));
const trustLib = posix(join(root, "scripts/installer/lib/machine-trust.sh"));
const envLibPs = join(root, "scripts/installer/lib/mcp-client-env.ps1");

const hasBash = spawnSync("bash", ["-c", "true"]).status === 0;
const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
const NEEDS_BASH = { skip: hasBash ? false : "no bash on this machine" };
const NEEDS_TRUST_TOOLS = { skip: hasBash && hasOpenssl ? false : "needs bash and openssl to mint a fixture root" };

function powershellHost() {
  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}
const shell = powershellHost();
const NEEDS_POWERSHELL = { skip: shell ? false : "no PowerShell host on this machine; the Windows twin cannot run" };

// A temporary home plus an install directory inside it.
function withHome(run) {
  const home = mkdtempSync(join(tmpdir(), "dpf-client-env-"));
  const install = join(home, "install");
  mkdirSync(install);
  try {
    return run({ home, install });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function bash(script, { home, env = {} }) {
  return spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH, HOME: posix(home), ENV_LIB: envLib, TRUST_LIB: trustLib,
      // Never inherit the operator's own client environment into a test.
      DPF_MCP_URL: "", DPF_PKI_TRUST_BUNDLE: "", NODE_EXTRA_CA_CERTS: "",
      ...env,
    },
  });
}

function writeRoot(home) {
  const pki = join(home, ".dpf", "pki");
  mkdirSync(pki, { recursive: true });
  const cert = join(pki, "root_ca.crt");
  writeFileSync(cert, "fixture root\n");
  return cert;
}

// A fake launchctl that records each call in the temporary home.
function fakeLaunchctl(home) {
  const bin = join(home, "fake-launchctl");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${posix(home)}/launchctl.log"\n`);
  chmodSync(bin, 0o755);
  return posix(bin);
}

const resolveScript = `. "$ENV_LIB"; dpf_resolve_mcp_client_env "$INSTALL" || exit $?; printf '%s|%s' "$DPF_MCP_CLIENT_URL" "$DPF_MCP_CLIENT_CA_BUNDLE"`;

test("the endpoint is <PUBLIC_URL>/api/mcp/v1?tier=full from the install .env, not a pre-set DPF_MCP_URL", NEEDS_BASH, () => {
  withHome(({ home, install }) => {
    const cert = writeRoot(home);
    writeFileSync(join(install, ".env"), 'PUBLIC_URL="https://desk.lan/"\n');
    // A stale http endpoint from an earlier setup must not survive the canonical origin.
    const out = bash(resolveScript, { home, env: { INSTALL: posix(install), DPF_MCP_URL: "http://127.0.0.1:3000/api/mcp/v1" } });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, `https://desk.lan/api/mcp/v1?tier=full|${posix(cert)}`);
  });
});

test("the CA bundle follows DPF_PKI_TRUST_BUNDLE in the install .env before the default PKI dir", NEEDS_BASH, () => {
  withHome(({ home, install }) => {
    writeRoot(home);
    const orgBundle = join(home, "org-bundle.pem");
    writeFileSync(orgBundle, "org bundle\n");
    writeFileSync(join(install, ".env"), `PUBLIC_URL=https://localhost\nDPF_PKI_TRUST_BUNDLE=${posix(orgBundle)}\n`);
    const out = bash(resolveScript, { home, env: { INSTALL: posix(install) } });
    assert.equal(out.stdout, `https://localhost/api/mcp/v1?tier=full|${posix(orgBundle)}`);
  });
});

test("without an https PUBLIC_URL the explicit DPF_MCP_URL stands, and an http endpoint carries no bundle", NEEDS_BASH, () => {
  withHome(({ home, install }) => {
    writeRoot(home);
    writeFileSync(join(install, ".env"), "PUBLIC_URL=http://192.168.1.5:3000\n");
    const http = bash(resolveScript, { home, env: { INSTALL: posix(install), DPF_MCP_URL: "http://127.0.0.1:3000/api/mcp/v1" } });
    assert.equal(http.stdout, "http://127.0.0.1:3000/api/mcp/v1|");
    const none = bash(resolveScript, { home, env: { INSTALL: posix(install) } });
    assert.equal(none.stdout, "|");
  });
});

const persistScript = `. "$ENV_LIB"; dpf_resolve_mcp_client_env "$INSTALL"; dpf_persist_mcp_client_env; echo "rc=$?"`;

test("macOS: both variables land in ~/.dpf/agent-toolchain.env and launchd; a rerun changes nothing", NEEDS_BASH, () => {
  withHome(({ home, install }) => {
    const cert = writeRoot(home);
    writeFileSync(join(install, ".env"), "PUBLIC_URL=https://desk.lan\n");
    // An earlier token line is kept: the transport writer owns only its own lines.
    mkdirSync(join(home, ".dpf"), { recursive: true });
    writeFileSync(join(home, ".dpf", "agent-toolchain.env"), "# managed\nexport DPF_MCP_BEARER_TOKEN='dpfmcp_fixture'\nexport DPF_MCP_URL='http://127.0.0.1:3000/api/mcp/v1'\n");
    const env = { INSTALL: posix(install), DPF_CLIENT_ENV_PLATFORM: "Darwin", DPF_LAUNCHCTL: fakeLaunchctl(home) };

    const first = bash(persistScript, { home, env });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /rc=0/);
    const file = readFileSync(join(home, ".dpf", "agent-toolchain.env"), "utf8");
    assert.match(file, /^export DPF_MCP_BEARER_TOKEN='dpfmcp_fixture'$/m);
    assert.match(file, /^export DPF_MCP_URL='https:\/\/desk\.lan\/api\/mcp\/v1\?tier=full'$/m);
    assert.match(file, new RegExp(`^export NODE_EXTRA_CA_CERTS='${posix(cert).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'$`, "m"));
    assert.equal((file.match(/^export DPF_MCP_URL=/gm) ?? []).length, 1, "the stale endpoint is replaced, not duplicated");
    for (const profile of [".zshenv", ".profile"]) {
      assert.match(readFileSync(join(home, profile), "utf8"), /agent-toolchain\.env.*# dpf-mcp-token/);
    }
    const log = readFileSync(join(home, "launchctl.log"), "utf8");
    assert.match(log, /^setenv DPF_MCP_URL https:\/\/desk\.lan\/api\/mcp\/v1\?tier=full$/m);
    assert.match(log, /^setenv NODE_EXTRA_CA_CERTS /m);

    const second = bash(persistScript, { home, env });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(join(home, ".dpf", "agent-toolchain.env"), "utf8"), file, "idempotent env file");
    for (const profile of [".zshenv", ".profile"]) {
      assert.equal((readFileSync(join(home, profile), "utf8").match(/dpf-mcp-token/g) ?? []).length, 1, `one source line in ${profile}`);
    }
  });
});

test("Linux: the profile env carries both variables and launchd is never called", NEEDS_BASH, () => {
  withHome(({ home, install }) => {
    writeRoot(home);
    writeFileSync(join(install, ".env"), "PUBLIC_URL=https://localhost\n");
    const env = { INSTALL: posix(install), DPF_CLIENT_ENV_PLATFORM: "Linux", DPF_LAUNCHCTL: fakeLaunchctl(home) };
    const out = bash(persistScript, { home, env });
    assert.equal(out.status, 0, out.stderr);
    const sourced = bash(`. "$HOME/.profile"; printf '%s|%s' "$DPF_MCP_URL" "$NODE_EXTRA_CA_CERTS"`, { home });
    assert.equal(sourced.stdout, `https://localhost/api/mcp/v1?tier=full|${posix(join(home, ".dpf", "pki", "root_ca.crt"))}`);
    assert.equal(existsSync(join(home, "launchctl.log")), false);
  });
});

test("an install without an https origin persists nothing", NEEDS_BASH, () => {
  withHome(({ home, install }) => {
    writeFileSync(join(install, ".env"), "PUBLIC_URL=http://localhost:3000\n");
    const out = bash(persistScript, { home, env: { INSTALL: posix(install), DPF_CLIENT_ENV_PLATFORM: "Linux" } });
    assert.match(out.stdout, /rc=1/);
    assert.equal(existsSync(join(home, ".dpf", "agent-toolchain.env")), false);
    assert.equal(existsSync(join(home, ".profile")), false);
  });
});

// --- Machine trust store, fake adapter per OS (AC-1, AC-4) ---------------------

function withFixtureRoot(home) {
  const cert = join(home, "root_ca.crt");
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(home, "k.pem"),
    "-out", cert, "-days", "1", "-subj", "/CN=dpf-fixture-root"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  return posix(cert);
}

test("macOS trust: the root is added to the keychain once, never twice", NEEDS_TRUST_TOOLS, () => {
  withHome(({ home }) => {
    const cert = withFixtureRoot(home);
    // Fake `security`: the keychain is a file of SHA-256 hashes.
    const store = posix(join(home, "keychain.txt"));
    const fake = join(home, "fake-security");
    writeFileSync(fake, `#!/bin/sh
case "$1" in
  find-certificate) [ -f "${store}" ] && sed 's/^/SHA-256 hash: /' "${store}"; exit 0 ;;
  add-trusted-cert) for last; do :; done
    openssl x509 -in "$last" -noout -fingerprint -sha256 | sed 's/^.*=//; s/://g' >> "${store}"; exit 0 ;;
esac
exit 2
`);
    chmodSync(fake, 0o755);
    const env = { ROOT: cert, DPF_TRUST_PLATFORM: "Darwin", DPF_TRUST_SECURITY: posix(fake) };
    const run = () => bash(`. "$TRUST_LIB"; dpf_install_root_trust "$ROOT"`, { home, env }).stdout.trim();
    assert.equal(run(), "trusted");
    assert.equal(run(), "already-trusted");
    assert.equal(readFileSync(store, "utf8").trim().split("\n").length, 1, "one keychain entry");
  });
});

test("Linux trust: the root is copied to the system CA dir and the store refreshed once", NEEDS_TRUST_TOOLS, () => {
  withHome(({ home }) => {
    const cert = withFixtureRoot(home);
    const anchors = join(home, "ca-certificates");
    mkdirSync(anchors);
    // Fake sudo: runs cp for real into the temporary anchor dir, records refreshes.
    const fake = join(home, "fake-sudo");
    writeFileSync(fake, `#!/bin/sh
case "$1" in
  update-ca-certificates|update-ca-trust) echo "$1" >> "${posix(home)}/refresh.log"; exit 0 ;;
esac
exec "$@"
`);
    chmodSync(fake, 0o755);
    const env = { ROOT: cert, DPF_TRUST_PLATFORM: "Linux", DPF_TRUST_SUDO: posix(fake), DPF_TRUST_LINUX_ANCHOR_DIRS: posix(anchors) };
    const run = () => bash(`. "$TRUST_LIB"; dpf_install_root_trust "$ROOT"`, { home, env }).stdout.trim();
    assert.equal(run(), "trusted");
    assert.equal(run(), "already-trusted");
    assert.ok(existsSync(join(anchors, "dpf-organization-root.crt")));
    assert.equal(readFileSync(join(home, "refresh.log"), "utf8").trim().split("\n").length, 1, "one store refresh");
  });
});

// --- Windows twin (PowerShell) ---------------------------------------------------

function powershell(script) {
  const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  return result.stdout.trim();
}

const q = (value) => value.replaceAll("'", "''");

test("Windows: DPF_MCP_URL and NODE_EXTRA_CA_CERTS go to the User env once; a rerun writes nothing", NEEDS_POWERSHELL, () => {
  withHome(({ home, install }) => {
    const cert = writeRoot(home);
    writeFileSync(join(install, ".env"), "PUBLIC_URL=https://desk.lan\n");
    // Fake User environment: a hashtable; every write is counted.
    const out = powershell(`. '${q(envLibPs)}'
      $store = @{ DPF_MCP_URL = 'http://127.0.0.1:3000/api/mcp/v1' }; $script:writes = 0
      $get = { param($n) $store[$n] }
      $set = { param($n, $v) $script:writes++; $store[$n] = $v }
      $clientEnv = Resolve-DpfMcpClientEnv -InstallDir '${q(install)}' -ExplicitUrl '' -HomeDir '${q(home)}' -GetUserEnv { param($n) '' }
      $first = Set-DpfMcpClientEnv -ClientEnv $clientEnv -GetUserEnv $get -SetUserEnv $set
      $firstWrites = $script:writes
      $second = Set-DpfMcpClientEnv -ClientEnv $clientEnv -GetUserEnv $get -SetUserEnv $set
      "$first|$firstWrites|$second|$($script:writes)|$($store['DPF_MCP_URL'])|$($store['NODE_EXTRA_CA_CERTS'])"`);
    assert.equal(out, `persisted|2|unchanged|2|https://desk.lan/api/mcp/v1?tier=full|${cert}`);
  });
});

test("Windows: no https origin persists nothing", NEEDS_POWERSHELL, () => {
  withHome(({ home, install }) => {
    writeFileSync(join(install, ".env"), "PUBLIC_URL=http://localhost:3000\n");
    const out = powershell(`. '${q(envLibPs)}'
      $script:writes = 0
      $clientEnv = Resolve-DpfMcpClientEnv -InstallDir '${q(install)}' -ExplicitUrl '' -HomeDir '${q(home)}' -GetUserEnv { param($n) '' }
      $result = Set-DpfMcpClientEnv -ClientEnv $clientEnv -GetUserEnv { param($n) $null } -SetUserEnv { param($n, $v) $script:writes++ }
      "$result|$($script:writes)"`);
    assert.equal(out, "not-https|0");
  });
});

// --- Wiring: the installers themselves persist, and the bootstrap reads PUBLIC_URL ---

test("both installers persist the client endpoint after HTTPS setup, on every run", () => {
  const ps = readFileSync(join(root, "install-dpf.ps1"), "utf8");
  assert.match(ps, /scripts\\installer\\lib\\mcp-client-env\.ps1"/);
  assert.match(ps, /Resolve-DpfMcpClientEnv -InstallDir \$DPF_DIR/);
  assert.match(ps, /Set-DpfMcpClientEnv/);
  // Before the platform starts, and outside a step-done guard, so a re-run converges.
  assert.ok(ps.indexOf("Set-DpfMcpClientEnv") < ps.indexOf('Write-Step 7 10'));
  const sh = readFileSync(join(root, "install-dpf.sh"), "utf8");
  assert.match(sh, /lib\/mcp-client-env\.sh/);
  assert.match(sh, /dpf_resolve_mcp_client_env "\$REPO_ROOT"/);
  assert.match(sh, /dpf_persist_mcp_client_env/);
  assert.ok(sh.indexOf("dpf_persist_mcp_client_env") < sh.indexOf('step "Bringing up the platform"'));
});

test("the agent-toolchain bootstrap reads PUBLIC_URL through the shared module, not a pre-set https DPF_MCP_URL", () => {
  const ps = readFileSync(join(root, "scripts/dpf-bootstrap-agent-toolchain.ps1"), "utf8");
  assert.match(ps, /installer\\lib\\mcp-client-env\.ps1/);
  assert.match(ps, /Resolve-DpfMcpClientEnv -InstallDir \$RepoRoot/);
  assert.match(ps, /Set-DpfMcpClientEnv/);
  assert.doesNotMatch(ps, /if \(\$McpEndpoint -like 'https:\/\/\*'\) \{\s*\r?\n\s*\$envFileBundle/);
  assert.doesNotMatch(ps, /\$McpTrustBundle\) \{\s*\r?\n\s*\[System\.Environment\]::SetEnvironmentVariable\('DPF_MCP_URL'/);
  const sh = readFileSync(join(root, "scripts/dpf-bootstrap-agent-toolchain.sh"), "utf8");
  assert.match(sh, /installer\/lib\/mcp-client-env\.sh/);
  assert.match(sh, /dpf_resolve_mcp_client_env "\$REPO_ROOT"/);
  assert.match(sh, /dpf_persist_mcp_client_env/);
});

test("the Windows consumer release carries the client-env module", () => {
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /COPY scripts\/installer\/lib\/mcp-client-env\.ps1 \.\/scripts\/installer\/lib\//);
  assert.match(dockerfile, /cp [^\n]*scripts\/installer\/lib\/mcp-client-env\.ps1[^\n]*\/dpf-release-assets\/scripts\/installer\/lib\//);
});

// BI-9F258707: a GUI-launched process may predate the persisted user environment.
test("worktree recovers saved HTTPS endpoint and quoted CA without executing saved shell text", NEEDS_BASH, () => {
  withHome(({ home, install }) => {
    const cert = join(home, "organization's CA.pem");
    writeFileSync(cert, "fixture\n");
    const sentinel = join(home, "must-not-exist");
    const script = `. "$ENV_LIB"; dpf_set_client_env_export DPF_MCP_URL 'https://desk.lan/api/mcp/v1?tier=full'; dpf_set_client_env_export NODE_EXTRA_CA_CERTS "$CERT"; printf '\\ntouch "%s"\\n' "$SENTINEL" >> "$(dpf_mcp_client_env_file)"; dpf_resolve_mcp_client_env "$INSTALL"; printf '%s|%s' "$DPF_MCP_CLIENT_URL" "$DPF_MCP_CLIENT_CA_BUNDLE"`;
    const out = bash(script, { home, env: { INSTALL: posix(install), CERT: posix(cert), SENTINEL: posix(sentinel) } });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, `https://desk.lan/api/mcp/v1?tier=full|${posix(cert)}`);
    assert.equal(existsSync(sentinel), false);
  });
});

test("saved endpoint is below explicit process URL and canonical install origin", NEEDS_BASH, () => {
  withHome(({ home, install }) => {
    const prepare = `. "$ENV_LIB"; dpf_set_client_env_export DPF_MCP_URL 'https://saved.lan/api/mcp/v1'; `;
    const out = bash(prepare + resolveScript, { home, env: { INSTALL: posix(install), DPF_MCP_URL: "http://explicit.lan/mcp" } });
    assert.equal(out.stdout, "http://explicit.lan/mcp|");
    writeFileSync(join(install, ".env"), "PUBLIC_URL=https://install.lan\n");
    const canonical = bash(resolveScript, { home, env: { INSTALL: posix(install), DPF_MCP_URL: "https://explicit.lan/mcp" } });
    assert.equal(canonical.stdout, "https://install.lan/api/mcp/v1?tier=full|");
  });
});

test("Windows resolver recovers persisted User endpoint and CA for an older process", NEEDS_POWERSHELL, () => {
  withHome(({ home, install }) => {
    const cert = writeRoot(home);
    const out = powershell(`. '${q(envLibPs)}'
      $saved = @{ DPF_MCP_URL = 'https://saved.lan/api/mcp/v1?tier=full'; NODE_EXTRA_CA_CERTS = '${q(cert)}' }
      $r = Resolve-DpfMcpClientEnv -InstallDir '${q(install)}' -ExplicitUrl '' -ExplicitBundle '' -HomeDir '${q(home)}' -GetUserEnv { param($n) $saved[$n] }
      "$($r.McpUrl)|$($r.CaBundle)"`);
    assert.equal(out, `https://saved.lan/api/mcp/v1?tier=full|${cert}`);
  });
});


test("saved export parsing rejects executable assignments and leaves credential exports unread", NEEDS_BASH, () => {
  withHome(({ home, install }) => {
    mkdirSync(join(home, ".dpf"));
    const file = join(home, ".dpf", "agent-toolchain.env");
    const sentinel = posix(join(home, "executed"));
    writeFileSync(file, `export DPF_MCP_URL=$(touch "${sentinel}")\nexport DPF_MCP_BEARER_TOKEN='fixture-secret'\n`);
    const out = bash(resolveScript, { home, env: { INSTALL: posix(install) } });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, "|");
    assert.equal(existsSync(sentinel), false);
    const secret = bash(`. "$ENV_LIB"; dpf_mcp_saved_env_value DPF_MCP_BEARER_TOKEN`, { home });
    assert.equal(secret.status, 64);
    assert.equal(secret.stdout, "");
  });
});

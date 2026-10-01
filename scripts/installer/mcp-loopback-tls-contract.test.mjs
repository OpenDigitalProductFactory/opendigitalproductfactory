// BI-FA2C46D7 — the MCP credential path over loopback TLS.
//
// The Claude MCP client authorizes over OAuth only on https. Three things had
// to be true for that to work on an install with the organization PKI: the
// portal certificate must outlive a day, the client must be handed the
// organization root (NODE_EXTRA_CA_CERTS) and the https endpoint the same way
// it is handed the token today, and the session-start health probe must read
// the OAuth challenge instead of demanding a token. These tests pin those
// contracts in the checked-in scripts, in both the Bash and PowerShell twins.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the portal leaf is issued for a year, on a provisioner whose claims allow it, in both PKI bootstraps", async () => {
  const [shell, powershell] = await Promise.all([
    read("scripts/bootstrap-organization-pki.sh"),
    read("scripts/bootstrap-organization-pki.ps1"),
  ]);

  // Bash 3.2 / PowerShell 5.1 twins carry the same lifetime and the same override knob.
  for (const source of [shell, powershell]) {
    assert.match(source, /DPF_PKI_PORTAL_CERT_DURATION/);
    assert.match(source, /8760h/);
    // The claims are raised on dpf-installer specifically (dpf-edge-client already had claims).
    assert.match(source, /provisioner[",\s]+update[",\s]+dpf-installer/);
    assert.match(source, /x509-max-dur/);
    // Issuance requests the full lifetime; renewal alone would keep a 24h leaf at 24h.
    assert.match(source, /--not-after/);
    // A short-lived or nearly-expired existing leaf is re-issued, not renewed.
    assert.match(source, /needs[_-]?reissue|NeedsReissue/i);
  }
  // The re-issue decision is made before the renew branch is taken.
  assert.match(shell, /!\s*portal_leaf_needs_reissue; then\n\s+compose exec -T step-ca step ca renew/);
  assert.match(powershell, /-not \(Test-DpfPortalLeafNeedsReissue\)\) \{\s*\r?\n\s+Invoke-DpfPkiCompose -Arguments @\("exec", "-T", "step-ca", "step", "ca", "renew"/);
  // The edge-client provisioner's existing claims are untouched.
  assert.match(shell, /dpf-edge-client[\s\S]*--x509-default-dur 720h --x509-max-dur 720h/);
});

test("the toolchain bootstrap persists the organization root and the https endpoint beside the token", async () => {
  const [shell, lib] = await Promise.all([
    read("scripts/dpf-bootstrap-agent-toolchain.sh"),
    read("scripts/installer/lib/mcp-client-env.sh"),
  ]);

  // Resolution lives once in the shared module (BI-2D545A0C): PUBLIC_URL from the
  // install's .env, then explicit env; the bundle from explicit env, the .env, the
  // default PKI dir — https only. Behaviour: scripts/installer/mcp-client-env.test.mjs.
  assert.match(shell, /dpf_resolve_mcp_client_env "\$REPO_ROOT"/);
  assert.match(shell, /export NODE_EXTRA_CA_CERTS="\$MCP_TRUST_BUNDLE"/);
  assert.match(lib, /DPF_PKI_TRUST_BUNDLE/);
  assert.match(lib, /\$HOME\/\.dpf\/pki\/root_ca\.crt/);
  // One managed env file with one writer (the shared module): token, DPF_MCP_URL, NODE_EXTRA_CA_CERTS.
  assert.match(shell, /persist_mcp_client_env_posix\(\)/);
  assert.match(shell, /dpf_set_client_env_export DPF_MCP_BEARER_TOKEN/);
  assert.match(shell, /dpf_persist_mcp_client_env/);
  assert.doesNotMatch(shell, /> "\$mcp_token_envfile"/, "the bootstrap no longer writes the env file itself");
  assert.equal((lib.match(/> "\$tmp"/g) ?? []).length, 1, "exactly one writer of the managed env file");
  // GUI clients on macOS get the same three through launchd.
  assert.match(shell, /dpf_launchd_setenv DPF_MCP_BEARER_TOKEN/);
  assert.match(lib, /dpf_launchd_setenv DPF_MCP_URL/);
  assert.match(lib, /dpf_launchd_setenv NODE_EXTRA_CA_CERTS/);
  // The transport lines are persisted on any https endpoint, even with no token, never at dry-run.
  assert.match(shell, /\[ "\$DRY_RUN" -eq 0 \] && \[ "\$_https_endpoint" -eq 1 \]/);
  // The token mint path still routes through the same writer (no second env file).
  assert.match(shell, /persist_mcp_token_posix\(\) \{\n\s+DPF_MCP_BEARER_TOKEN="\$1"\n\s+persist_mcp_client_env_posix\n\}/);
  // The scope probe presents the bundle to curl.
  assert.match(shell, /_scope_probe="\$\(curl -s --max-time 5 \$\{NODE_EXTRA_CA_CERTS:\+--cacert "\$NODE_EXTRA_CA_CERTS"\}/);
});

test("the session-start MCP health hook reads the OAuth challenge on https instead of demanding a token", async () => {
  const shell = await read("scripts/hooks/mcp-health.sh");

  assert.match(shell, /cacert_args="--cacert \$\{NODE_EXTRA_CA_CERTS\}"/);
  // Anonymous probe on https; the healthy answer is a 401 naming resource_metadata.
  assert.match(shell, /https:\/\/\*\)\n\s+if \[ -z "\$\{DPF_MCP_BEARER_TOKEN:-\}" \] \|\| \[ "\$has_header" != "1" \]; then/);
  assert.match(shell, /\*"HTTP\/"\*" 401"\*resource_metadata\*\)/);
  // The bearer probe also presents the bundle, so an https install with a PAT still diagnoses correctly.
  assert.match(shell, /-w '%\{http_code\}' --max-time 4 \$cacert_args -X POST "\$url"/);
  // The token is never printed.
  assert.doesNotMatch(shell, /echo "?\$DPF_MCP_BEARER_TOKEN|printf.*\$DPF_MCP_BEARER_TOKEN/);
});

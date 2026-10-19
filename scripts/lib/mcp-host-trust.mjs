// Host adapter for the installer-owned environment contract (BI-F89C7FBD).
// Reads only; never persists trust, credentials, endpoint or permissions.
import { spawn, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as tls from "node:tls";
import { isIP } from "node:net";
import { resolveDpfStatePath } from "./resolve-compose-install-context.mjs";
import { scriptArgv } from "./script-argv.mjs";
import { parseArgs } from "node:util";

const library = resolve(dirname(fileURLToPath(import.meta.url)), "../installer/lib");
const configuredBundle = env => env.DPF_MCP_CA_FILE || env.DPF_PKI_TRUST_BUNDLE || env.NODE_EXTRA_CA_CERTS;
const trustError = (code, message, cause) => Object.assign(new Error(`${code}: ${message}`, { cause }), { code });

export function readHostClientEnv({ mcpUrl = "", env = process.env, home = homedir(),
  platform = process.platform, installDir, spawnSyncImpl = spawnSync } = {}) {
  const explicitUrl = mcpUrl || env.DPF_MCP_URL || env.DPF_MCP_ENDPOINT || "";
  if (explicitUrl && new URL(explicitUrl).protocol !== "https:") return { McpUrl: explicitUrl, CaBundle: "" };
  // Explicit connection settings do not depend on unrelated saved state.
  if (explicitUrl && configuredBundle(env)) return { McpUrl: explicitUrl, CaBundle: configuredBundle(env) };
  if (!installDir) {
    try { installDir = JSON.parse(readFileSync(resolveDpfStatePath({ env, home }), "utf8")).installPath; }
    catch (error) { if (error.code !== "ENOENT") throw trustError("mcp_host_config_invalid", "Cannot read the saved install context; repair install-state.json.", error); }
  }
  installDir ||= process.cwd();
  const childEnv = { ...env, DPF_TRUST_LIB: library, DPF_TRUST_INSTALL: installDir,
    DPF_TRUST_URL: explicitUrl, DPF_TRUST_HOME: home };
  let command, args;
  if (platform === "win32") {
    command = "powershell.exe";
    args = ["-NoProfile", "-NonInteractive", "-Command",
      '$ErrorActionPreference="Stop"; . (Join-Path $env:DPF_TRUST_LIB "mcp-client-env.ps1"); Resolve-DpfMcpClientEnv -InstallDir $env:DPF_TRUST_INSTALL -ExplicitUrl $env:DPF_TRUST_URL -HomeDir $env:DPF_TRUST_HOME | ConvertTo-Json -Compress'];
  } else if (platform === "darwin" || platform === "linux") {
    childEnv.DPF_TRUST_LIB = library.replaceAll("\\", "/");
    childEnv.DPF_TRUST_INSTALL = installDir.replaceAll("\\", "/");
    childEnv.DPF_TRUST_HOME = home.replaceAll("\\", "/");
    command = "bash";
    args = ["-c", 'set -e; HOME="$DPF_TRUST_HOME"; export HOME; . "$DPF_TRUST_LIB/mcp-client-env.sh"; DPF_MCP_URL="$DPF_TRUST_URL"; dpf_resolve_mcp_client_env "$DPF_TRUST_INSTALL"; printf "%s\\0%s" "$DPF_MCP_CLIENT_URL" "$DPF_MCP_CLIENT_CA_BUNDLE"'];
  } else throw trustError("mcp_host_platform_unsupported", "Host trust resolution supports Windows, macOS and Linux.");
  const result = spawnSyncImpl(command, args, { env: childEnv, encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 });
  if (result.error || result.status !== 0) throw trustError("mcp_host_config_unavailable", "Cannot read saved endpoint/trust with the supported host resolver. Check the host shell and installer client environment.", result.error);
  try {
    const value = platform === "win32" ? JSON.parse(result.stdout.replace(/^\uFEFF/, ""))
      : { McpUrl: result.stdout.split("\0")[0], CaBundle: result.stdout.split("\0")[1] };
    if (typeof value.McpUrl !== "string" || typeof value.CaBundle !== "string") throw Error("invalid resolver output");
    return value;
  } catch (error) { throw trustError("mcp_host_config_invalid", "The host environment resolver returned invalid configuration.", error); }
}

export function readTrustBundle(path, { now = Date.now() } = {}) {
  let pem;
  try { pem = readFileSync(path, "utf8"); }
  catch (error) { throw trustError("mcp_ca_unreadable", `Selected CA bundle is missing or unreadable: ${path}. Restore that authorized file or correct the explicit CA setting.`, error); }
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  if (!blocks.length || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) {
    throw trustError("mcp_ca_invalid", `Selected CA bundle is not a PEM certificate bundle: ${path}. Restore the authorized CA bundle.`);
  }
  for (const block of blocks) {
    let cert;
    try { cert = new X509Certificate(block); }
    catch (error) { throw trustError("mcp_ca_invalid", `Invalid certificate in ${path}. Restore the authorized CA bundle.`, error); }
    if (!cert.ca) throw trustError("mcp_ca_invalid", `Selected trust file contains a non-CA certificate: ${path}. Use the authorized CA bundle, not a server certificate.`);
    if (Date.parse(cert.validTo) <= now) throw trustError("mcp_ca_expired", `CA certificate expired in ${path}. Renew it through the managed PKI setup.`);
    if (Date.parse(cert.validFrom) > now) throw trustError("mcp_ca_not_yet_valid", `CA certificate is not yet valid in ${path}. Check the host clock and managed PKI setup.`);
  }
  return blocks;
}

export function resolveHostMcpTrust(options = {}) {
  const env = options.env ?? process.env;
  const selected = readHostClientEnv(options);
  const certificates = selected.CaBundle ? readTrustBundle(selected.CaBundle) : [];
  const childEnv = { ...env };
  if (selected.McpUrl && !env.DPF_MCP_URL && !options.mcpUrl) childEnv.DPF_MCP_URL = selected.McpUrl;
  if (selected.CaBundle) childEnv.NODE_EXTRA_CA_CERTS = selected.CaBundle;
  // Supplying `ca` replaces Node defaults. Preserve effective system/bundled/
  // startup roots rather than replacing them with only the private CA.
  const tlsOptions = certificates.length ? { ca: [...tls.getCACertificates("default"), ...certificates] } : {};
  return { mcpUrl: selected.McpUrl, caBundle: selected.CaBundle, certificates, env: childEnv, tlsOptions };
}

export function describeMcpTransportError(error, { phase = "probe" } = {}) {
  const code = error?.code ?? "mcp_transport_unavailable";
  // A request may have reached the server. Keep its existing timeout/socket
  // diagnostic and classification; never describe that as an unexecuted probe.
  if (phase === "request" && !/CERT|TLS|ISSUER|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return error;
  const remedy = code === "ERR_TLS_CERT_ALTNAME_INVALID" ? "Endpoint hostname does not match the server certificate. Correct the endpoint or renew its managed SANs."
    : code === "CERT_HAS_EXPIRED" ? "Server certificate expired. Renew the server certificate through managed PKI setup."
    : code === "CERT_NOT_YET_VALID" ? "Server certificate is not yet valid. Check the host clock and server certificate dates."
    : /ISSUER|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code) ? "Cannot verify the server issuer with the selected trust. Restore the matching authorized CA bundle (DPF_MCP_CA_FILE or NODE_EXTRA_CA_CERTS); check the server certificate chain."
    : code === "ETIMEDOUT" ? "Transport probe timed out; verify the configured endpoint and host connectivity."
    : "Cannot connect to the configured endpoint; verify its address and availability.";
  return trustError(code, remedy, error);
}

export async function probeMcpTransport({ mcpUrl, tlsOptions = {}, timeoutMs = 2500 } = {}) {
  const url = new URL(mcpUrl);
  if (url.protocol === "http:") return; // Preserve an explicit supported HTTP choice; never downgrade HTTPS.
  if (url.protocol !== "https:") throw trustError("mcp_endpoint_invalid", "MCP endpoint must use HTTP or HTTPS.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  await new Promise((resolveProbe, reject) => {
    const socket = tls.connect({ host, port: Number(url.port || 443),
      ...(!isIP(host) ? { servername: host } : {}), ...tlsOptions,
      // tls.connect does not check IP identity without an explicit servername.
      checkServerIdentity: (_name, cert) => tls.checkServerIdentity(host, cert), rejectUnauthorized: true });
    const deadline = setTimeout(() => socket.destroy(Object.assign(Error("timeout"), { code: "ETIMEDOUT" })), timeoutMs);
    socket.once("secureConnect", () => { clearTimeout(deadline); socket.destroy(); resolveProbe(); });
    socket.once("error", error => { clearTimeout(deadline); reject(describeMcpTransportError(error)); });
  });
}

// Configure BEFORE any credential exchange/lease/check; start a fresh Node when
// inherited startup roots do not contain the resolved CA. No request is replayed.
export async function runWithHostMcpTrust(main, { args = process.argv.slice(2), env = process.env,
  resolveImpl = resolveHostMcpTrust, spawnImpl = spawn } = {}) {
  if (args.includes("--help") || args.includes("-h") || args.includes("--dry-run")) return main();
  try {
    const { values } = parseArgs({ args: scriptArgv(args), strict: false, allowPositionals: true,
      options: { "mcp-url": { type: "string" } } });
    const trust = resolveImpl({ mcpUrl: values["mcp-url"], env });
    const loaded = new Set(tls.getCACertificates("extra").map(pem => new X509Certificate(pem).fingerprint256));
    const wanted = trust.certificates.map(pem => new X509Certificate(pem).fingerprint256).join(",");
    if (trust.certificates.some(pem => !loaded.has(new X509Certificate(pem).fingerprint256))) {
      if (env.DPF_HOST_TRUST_REEXEC === wanted) throw trustError("mcp_ca_startup_unavailable",
        "A fresh Node process could not load the selected CA. Check Node startup restrictions and the bundle's read permissions.");
      const child = spawnImpl(process.execPath, [...process.execArgv, process.argv[1], ...args], {
        env: { ...trust.env, DPF_HOST_TRUST_REEXEC: wanted }, stdio: "inherit", windowsHide: true });
      const forward = signal => child.kill(signal);
      const interrupt = () => forward("SIGINT"), terminate = () => forward("SIGTERM");
      process.once("SIGINT", interrupt); process.once("SIGTERM", terminate);
      try { return await new Promise((resolveChild, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolveChild(code ?? (signal === "SIGINT" ? 130 : 88)));
      }); } finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", terminate); }
    }
    Object.assign(env, trust.env);
    delete env.DPF_HOST_TRUST_REEXEC;
    await probeMcpTransport({ ...trust, mcpUrl: trust.mcpUrl || env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1" });
  } catch (error) {
    // Only setup failures precede execution. main() may send effectful requests;
    // a lost acknowledgement there must retain its existing recovery path.
    error.hostTrustPrerequisite = true;
    throw error;
  }
  return main();
}

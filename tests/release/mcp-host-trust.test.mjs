import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createServer } from "node:https";
import { getCACertificates } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readHostClientEnv, readTrustBundle, resolveHostMcpTrust, probeMcpTransport, describeMcpTransportError, runWithHostMcpTrust } from "../../scripts/lib/mcp-host-trust.mjs";
import { mcpCall } from "../../scripts/lib/mcp-client.mjs";
import { readEarlyQuiescenceStatus } from "../../scripts/lib/gate-quiescence.mjs";
import { runForegroundGate, runGateWithQueuedRevival, runHostPreflight } from "../../scripts/pregate.mjs";
import { classifyGateExit } from "../../scripts/lib/gate-exit-classification.mjs";
import { createGateFixtureTls } from "../../scripts/fixtures/gate-worktree.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), "dpf-tls-"));
const { key, cert } = createGateFixtureTls(fixture);
test.after(() => rmSync(fixture, { recursive: true, force: true }));

function child(script, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, script, { env: { ...process.env, NODE_EXTRA_CA_CERTS: "", DPF_MCP_CA_FILE: "", DPF_PKI_TRUST_BUNDLE: "", ...env }, windowsHide: true });
    let stdout = "", stderr = "";
    proc.stdout.on("data", chunk => { stdout += chunk; });
    proc.stderr.on("data", chunk => { stderr += chunk; });
    proc.once("error", reject);
    proc.once("close", status => resolve({ status, stdout, stderr }));
  });
}

async function server(t, handler = (_req, res) => { res.writeHead(401); res.end("denied"); }) {
  const app = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, handler);
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
  return `https://localhost:${app.address().port}/api/mcp/v1`;
}

test("bundle diagnostics distinguish absent, malformed, expired and not-yet-valid trust", () => {
  assert.throws(() => readTrustBundle(join(fixture, "absent.pem")), { code: "mcp_ca_unreadable" });
  const invalid = join(fixture, "bad.pem"); writeFileSync(invalid, "not a cert");
  assert.throws(() => readTrustBundle(invalid), { code: "mcp_ca_invalid" });
  assert.throws(() => readTrustBundle(cert, { now: Date.now() + 10 * 86400000 }), { code: "mcp_ca_expired" });
  assert.throws(() => readTrustBundle(cert, { now: 0 }), { code: "mcp_ca_not_yet_valid" });
});

test("managed roots extend effective Node roots, and explicit process settings win", () => {
  for (const selected of [{ DPF_MCP_CA_FILE: cert, NODE_EXTRA_CA_CERTS: "bad" },
    { DPF_PKI_TRUST_BUNDLE: cert, NODE_EXTRA_CA_CERTS: "bad" }, { NODE_EXTRA_CA_CERTS: cert }]) {
    const env = { ...selected, DPF_MCP_BEARER_TOKEN: "unchanged-identity", DPF_MCP_CLIENT_CREDENTIALS_FILE: "unchanged-path" };
    const trust = resolveHostMcpTrust({ mcpUrl: "https://public.example/api/mcp/v1", env, installDir: fixture });
    assert.equal(trust.caBundle, cert);
    assert.equal(trust.env.NODE_EXTRA_CA_CERTS, cert);
    assert.equal(trust.env.DPF_MCP_BEARER_TOKEN, env.DPF_MCP_BEARER_TOKEN);
    assert.equal(trust.env.DPF_MCP_CLIENT_CREDENTIALS_FILE, env.DPF_MCP_CLIENT_CREDENTIALS_FILE);
    for (const ca of getCACertificates("default")) assert.ok(trust.tlsOptions.ca.includes(ca), "public/system CA retained");
  }
});

test("public CA endpoints need no managed CA; explicit HTTP is preserved", () => {
  const empty = { status: 0, stdout: JSON.stringify({ McpUrl: "https://public.example/api/mcp/v1", CaBundle: "" }) };
  const trust = resolveHostMcpTrust({ env: {}, platform: "win32", installDir: fixture, spawnSyncImpl: () => empty });
  assert.deepEqual(trust.tlsOptions, {});
  assert.equal(trust.env.NODE_EXTRA_CA_CERTS, undefined);
  assert.deepEqual(readHostClientEnv({ mcpUrl: "http://localhost:3000/api/mcp/v1", env: { NODE_EXTRA_CA_CERTS: "missing" }, installDir: fixture }),
    { McpUrl: "http://localhost:3000/api/mcp/v1", CaBundle: "" });
});

test("packaged shared HTTPS resolver has its declared Linux shell dependency", () => {
  const runner = readFileSync(join(root, "Dockerfile"), "utf8").split("FROM base AS runner")[1];
  assert.match(runner, /RUN apk add --no-cache[^\r\n]*\bbash\b/);
});

test("only pre-main trust failures are marked as unrun host prerequisites", async () => {
  const lostAck = Object.assign(Error("record result acknowledgement lost"), { code: "ETIMEDOUT" });
  let calls = 0;
  await assert.rejects(runWithHostMcpTrust(() => { calls++; throw lostAck; }, {
    args: [], env: {}, resolveImpl: () => ({ certificates: [], env: {}, mcpUrl: "http://localhost/api/mcp/v1" }),
  }), error => error === lostAck && !error.hostTrustPrerequisite);
  assert.equal(calls, 1, "an uncertain main request is never replayed");
  const unreadable = Object.assign(Error("selected CA unreadable"), { code: "mcp_ca_unreadable" });
  await assert.rejects(runWithHostMcpTrust(() => { calls++; }, {
    args: [], env: {}, resolveImpl: () => { throw unreadable; },
  }), error => error === unreadable && error.hostTrustPrerequisite === true);
  assert.equal(calls, 1, "host prerequisite failure prevents main");
});

test("trusted Windows re-exec retains repeated cancellation until its child closes", { skip: process.platform !== "win32" }, async () => {
  const signals = new EventEmitter(), proc = new EventEmitter();
  proc.exitCode = null; proc.signalCode = null;
  proc.kill = () => assert.fail("console Ctrl-C must not be forwarded as a Windows hard kill");
  let launches = 0;
  const status = await runWithHostMcpTrust(() => assert.fail("main must only execute in the re-exec child"), {
    args: [], env: {}, signalSource: signals,
    resolveImpl: () => ({ certificates: [readFileSync(cert, "utf8")], env: { NODE_EXTRA_CA_CERTS: cert } }),
    spawnImpl: (_command, _args, options) => {
      launches++;
      assert.equal(options.env.NODE_EXTRA_CA_CERTS, cert);
      assert.ok(options.env.DPF_HOST_TRUST_REEXEC);
      setImmediate(() => {
        signals.emit("SIGINT"); signals.emit("SIGINT");
        assert.equal(signals.listenerCount("SIGINT"), 1);
        proc.exitCode = 87; proc.emit("close", 87, null);
      });
      return proc;
    },
  });
  assert.equal(status, 87); assert.equal(launches, 1);
  assert.equal(signals.listenerCount("SIGINT"), 0); assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("a re-exec execution error stays uncertain instead of becoming an unrun trust prerequisite", async () => {
  const uncertain = Object.assign(Error("owned child outcome unavailable"), { code: "EIO" });
  const proc = new EventEmitter(), signals = new EventEmitter();
  let launches = 0;
  await assert.rejects(runWithHostMcpTrust(() => assert.fail("never replay main"), {
    args: [], env: {}, signalSource: signals,
    resolveImpl: () => ({ certificates: [readFileSync(cert, "utf8")], env: { NODE_EXTRA_CA_CERTS: cert } }),
    spawnImpl: () => {
      launches++; setImmediate(() => { proc.emit("error", uncertain); proc.emit("close", 1, null); }); return proc;
    },
  }), error => error === uncertain && !error.hostTrustPrerequisite);
  assert.equal(launches, 1); assert.equal(signals.listenerCount("SIGINT"), 0);
});

test("trust parent outlives the gate close grace and existing recovery", { skip: process.platform !== "win32" }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = new EventEmitter(), owner = new EventEmitter(), gate = new EventEmitter();
  for (const child of [owner, gate]) { child.exitCode = null; child.signalCode = null; }
  let ownerKills = 0, gateKills = 0, recovering = false;
  owner.kill = () => { ownerKills++; return true; };
  gate.kill = () => { gateKills++; return true; };
  const pending = runWithHostMcpTrust(() => assert.fail("main executes only in the child"), {
    args: [], env: {}, signalSource: signals,
    resolveImpl: () => ({ certificates: [readFileSync(cert, "utf8")], env: { NODE_EXTRA_CA_CERTS: cert } }),
    spawnImpl: () => {
      void runGateWithQueuedRevival({ signalSource: signals,
        runGateImpl: (command, args, options) => runForegroundGate(command, args, { ...options, spawnImpl: () => gate }),
        recoverInterruptedGateImpl: async () => { recovering = true; await new Promise(resolve => setTimeout(resolve, 10000)); },
        stderr: { write() {} },
      }).then(({ result }) => { owner.exitCode = result.status; owner.emit("close", result.status, null); });
      return owner;
    },
  });
  signals.emit("SIGINT");
  t.mock.timers.tick(30000);
  assert.equal(gateKills, 1); assert.equal(ownerKills, 0, "outer owner preempted its child's cancellation grace");
  t.mock.timers.tick(9000); gate.exitCode = 87; gate.emit("close", 87, null);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(recovering, true);
  t.mock.timers.tick(10000);
  assert.equal(await pending, 87); assert.equal(ownerKills, 0);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});

test("OS adapters consume existing saved-state resolvers without credential output", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const selected = readHostClientEnv({ platform, env: {}, installDir: fixture, home: fixture,
      spawnSyncImpl(command, args, options) {
        assert.equal(options.windowsHide, true);
        assert.equal(command, platform === "win32" ? "powershell.exe" : "bash");
        assert.ok(args.join(" ").includes(platform === "win32" ? "Resolve-DpfMcpClientEnv" : "dpf_resolve_mcp_client_env"));
        assert.doesNotMatch(args.join(" "), /Set-Dpf|persist_mcp|BEARER_TOKEN|CLIENT_SECRET/);
        return { status: 0, stdout: platform === "win32" ? JSON.stringify({ McpUrl: "https://localhost/api/mcp/v1", CaBundle: cert })
          : `https://localhost/api/mcp/v1\0${cert}` };
      } });
    assert.equal(selected.CaBundle, cert);
  }
});

test("Windows host resolver preserves non-ASCII managed CA paths", { skip: process.platform !== "win32" }, () => {
  const install = join(fixture, "caf\u00e9-\u8a3c\u660e\u66f8");
  mkdirSync(install);
  const bundle = join(install, "root_ca.crt");
  writeFileSync(bundle, readFileSync(cert));
  writeFileSync(join(install, ".env"), `DPF_PKI_TRUST_BUNDLE=${bundle}\n`);
  const trust = resolveHostMcpTrust({ mcpUrl: "https://localhost/api/mcp/v1", installDir: install,
    env: { ...process.env, DPF_MCP_CA_FILE: "", DPF_PKI_TRUST_BUNDLE: "", NODE_EXTRA_CA_CERTS: "" } });
  assert.equal(trust.caBundle, bundle);
  assert.equal(trust.certificates.length, 1);
});

test("TLS probe verifies chain and hostname without sending any HTTP request", async t => {
  let requests = 0;
  const mcpUrl = await server(t, (_req, res) => { requests++; res.end("unexpected"); });
  const trust = resolveHostMcpTrust({ mcpUrl, env: { NODE_EXTRA_CA_CERTS: cert }, installDir: fixture });
  await probeMcpTransport(trust);
  assert.equal(requests, 0);
  await assert.rejects(probeMcpTransport({ mcpUrl }), error => /ISSUER|SELF_SIGNED/.test(error.code));
  await assert.rejects(probeMcpTransport({ ...trust, mcpUrl: mcpUrl.replace("localhost", "127.0.0.1") }), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  assert.match(describeMcpTransportError({ code: "CERT_HAS_EXPIRED" }).message, /Server certificate expired/);
});

test("already-running shared MCP caller applies trust before its first HTTPS request", async t => {
  const mcpUrl = await server(t);
  const result = await child(["--input-type=module", "-e", `import {mcpPost} from ${JSON.stringify(pathToFileURL(join(root, "scripts/lib/mcp-client.mjs")).href)};
    process.env.DPF_MCP_CA_FILE=${JSON.stringify(cert)};
    const reply=await mcpPost('tools/list',{}, {mcpUrl:${JSON.stringify(mcpUrl)},bearerToken:'same-fixture-identity'});
    console.log(reply.status);`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "401", "transport succeeds; authentication remains denied");
});

test("already-running OAuth caller keeps client identity while applying saved request trust", async t => {
  let exchanges = 0;
  const mcpUrl = await server(t, (req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      assert.equal(req.url, "/api/oauth/token");
      const form = new URLSearchParams(body);
      assert.equal(form.get("client_id"), "same-client");
      assert.equal(form.get("client_secret"), "same-fixture-secret");
      exchanges++;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ access_token: "fixture-access", expires_in: 300 }));
    });
  });
  const result = await child(["--input-type=module", "-e", `import {exchangeClientCredentials} from ${JSON.stringify(pathToFileURL(join(root, "scripts/lib/mcp-credential.mjs")).href)};
    process.env.DPF_MCP_CA_FILE=${JSON.stringify(cert)};
    const result=await exchangeClientCredentials({mcpUrl:${JSON.stringify(mcpUrl)},clientId:'same-client',clientSecret:'same-fixture-secret'});
    console.log(result.accessToken==='fixture-access');`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(exchanges, 1, "no effectful request retried");
  assert.equal(result.stdout.trim(), "true");
});

test("an HTTPS request timeout retains its call label and uncertain-outcome diagnostic", async t => {
  const mcpUrl = await server(t, () => {});
  const result = await child(["--input-type=module", "-e", `import {mcpCall} from ${JSON.stringify(pathToFileURL(join(root, "scripts/lib/mcp-client.mjs")).href)};
    process.env.DPF_MCP_CA_FILE=${JSON.stringify(cert)};
    try { await mcpCall('fixture_read',{}, {mcpUrl:${JSON.stringify(mcpUrl)},bearerToken:'same-fixture-identity',timeoutMs:80}); }
    catch(error) { console.log(error.code+' '+error.message); }`]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ETIMEDOUT mcpCall: fixture_read timed out after 80ms/);
  assert.doesNotMatch(result.stdout, /probe timed out/);
});

test("launcher prepares Node startup and grandchildren with no request replay", async t => {
  const mcpUrl = await server(t);
  const entry = join(fixture, "launcher.mjs");
  writeFileSync(entry, `import {runWithHostMcpTrust} from ${JSON.stringify(pathToFileURL(join(root, "scripts/lib/mcp-host-trust.mjs")).href)};
    import {getCACertificates} from 'node:tls'; import {spawn} from 'node:child_process';
    const status=await runWithHostMcpTrust(async()=>{
      console.log('startup-roots='+getCACertificates('extra').length);
      const child=spawn(process.execPath,['--input-type=module','-e',
        ${JSON.stringify(`import https from 'node:https'; https.get(${JSON.stringify(mcpUrl)},res=>{console.log('grandchild='+res.statusCode);res.resume()}).on('error',e=>{console.error(e.code);process.exitCode=1});`)}],{stdio:'inherit'});
      return await new Promise(r=>child.on('close',r));
    }); if(typeof status==='number')process.exitCode=status;`);
  const result = await child([entry], { DPF_MCP_URL: mcpUrl, DPF_PKI_TRUST_BUNDLE: cert });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /startup-roots=1/);
  assert.match(result.stdout, /grandchild=401/);
  assert.equal(result.stdout.match(/startup-roots=/g).length, 1, "main executes once");
});

test("TLS, authentication, authorization and quiescence stay distinct before expensive guards", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(mcpCall("get_quiescence_status", {}, { mcpUrl: "http://localhost/api/mcp/v1", bearerToken: "fixture",
      fetchImpl: async () => new Response("denied", { status }) }), { code: status === 401 ? "mcp_authentication_failed" : "mcp_authorization_failed" });
  }
  let guards = 0;
  await assert.rejects(runHostPreflight({ env: {},
    readStatusImpl: () => readEarlyQuiescenceStatus({ strictConnection: true, env: { DPF_MCP_URL: "http://localhost/api/mcp/v1" },
      resolveCredentialImpl: () => ({ bearer: "fixture" }), mcpCallImpl: async () => { throw Object.assign(Error("denied"), { code: "mcp_authentication_failed" }); } }),
    spawnSyncImpl: () => { guards++; return { status: 0 }; } }), { code: "mcp_authentication_failed" });
  assert.equal(guards, 0);
  assert.equal(classifyGateExit({ code: 88 }).verdict, "none");
});

test("a slow quiescence read remains inconclusive after transport verification", async () => {
  let warning = "";
  const result = await readEarlyQuiescenceStatus({ strictConnection: true,
    env: { DPF_MCP_URL: "http://localhost/api/mcp/v1" },
    resolveCredentialImpl: () => ({ bearer: "fixture" }),
    mcpCallImpl: async () => { throw Object.assign(Error("read timed out"), { code: "ETIMEDOUT" }); },
    warn: text => { warning += text; } });
  assert.equal(result, null);
  assert.match(warning, /inconclusive/);
});

test("supported pregate launch rejects invalid trust before host guards or credential access", async () => {
  const result = await child([join(root, "scripts/pregate.mjs")], {
    DPF_MCP_URL: "https://localhost/api/mcp/v1", DPF_MCP_CA_FILE: join(fixture, "absent.pem"), DPF_PREGATE_ALLOW_CAPTURE: "1" });
  assert.equal(result.status, 88, result.stderr);
  assert.match(result.stderr, /mcp_ca_unreadable/);
  assert.doesNotMatch(result.stdout, /guard parity|credential|claim_nonprod/);
});

// Red first: exercise the real existing resolver rather than a new helper API.
test("Windows resolver preserves an explicit missing CA instead of silently trusting a fallback", { skip: process.platform !== "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "dpf-trust-"));
  try {
    mkdirSync(join(home, ".dpf", "pki"), { recursive: true });
    writeFileSync(join(home, ".dpf", "pki", "root_ca.crt"), "fallback");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      '. $env:DPF_TEST_ENV_LIB; $r = Resolve-DpfMcpClientEnv -InstallDir $env:DPF_TEST_HOME -HomeDir $env:DPF_TEST_HOME -GetUserEnv { param($n) "" }; $r | ConvertTo-Json -Compress'], {
      env: { ...process.env, DPF_TEST_HOME: home,
        DPF_TEST_ENV_LIB: fileURLToPath(new URL("../../scripts/installer/lib/mcp-client-env.ps1", import.meta.url)),
        DPF_MCP_URL: "https://localhost/api/mcp/v1", DPF_MCP_CA_FILE: join(home, "missing.pem"),
        DPF_PKI_TRUST_BUNDLE: "", NODE_EXTRA_CA_CERTS: "" }, encoding: "utf8", windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).CaBundle, join(home, "missing.pem"));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

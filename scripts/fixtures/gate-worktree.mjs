import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gitText, runGit } from "../lib/git.mjs";

// Test fixtures only. Every gate writes to a disposable Git directory, never
// the checkout running the suite (BI-53B189C8, BI-BFDB98B6).
const GATE_ARTIFACT_NAME = /^dpf-(local-ci-|sandbox-freshness|pre-admission-)/;
export function callerGateDirectory(cwd = process.cwd()) {
  const result = runGit(["rev-parse", "--git-path", "dpf-local-ci-gate.json"], { cwd });
  return result.ok && result.stdout.trim() ? dirname(resolve(cwd, result.stdout.trim())) : null;
}

export function gateArtifactStamps(directory) {
  const stamps = new Map();
  if (!directory) return stamps;
  let names;
  try { names = readdirSync(directory); } catch { return stamps; }
  for (const name of names) {
    if (!GATE_ARTIFACT_NAME.test(name)) continue;
    try { const stat = statSync(join(directory, name)); stamps.set(name, String(stat.mtimeMs) + ":" + stat.size); }
    catch { /* Concurrent removal is not a fixture write. */ }
  }
  return stamps;
}

export function makeTempWorktree({ pregateScript } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-gate-worktree-"));
  const git = (args) => gitText(args, { cwd: dir });
  git(["init", "-q"]);
  git(["config", "user.name", "DPF Test"]);
  git(["config", "user.email", "dpf-test@example.invalid"]);
  writeFileSync(join(dir, "README.md"), "gate test\n");
  if (pregateScript) {
    // The actual entry's classifier binds to its module's repository root.
    // Copy unchanged source bytes into the fixture rather than override that
    // classifier or accidentally test the caller's empty HEAD diff.
    const sourceRoot = dirname(dirname(pregateScript));
    cpSync(join(sourceRoot, "scripts"), join(dir, "scripts"), { recursive: true });
    cpSync(join(sourceRoot, "packages/dpf-skill-pack/scripts"), join(dir, "packages/dpf-skill-pack/scripts"), { recursive: true });
    for (const manifest of ["apps/web/lib/nonprod/local-ci-slot-resources.json", "config/ci-evidence-policy.json", "config/seed-content-paths.json"]) {
      mkdirSync(dirname(join(dir, manifest)), { recursive: true });
      cpSync(join(sourceRoot, manifest), join(dir, manifest));
    }
    writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true, scripts: { pregate: "node scripts/pregate.mjs" } }));
  }
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  const runtimePath = pregateScript ? "apps/web/lib/console-fixture.ts" : "runtime.mjs";
  mkdirSync(dirname(join(dir, runtimePath)), { recursive: true });
  writeFileSync(join(dir, runtimePath), "export const candidate = true;\n");
  git(["add", runtimePath]);
  git(["commit", "-q", "-m", "runtime candidate"]);
  return dir;
}

export function createGateFixtureTls(directory) {
  const openssl = process.platform === "win32" && existsSync(join(process.env.ProgramFiles || "C:/Program Files", "Git/usr/bin/openssl.exe"))
    ? join(process.env.ProgramFiles || "C:/Program Files", "Git/usr/bin/openssl.exe") : "openssl";
  const key = join(directory, "server.key"), cert = join(directory, "server.crt");
  const minted = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-addext", "basicConstraints=critical,CA:TRUE",
    "-keyout", key, "-out", cert], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (minted.status !== 0) throw new Error("TLS fixtures require OpenSSL: " + (minted.stderr || minted.error));
  return { key, cert, options: { key: readFileSync(key), cert: readFileSync(cert) } };
}

export async function startGateFixtureMcp(resultFor, { tls } = {}) {
  const calls = [];
  const handle = (request, response) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 128 * 1024) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const call = { name: payload.params.name, args: payload.params.arguments };
        calls.push(call);
        const result = resultFor(call, calls);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } }));
      } catch (error) { response.writeHead(500).end(String(error)); }
    });
  };
  const server = tls ? createTlsServer(tls.options, handle) : createServer(handle);
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return {
    calls, url: (tls ? "https://localhost:" : "http://127.0.0.1:") + server.address().port,
    close: () => new Promise(resolveClose => { server.closeAllConnections(); server.close(resolveClose); }),
  };
}

export function isolatedGateFixtureEnvironment(directory, values, ambient = process.env) {
  const allowed = new Set(["systemroot", "windir", "comspec", "pathext", "path"]);
  const env = {};
  for (const [key, value] of Object.entries(ambient)) if (allowed.has(key.toLowerCase())) env[key] = value;
  Object.assign(env, {
    TEMP: directory, TMP: directory, NODE_ENV: "test",
    DPF_MCP_BEARER_TOKEN: "test-token",
    DPF_MCP_CLIENT_CREDENTIALS_FILE: join(directory, "absent-credentials.json"),
    DPF_DURABLE_RESUMER: "off",
    DPF_LOCAL_SANDBOX_FENCE_PATH: join(directory, "fixture-fence.json"),
    DPF_SKIP_PREGATE_PREFLIGHT_REASON: "BI-BFDB98B6 isolated console contract fixture; host guards unrun",
    DPF_LOCAL_CI_HOST_PRESSURE_JSON: JSON.stringify({ observedAt: new Date().toISOString(), availableMemoryBytes: 16 * 1024 ** 3,
      sustainedCpuPercent: 20, diskFreeBytes: 500 * 1024 ** 3, dockerHealthy: true, convergenceActive: false,
      fencesHealthy: true, evidenceIsolationHealthy: true }),
  }, values);
  if (existsSync(env.DPF_MCP_CLIENT_CREDENTIALS_FILE)) throw new Error("Fixture credential path must not exist");
  for (const key of ["CI", "GITHUB_ACTIONS", "DPF_PREGATE_ALLOW_CAPTURE", "DPF_MCP_CLIENT_ID", "DPF_MCP_CLIENT_SECRET", "NODE_OPTIONS"]) {
    if (Object.keys(env).some(candidate => candidate.toLowerCase() === key.toLowerCase())) throw new Error("Ambient override in fixture: " + key);
  }
  return env;
}

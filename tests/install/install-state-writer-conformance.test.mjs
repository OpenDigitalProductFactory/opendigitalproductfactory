import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repo = resolve(import.meta.dirname, "../..");
const bashSource = await readFile(join(repo, "scripts/installer/lib/state.sh"), "utf8");
const psSource = await readFile(join(repo, "scripts/installer/lib/state.ps1"), "utf8");

test("Bash and PowerShell implement the protocol independently of Node", () => {
  assert.doesNotMatch(bashSource, /install-state-transaction\.mjs/);
  assert.doesNotMatch(psSource, /install-state-transaction\.mjs/);
  assert.match(bashSource, /ownerId.*runId|runId.*ownerId/s);
  assert.match(psSource, /ownerId.*runId|runId.*ownerId/is);
});

test("Bash initialization refuses unsupported host identity", async () => {
  assert.match(bashSource, /unsupported.*return 1|return 1.*unsupported/s);
});
const run = (command, args, env) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { cwd: repo, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", c => { stderr += c; });
  child.on("error", reject); child.on("exit", code => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}: ${stderr}`)));
});

test("Node Bash and PowerShell writers preserve every owned property without BOM", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-writer-conformance-"));
  const statePath = join(dir, "install-state.json");
  await writeFile(statePath, '{"schemaVersion":2,"installerVersion":"seed","platform":"win32","arch":"amd64","enabledRuntimeCapabilities":["runtime:core"],"capabilityCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","capabilityStateVersion":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n');
  const node = join(repo, "scripts/installer/install-state-transaction.mjs");
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
  const pwsh = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const env = { DPF_STATE_DIR: dir, HOME: dir };
  const jobs = [];
  for (let i = 0; i < 8; i++) {
    jobs.push(run(process.execPath, [node, "set", "--state", statePath, "--key", "installerVersion", "--value", JSON.stringify(`node${i}`)], env));
    jobs.push(run(bash, ["-lc", `. scripts/installer/lib/state.sh; dpf_state_write lastHealthCheck 2026-07-18T15:00:0${i}Z`], env));
    jobs.push(run(pwsh, ["-NoProfile", "-Command", `. ./scripts/installer/lib/state.ps1; Set-DpfStateValue -Key lastDoctorBundlePath -Value 'ps${i}'`], env));
  }
  try { await Promise.all(jobs); } catch (error) { t.assert.fail(error); }
  const bytes = await readFile(statePath);
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const state = JSON.parse(bytes.toString("utf8"));
  assert.match(state.installerVersion, /^node[0-7]$/);
  assert.match(state.lastHealthCheck, /^2026-07-18T15:00:0[0-7]Z$/);
  assert.match(state.lastDoctorBundlePath, /^ps[0-7]$/);
});

test("concurrent PowerShell initializers converge on one complete BOM-free state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-initializer-conformance-"));
  const pwsh = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const env = { DPF_STATE_DIR: dir, HOME: dir };
  await Promise.all(Array.from({ length: 8 }, (_, i) => run(pwsh, ["-NoProfile", "-Command", `. ./scripts/installer/lib/state.ps1; Initialize-DpfState -InstallerVersion init${i} -InstallPath '${repo.replaceAll("'", "''")}'`], env)));
  const bytes = await readFile(join(dir, "install-state.json"));
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const state = JSON.parse(bytes.toString("utf8"));
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.composeProjectName, "dpf");
  assert.match(state.installerVersion, /^init[0-7]$/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repo = resolve(import.meta.dirname, "../..");
const run = (command, args, env) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { cwd: repo, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", c => { stderr += c; });
  child.on("error", reject); child.on("exit", code => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}: ${stderr}`)));
});

test("Node Bash and PowerShell writers preserve every owned property without BOM", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-writer-conformance-"));
  const statePath = join(dir, "install-state.json");
  await writeFile(statePath, '{"schemaVersion":1,"seed":true}\n');
  const node = join(repo, "scripts/installer/install-state-transaction.mjs");
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
  const pwsh = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const env = { DPF_STATE_DIR: dir, HOME: dir };
  const jobs = [];
  for (let i = 0; i < 8; i++) {
    jobs.push(run(process.execPath, [node, "set", "--state", statePath, "--key", `node${i}`, "--value", JSON.stringify(i)], env));
    jobs.push(run(bash, ["-lc", `. scripts/installer/lib/state.sh; dpf_state_write bash${i} ${i}`], env));
    jobs.push(run(pwsh, ["-NoProfile", "-Command", `. ./scripts/installer/lib/state.ps1; Set-DpfStateValue -Key ps${i} -Value ${i}`], env));
  }
  try { await Promise.all(jobs); } catch (error) { t.assert.fail(error); }
  const bytes = await readFile(statePath);
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const state = JSON.parse(bytes.toString("utf8"));
  for (let i = 0; i < 8; i++) {
    assert.equal(state[`node${i}`], i); assert.equal(state[`bash${i}`], i); assert.equal(state[`ps${i}`], i);
  }
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

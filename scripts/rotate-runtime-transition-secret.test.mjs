import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("./rotate-runtime-transition-secret.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const run = (stateDir, ...args) => spawnSync(process.execPath, [script, "--state-dir", stateDir, ...args], { encoding: "utf8" });

test("creates a cryptographically random owner-only secret", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  const result = run(dir, "--initialize");
  assert.equal(result.status, 0, result.stderr);
  assert.match((await readFile(join(dir, "runtime-transition.secret"), "utf8")).trim(), /^[a-f0-9]{64}$/);
  if (process.platform !== "win32") assert.equal((await stat(join(dir, "runtime-transition.secret"))).mode & 0o777, 0o600);
});

test("rotation fails closed while a transition claim is active", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  assert.equal(run(dir, "--initialize").status, 0);
  const transitions = join(dir, "runtime-capability-transitions");
  await mkdir(join(transitions, "RCT-live.json.claim"), { recursive: true });
  const before = await readFile(join(dir, "runtime-transition.secret"), "utf8");
  const result = run(dir, "--rotate");
  assert.equal(result.status, 75);
  assert.match(result.stderr, /transition_in_progress/);
  assert.equal(await readFile(join(dir, "runtime-transition.secret"), "utf8"), before);
});

test("rotation fails closed while the host apply lock is held", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  assert.equal(run(dir, "--initialize").status, 0);
  await mkdir(join(dir, ".runtime-transition-apply.lock"));
  await writeFile(join(dir, ".runtime-transition-apply.lock", "expires-at"), new Date(Date.now() + 60_000).toISOString());
  const result = run(dir, "--rotate");
  assert.equal(result.status, 75);
  assert.match(result.stderr, /transition_in_progress/);
});

test("rotation fails closed while durable transition authority is reserved before DB pending", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  assert.equal(run(dir, "--initialize").status, 0);
  await writeFile(join(dir, "runtime-transition-authority.json"), JSON.stringify({ transitionId: "RCT-before-db" }));
  const result = run(dir, "--rotate");
  assert.equal(result.status, 75);
  assert.match(result.stderr, /transition_in_progress/);
});

test("rotation archives the old key with its receipts and installs a new key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  assert.equal(run(dir, "--initialize").status, 0);
  const old = await readFile(join(dir, "runtime-transition.secret"), "utf8");
  const transitions = join(dir, "runtime-capability-transitions");
  await mkdir(transitions);
  await writeFile(join(transitions, "RCT-done.json"), "{}\n");
  const result = run(dir, "--rotate");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const next = await readFile(join(dir, "runtime-transition.secret"), "utf8");
  assert.notEqual(next, old);
  assert.equal(await readFile(join(output.archiveDir, "runtime-transition.secret"), "utf8"), old);
  assert.equal(await readFile(join(output.archiveDir, "runtime-capability-transitions", "RCT-done.json"), "utf8"), "{}\n");
});

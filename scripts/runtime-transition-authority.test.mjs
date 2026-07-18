import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("./runtime-transition-authority.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const run = (dir, args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, DPF_STATE_DIR: dir, ...env } });

test("same transition id cannot acquire concurrent authority", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-authority-"));
  const first = run(dir, ["reserve", "RCT-1"]); assert.equal(first.status, 0, first.stderr);
  const lease = JSON.parse(await readFile(join(dir, "runtime-transition-authority.json"), "utf8"));
  assert.match(lease.ownershipToken, /^[a-f0-9]{64}$/); assert.ok(Date.parse(lease.expiresAt) > Date.now());
  assert.equal(run(dir, ["reserve", "RCT-1"]).status, 75);
});

test("release requires the opaque ownership token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-authority-"));
  const token = JSON.parse(run(dir, ["reserve", "RCT-1"]).stdout).ownershipToken;
  assert.equal(run(dir, ["release", "RCT-1", "0".repeat(64)]).status, 75);
  assert.equal(run(dir, ["release", "RCT-1", token]).status, 0);
});

test("startup recovers only an expired orphan after DB cross-check", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-authority-"));
  const path = join(dir, "runtime-transition-authority.json");
  await writeFile(path, JSON.stringify({ version: 1, transitionId: "RCT-crash", ownershipToken: "a".repeat(64), acquiredAt: new Date(0).toISOString(), expiresAt: new Date(1).toISOString() }));
  const bound = run(dir, ["reconcile"], { DPF_ACTIVE_RUNTIME_TRANSITION_IDS: "RCT-crash" });
  assert.equal(bound.status, 0, bound.stderr); assert.equal(JSON.parse(bound.stdout).status, "bound");
  await writeFile(path, JSON.stringify({ version: 1, transitionId: "RCT-crash", ownershipToken: "a".repeat(64), acquiredAt: new Date(0).toISOString(), expiresAt: new Date(1).toISOString() }));
  const recovered = run(dir, ["reconcile"], { DPF_ACTIVE_RUNTIME_TRANSITION_IDS: "" });
  assert.equal(recovered.status, 0, recovered.stderr); assert.equal(JSON.parse(recovered.stdout).status, "recovered");
});

test("startup preserves an unexpired marker with no DB row", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-authority-"));
  assert.equal(run(dir, ["reserve", "RCT-before-db"]).status, 0);
  assert.equal(run(dir, ["reconcile"], { DPF_ACTIVE_RUNTIME_TRANSITION_IDS: "" }).status, 75);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("./runtime-transition-authority.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const run = (dir, operation, id) => spawnSync(process.execPath, [script, operation, id], { encoding: "utf8", env: { ...process.env, DPF_STATE_DIR: dir } });

test("reserves durable host authority before a database transition may be created", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-authority-"));
  const result = run(dir, "reserve", "RCT-1");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "runtime-transition-authority.json"), "utf8")), { transitionId: "RCT-1" });
});

test("reservation is idempotent only for the same transition and release is ownership checked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-authority-"));
  assert.equal(run(dir, "reserve", "RCT-1").status, 0);
  assert.equal(run(dir, "reserve", "RCT-1").status, 0);
  assert.equal(run(dir, "reserve", "RCT-2").status, 75);
  assert.equal(run(dir, "release", "RCT-2").status, 75);
  assert.equal(run(dir, "release", "RCT-1").status, 0);
});

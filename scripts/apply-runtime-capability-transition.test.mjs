import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";

const script = new URL("./apply-runtime-capability-transition.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const canonical = (v) => JSON.stringify(v, Object.keys(v).sort());
const secret = "s".repeat(32);
function envelope(now = Date.now()) { return { version: 1, transitionId: "RCT-test", issuedAt: new Date(now - 100).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), catalogHash: "a".repeat(64), previousStateHash: "b".repeat(64), desiredStateHash: "c".repeat(64), previousKeys: ["runtime:core"], desiredKeys: ["runtime:build", "runtime:core"] }; }
function run(env) { return spawnSync(process.execPath, [script], { env: { ...process.env, ...env }, encoding: "utf8" }); }

test("rejects a tampered transition envelope before reading state", () => {
  const value = envelope();
  const result = run({ DPF_RUNTIME_TRANSITION_SECRET: secret, DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: "0".repeat(64), DPF_STATE_DIR: join(tmpdir(), "missing") });
  assert.equal(result.status, 78); assert.match(result.stderr, /tampered_envelope/);
});

test("rejects expired signed envelopes", () => {
  const value = envelope(0); const signature = createHmac("sha256", secret).update(canonical(value)).digest("hex");
  const result = run({ DPF_RUNTIME_TRANSITION_SECRET: secret, DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature });
  assert.equal(result.status, 78); assert.match(result.stderr, /expired_or_invalid_envelope/);
});

test("fails closed on stale install state without invoking compose", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-"));
  await writeFile(join(dir, "install-state.json"), JSON.stringify({ schemaVersion: 1, capabilityCatalogHash: "f".repeat(64), capabilityStateVersion: "b".repeat(64) }));
  const value = envelope(); const signature = createHmac("sha256", secret).update(canonical(value)).digest("hex");
  const result = run({ DPF_RUNTIME_TRANSITION_SECRET: secret, DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature, DPF_STATE_DIR: dir, PROMOTE_COMPOSE_PROJECT: "dpf" });
  assert.equal(result.status, 78); assert.match(result.stderr, /install_state_stale/);
  assert.equal(JSON.parse(await readFile(join(dir, "install-state.json"), "utf8")).capabilityCatalogHash, "f".repeat(64));
});

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
function envelope(now = Date.now()) { return { version: 1, transitionId: "RCT-test", issuedAt: new Date(now - 100).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), catalogHash: "a".repeat(64), previousStateHash: "b".repeat(64), desiredStateHash: "c".repeat(64), previousKeys: ["runtime:core"], desiredKeys: ["runtime:build", "runtime:core"], previousProfiles: [], desiredProfiles: ["build"] }; }
function run(env, id = "RCT-test") { return spawnSync(process.execPath, [script, "--runtime-capability-transition", id], { env: { ...process.env, ...env }, encoding: "utf8" }); }
async function secretFile(dir) { const path = join(dir, "secret"); await writeFile(path, secret, { mode: 0o600 }); return path; }

test("rejects a tampered transition envelope before reading state", async () => {
  const value = envelope();
  const dir = await mkdtemp(join(tmpdir(), "dpf-secret-")); const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: "0".repeat(64), DPF_STATE_DIR: join(tmpdir(), "missing") });
  assert.equal(result.status, 78); assert.match(result.stderr, /tampered_envelope/);
});

test("rejects expired signed envelopes", async () => {
  const value = envelope(0); const signature = createHmac("sha256", secret).update(canonical(value)).digest("hex");
  const dir = await mkdtemp(join(tmpdir(), "dpf-secret-")); const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature });
  assert.equal(result.status, 78); assert.match(result.stderr, /expired_or_invalid_envelope/);
});

test("fails closed before mutation when the signed catalog projection is unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-"));
  await writeFile(join(dir, "install-state.json"), JSON.stringify({ schemaVersion: 1, capabilityCatalogHash: "f".repeat(64), capabilityStateVersion: "b".repeat(64) }));
  const value = envelope(); const signature = createHmac("sha256", secret).update(canonical(value)).digest("hex");
  const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature, DPF_STATE_DIR: dir, PROMOTE_COMPOSE_PROJECT: "dpf" });
  assert.equal(result.status, 78); assert.match(result.stderr, /capability_catalog_unreadable/);
  assert.equal(JSON.parse(await readFile(join(dir, "install-state.json"), "utf8")).capabilityCatalogHash, "f".repeat(64));
});

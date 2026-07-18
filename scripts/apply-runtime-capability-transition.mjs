#!/usr/bin/env node
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const canonical = (v) => JSON.stringify(v, Object.keys(v).sort());
const sign = (v, secret) => createHmac("sha256", secret).update(canonical(v)).digest("hex");
const fail = (reason, code = 78) => { process.stderr.write(JSON.stringify({ status: "failed", failure: reason }) + "\n"); process.exit(code); };

const stateDir = process.env.DPF_STATE_DIR ?? "/dpf-state";
const secret = process.env.DPF_RUNTIME_TRANSITION_SECRET ?? "";
const encoded = process.env.DPF_RUNTIME_TRANSITION_ENVELOPE ?? "";
const signature = process.env.DPF_RUNTIME_TRANSITION_SIGNATURE ?? "";
if (secret.length < 32 || !encoded || !/^[a-f0-9]{64}$/.test(signature)) fail("invalid_signed_envelope");
let envelope;
try { envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { fail("invalid_signed_envelope"); }
const expected = sign(envelope, secret);
if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) fail("tampered_envelope");
if (!/^RCT-[A-Za-z0-9-]{1,48}$/.test(envelope.transitionId) || Date.parse(envelope.expiresAt) < Date.now() || Date.parse(envelope.issuedAt) > Date.now() + 30_000) fail("expired_or_invalid_envelope");
for (const k of ["catalogHash", "previousStateHash", "desiredStateHash"]) if (!/^[a-f0-9]{64}$/.test(envelope[k])) fail("invalid_envelope_hash");
for (const k of ["previousKeys", "desiredKeys"]) if (!Array.isArray(envelope[k]) || JSON.stringify(envelope[k]) !== JSON.stringify([...new Set(envelope[k])].sort()) || envelope[k].some((x) => !/^runtime:[a-z0-9-]+$/.test(x))) fail("invalid_envelope_keys");

const receiptDir = join(stateDir, "runtime-capability-transitions");
const receiptPath = join(receiptDir, `${envelope.transitionId}.json`);
await mkdir(receiptDir, { recursive: true });
try {
  const existing = JSON.parse(await readFile(receiptPath, "utf8"));
  const { signature: existingSignature, ...existingUnsigned } = existing;
  const existingExpected = sign(existingUnsigned, secret);
  if (/^[a-f0-9]{64}$/.test(existingSignature ?? "") && timingSafeEqual(Buffer.from(existingSignature), Buffer.from(existingExpected)) &&
      existing.transitionId === envelope.transitionId && existing.catalogHash === envelope.catalogHash && existing.previousStateHash === envelope.previousStateHash && existing.desiredStateHash === envelope.desiredStateHash &&
      JSON.stringify(existing.previousKeys) === JSON.stringify(envelope.previousKeys) && JSON.stringify(existing.desiredKeys) === JSON.stringify(envelope.desiredKeys)) {
    process.stdout.write(JSON.stringify(existing) + "\n"); process.exit(0);
  }
  fail("replayed_transition_id");
} catch (e) { if (e?.code !== "ENOENT") fail("invalid_existing_receipt"); }

const statePath = join(stateDir, "install-state.json");
let before;
try { before = JSON.parse(await readFile(statePath, "utf8")); } catch { fail("install_state_unreadable"); }
if (!Number.isInteger(before.schemaVersion) || before.capabilityCatalogHash !== envelope.catalogHash || before.capabilityStateVersion !== envelope.previousStateHash) fail("install_state_stale");
const next = { ...before, enabledRuntimeCapabilities: envelope.desiredKeys, capabilityCatalogHash: envelope.catalogHash, capabilityStateVersion: envelope.desiredStateHash };
const temp = `${statePath}.${envelope.transitionId}.tmp`;
await writeFile(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
await rename(temp, statePath);
const files = String(process.env.PROMOTE_COMPOSE_FILES ?? "docker-compose.yml").split(/\s+/).filter(Boolean);
if (files.length === 0 || files.some((file) => !/^[A-Za-z0-9._-]+$/.test(file))) fail("invalid_compose_files");
const project = process.env.PROMOTE_COMPOSE_PROJECT;
if (!project || !/^[a-z0-9][a-z0-9_-]*$/.test(project)) fail("invalid_compose_project");
const args = ["compose", "--project-name", project];
for (const file of files) args.push("-f", join("/host-source", file));
if (process.env.PROMOTE_COMPOSE_ENV_FILE) args.push("--env-file", process.env.PROMOTE_COMPOSE_ENV_FILE);
const profiles = String(process.env.DPF_RUNTIME_TRANSITION_PROFILES ?? "").split(/\s+/).filter(Boolean).sort();
for (const profile of profiles) args.push("--profile", profile);
args.push("up", "-d", "--remove-orphans");
const applied = spawnSync("docker", args, { encoding: "utf8", timeout: 9 * 60 * 1000 });
if (applied.status !== 0) { await writeFile(`${statePath}.restore.tmp`, JSON.stringify(before, null, 2) + "\n", { mode: 0o600 }); await rename(`${statePath}.restore.tmp`, statePath); fail("compose_reconcile_failed"); }
const ps = spawnSync("docker", [...args.slice(0, -3), "ps", "--services", "--status", "running"], { encoding: "utf8", timeout: 30_000 });
const unsigned = { ...envelope, status: "applied", observedServices: String(ps.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).sort(), completedAt: new Date().toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.desiredStateHash };
const receipt = { ...unsigned, signature: sign(unsigned, secret) };
const receiptTemp = `${receiptPath}.tmp`;
await writeFile(receiptTemp, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
await rename(receiptTemp, receiptPath);
process.stdout.write(JSON.stringify(receipt) + "\n");

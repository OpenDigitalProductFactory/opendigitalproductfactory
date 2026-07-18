#!/usr/bin/env node
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const canonical = (v) => JSON.stringify(v, Object.keys(v).sort());
const catalogBytes = (v) => `${JSON.stringify(stable(v), null, 2)}\n`;
const sha = (v) => createHash("sha256").update(v).digest("hex");
const sign = (v, secret) => createHmac("sha256", secret).update(canonical(v)).digest("hex");
const stateDir = process.env.DPF_STATE_DIR ?? "/dpf-state";
const receiptDir = join(stateDir, "runtime-capability-transitions");
let secret = ""; let envelope;
const writeReceipt = async (status, failure, observedServices = []) => {
  if (!envelope || secret.length < 32) return;
  const unsigned = { ...envelope, status, observedServices: [...observedServices].sort(), completedAt: new Date().toISOString(), beforeHash: envelope.previousStateHash, afterHash: status === "applied" ? envelope.desiredStateHash : envelope.previousStateHash, ...(failure ? { failure } : {}) };
  await mkdir(receiptDir, { recursive: true });
  const target = join(receiptDir, `${envelope.transitionId}.json`);
  await writeFile(`${target}.tmp`, JSON.stringify({ ...unsigned, signature: sign(unsigned, secret) }, null, 2) + "\n", { mode: 0o600 });
  await rename(`${target}.tmp`, target);
};
const fail = async (reason, status = "failed", code = 78) => { await writeReceipt(status, reason); process.stderr.write(JSON.stringify({ status, failure: reason }) + "\n"); process.exit(code); };

const argvId = process.argv[2] === "--runtime-capability-transition" ? process.argv[3] : "";
try { secret = (await readFile(process.env.DPF_RUNTIME_TRANSITION_SECRET_FILE ?? "/run/secrets/dpf-runtime-transition", "utf8")).trim(); } catch { await fail("transition_secret_unreadable"); }
const encoded = process.env.DPF_RUNTIME_TRANSITION_ENVELOPE ?? "";
const signature = process.env.DPF_RUNTIME_TRANSITION_SIGNATURE ?? "";
if (secret.length < 32 || !encoded || !/^[a-f0-9]{64}$/.test(signature)) await fail("invalid_signed_envelope");
try { envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { await fail("invalid_signed_envelope"); }
const expected = sign(envelope, secret);
if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) await fail("tampered_envelope");
const issued = Date.parse(envelope.issuedAt), expires = Date.parse(envelope.expiresAt), now = Date.now();
if (envelope.version !== 1 || argvId !== envelope.transitionId || !/^RCT-[A-Za-z0-9-]{1,48}$/.test(envelope.transitionId) || !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 30_000 || expires < now || expires - issued > 600_000) await fail("expired_or_invalid_envelope");
for (const k of ["catalogHash", "previousStateHash", "desiredStateHash"]) if (!/^[a-f0-9]{64}$/.test(envelope[k])) await fail("invalid_envelope_hash");
for (const k of ["previousKeys", "desiredKeys", "previousProfiles", "desiredProfiles"]) if (!Array.isArray(envelope[k]) || JSON.stringify(envelope[k]) !== JSON.stringify([...new Set(envelope[k])].sort()) || envelope[k].some((x) => typeof x !== "string" || (k.endsWith("Keys") ? !/^runtime:[a-z0-9-]+$/.test(x) : !/^[a-z0-9][a-z0-9-]*$/.test(x)))) await fail("invalid_envelope_projection");

await mkdir(receiptDir, { recursive: true });
const receiptPath = join(receiptDir, `${envelope.transitionId}.json`);
try {
  const existing = JSON.parse(await readFile(receiptPath, "utf8")); const { signature: sig, ...unsigned } = existing;
  if (/^[a-f0-9]{64}$/.test(sig ?? "") && timingSafeEqual(Buffer.from(sig), Buffer.from(sign(unsigned, secret))) && canonical({ ...envelope }) === canonical(Object.fromEntries(Object.keys(envelope).map((k) => [k, existing[k]])))) { process.stdout.write(JSON.stringify(existing) + "\n"); process.exit(existing.status === "applied" ? 0 : 78); }
  await fail("replayed_transition_id");
} catch (e) { if (e?.code !== "ENOENT") await fail("invalid_existing_receipt"); }
const claim = `${receiptPath}.claim`;
try { await mkdir(claim); } catch { await fail("transition_already_claimed"); }

const catalogPath = process.env.DPF_CAPABILITY_CATALOG_PATH ?? "/host-source/scripts/capability-service-catalog.generated.json";
let catalog;
try { catalog = JSON.parse(await readFile(catalogPath, "utf8")); } catch { await fail("capability_catalog_unreadable"); }
const { catalogHash, ...catalogContent } = catalog;
if (catalogHash !== envelope.catalogHash || sha(catalogBytes(catalogContent)) !== catalogHash) await fail("capability_catalog_mismatch");
const byId = new Map(catalog.capabilities.map((c) => [c.capabilityId, c]));
const project = (keys) => { const enabled = new Set(); const add = (id) => { const c = byId.get(id); if (!c) throw new Error(`unknown_runtime_capability:${id}`); if (enabled.has(id)) return; for (const d of c.dependencies) add(d); enabled.add(id); }; for (const k of keys) add(k); for (const c of catalog.capabilities) if (c.activationPolicy === "always") add(c.capabilityId); const enabledKeys = [...enabled].sort(); const services = catalog.capabilities.filter((c) => enabled.has(c.capabilityId)).flatMap((c) => c.services).filter((s) => s.targetClassification !== "ephemeral-lifecycle"); return { enabledKeys, profiles: [...new Set(services.flatMap((s) => s.profiles))].sort(), required: [...new Set(services.map((s) => s.service))].sort(), stateHash: sha(`${catalogHash}\n${catalog.capabilities.map((c) => `${c.capabilityId}=${enabled.has(c.capabilityId) ? "active" : "disabled"}`).sort().join("\n")}`) }; };
let previous, desired; try { previous = project(envelope.previousKeys); desired = project(envelope.desiredKeys); } catch (e) { await fail(e.message); }
if (canonical(previous.enabledKeys) !== canonical(envelope.previousKeys) || canonical(desired.enabledKeys) !== canonical(envelope.desiredKeys) || canonical(previous.profiles) !== canonical(envelope.previousProfiles) || canonical(desired.profiles) !== canonical(envelope.desiredProfiles) || previous.stateHash !== envelope.previousStateHash || desired.stateHash !== envelope.desiredStateHash) await fail("capability_projection_mismatch");

const statePath = join(stateDir, "install-state.json"); let before;
try { before = JSON.parse(await readFile(statePath, "utf8")); } catch { await fail("install_state_unreadable"); }
const requiredState = ["schemaVersion", "installerVersion", "platform", "arch"];
if (!before || typeof before !== "object" || Array.isArray(before) || requiredState.some((k) => before[k] === undefined) || !Number.isInteger(before.schemaVersion) || typeof before.installerVersion !== "string" || !["darwin", "linux", "win32"].includes(before.platform) || !["arm64", "amd64", "x86_64"].includes(before.arch) || before.capabilityCatalogHash !== envelope.catalogHash || before.capabilityStateVersion !== envelope.previousStateHash || canonical(before.enabledRuntimeCapabilities) !== canonical(envelope.previousKeys)) await fail("install_state_stale");
const files = String(process.env.PROMOTE_COMPOSE_FILES ?? "docker-compose.yml").split(/\s+/).filter(Boolean); const composeProject = process.env.PROMOTE_COMPOSE_PROJECT;
if (!composeProject || !/^[a-z0-9][a-z0-9_-]*$/.test(composeProject) || files.length === 0 || files.some((f) => !/^[A-Za-z0-9._-]+$/.test(f))) await fail("invalid_compose_configuration");
const baseArgs = ["compose", "--project-name", composeProject]; for (const f of files) baseArgs.push("-f", join("/host-source", f)); if (process.env.PROMOTE_COMPOSE_ENV_FILE) baseArgs.push("--env-file", process.env.PROMOTE_COMPOSE_ENV_FILE);
const reconcile = (profiles) => { const args = [...baseArgs]; for (const p of profiles) args.push("--profile", p); return spawnSync("docker", [...args, "up", "-d", "--remove-orphans"], { encoding: "utf8", timeout: 9 * 60 * 1000 }); };
const next = { ...before, enabledRuntimeCapabilities: desired.enabledKeys, capabilityCatalogHash: catalogHash, capabilityStateVersion: desired.stateHash };
await writeFile(`${statePath}.${envelope.transitionId}.tmp`, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 }); await rename(`${statePath}.${envelope.transitionId}.tmp`, statePath);
const applied = reconcile(desired.profiles);
if (applied.status !== 0) { await writeFile(`${statePath}.restore.tmp`, JSON.stringify(before, null, 2) + "\n", { mode: 0o600 }); await rename(`${statePath}.restore.tmp`, statePath); const rolled = reconcile(previous.profiles); await rm(claim, { recursive: true, force: true }); await fail(rolled.status === 0 ? "compose_reconcile_failed_rolled_back" : "compose_reconcile_failed_rollback_failed", rolled.status === 0 ? "failed" : "rollback_failed"); }
const ps = spawnSync("docker", [...baseArgs, "ps", "--services", "--status", "running"], { encoding: "utf8", timeout: 30_000 });
const observed = String(ps.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).sort();
if (ps.status !== 0 || desired.required.some((s) => !observed.includes(s))) { await writeFile(`${statePath}.restore.tmp`, JSON.stringify(before, null, 2) + "\n", { mode: 0o600 }); await rename(`${statePath}.restore.tmp`, statePath); const rolled = reconcile(previous.profiles); await rm(claim, { recursive: true, force: true }); await fail(rolled.status === 0 ? "required_health_failed_rolled_back" : "required_health_failed_rollback_failed", rolled.status === 0 ? "failed" : "rollback_failed"); }
await writeReceipt("applied", undefined, observed); await rm(claim, { recursive: true, force: true }); process.stdout.write(await readFile(receiptPath, "utf8"));

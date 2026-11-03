import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from './lib/canonical-json.mjs';
import { signMaintenanceEpoch, verifyMaintenanceEpoch } from './lib/maintenance-epoch-receipt.mjs';
import { readMigrationSecret } from './promoter-migration-envelope.mjs';
import { isEntryModule } from './lib/entry-module.mjs';
import { scriptArgv } from './lib/script-argv.mjs';

import { observeMaintenanceEnvironments } from "./lib/maintenance-epoch-receipt.mjs";
export { observeMaintenanceEnvironments } from "./lib/maintenance-epoch-receipt.mjs";

const exec = promisify(execFile);
const SERVICES = ['portal', 'sandbox'];
const invalid = () => { throw new Error('maintenance_epoch_observation_unavailable'); };


export async function captureMaintenanceEpoch({ secret, runDocker, now, ...identity }) {
  const observed = await observeMaintenanceEnvironments({ project: identity.project, runDocker });
  const observedAt = now ?? new Date();
  const payload = { schemaVersion: 1, ...identity, daemonId: observed.daemonId, capturedAt: observedAt.toISOString(), before: observed.environments };
  const envelope = signMaintenanceEpoch(payload, secret, true);
  verifyMaintenanceEpoch(envelope, secret, { ...identity, now: observedAt.getTime() }, true);
  return envelope;
}

export async function finishMaintenanceEpoch({ baseline, secret, expected, runDocker, now }) {
  const before = verifyMaintenanceEpoch(baseline, secret, { ...expected, now: (now ?? new Date()).getTime() }, true);
  const observed = await observeMaintenanceEnvironments({ project: before.project, runDocker });
  const retiredContainerIds = SERVICES.map(service => before.before[service].id).sort();
  if (observed.daemonId !== before.daemonId || retiredContainerIds.some(id => observed.inventory.includes(id))) invalid();
  const observedAt = now ?? new Date();
  const payload = { ...before, completedAt: observedAt.toISOString(), after: observed.environments,
    retiredContainerIds, inventoryDigest: createHash('sha256').update(canonicalJson(observed.inventory)).digest('hex') };
  const envelope = signMaintenanceEpoch(payload, secret);
  verifyMaintenanceEpoch(envelope, secret, { ...expected, now: observedAt.getTime() });
  return envelope;
}

export async function runEpochDocker(args) {
  const { stdout } = await exec('docker', args, { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
  return stdout;
}

/** A scoped packaged-writer proof of the actual immutable portal image.
 * No mounts, network, credentials or deployment effects are exposed to the probe. */
export async function inspectScopeEpochWriterImage({ image, expectedSource = '', runDocker = runEpochDocker }) {
  const config = (await runDocker(['image', 'inspect', image, '--format', '{{.Id}}'])).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(config)) throw new Error('scope_writer_image_unproven');
  const name = `dpf-scope-writer-probe-${randomUUID()}`;
  let bytes;
  try {
    bytes = await runDocker(['run', '--rm', '--read-only', '--name', name, '--network', 'none', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '1', '--pids-limit', '64', '--pull', 'never',
      '--entrypoint', 'node', config, '/app/apps/web-src/lib/work-capsules/scope-epoch-writer-probe.mjs']);
  } catch {
    try { await runDocker(['rm', '-f', name]); } catch { /* Only this observation's own container. */ }
    throw new Error('scope_writer_image_unproven');
  }
  try {
    const proof = JSON.parse(bytes), hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    if (Buffer.byteLength(bytes) > 8192 || !proof || Object.keys(proof).length !== 6 || proof.schemaVersion !== 1 || proof.version !== 1
      || !/^[a-f0-9]{40}$/.test(proof.sourceSha ?? '') || (expectedSource && proof.sourceSha !== expectedSource)
      || !hash(proof.sourceContentHash) || !hash(proof.contractSha256) || !proof.writers || typeof proof.writers !== 'object'
      || Array.isArray(proof.writers) || !Object.keys(proof.writers).length || Object.values(proof.writers).some(value => !hash(value))) throw new Error();
  } catch { throw new Error('scope_writer_image_unproven'); }
  if ((await runDocker(['image', 'inspect', image, '--format', '{{.Id}}'])).trim() !== config) throw new Error('scope_writer_image_moved');
  return config;
}

/** Legacy classification is positive absence, never a generic failed probe.
 * The caller must first verify the actual baseline's existing source contract.
 * Initial enrollment excludes every rollback-capable actuator until it exits;
 * continuing caller/portal floors make later baselines scope-aware. */
export async function classifyInitialScopeEpochFallback({ image, runDocker = runEpochDocker }) {
  try { return { kind: 'compatible', image: await inspectScopeEpochWriterImage({ image, runDocker }) }; }
  catch {
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('scope_writer_fallback_unproven');
    const name = `dpf-scope-legacy-probe-${randomUUID()}`;
    const script = `const fs=require('node:fs');const absent=p=>{try{fs.lstatSync(p);return false}catch(e){if(e.code==='ENOENT')return true;throw e}};try{if(!absent('/app/apps/web-src/lib/work-capsules/scope-epoch-contract.ts')||!absent('/app/apps/web-src/lib/work-capsules/scope-epoch-writer-probe.mjs'))process.exit(78);process.stdout.write('legacy-scope-epoch-absent')}catch{process.exit(78)}`;
    let output;
    try { output = await runDocker(['run', '--rm', '--read-only', '--name', name, '--network', 'none', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '1', '--pids-limit', '64', '--pull', 'never',
      '--entrypoint', 'node', image, '--eval', script]); }
    catch {
      try { await runDocker(['rm', '-f', name]); } catch { /* Own probe only. */ }
      throw new Error('scope_writer_fallback_unproven');
    }
    if (output.trim() !== 'legacy-scope-epoch-absent') throw new Error('scope_writer_fallback_unproven');
    return { kind: 'initial-legacy', image };
  }
}

async function readOptional(path) {
  try { return await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeOnce(path, bytes) {
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== bytes) throw error; }
}

/** Called only around the existing canonical swap, never a maintenance actuator. */
export async function persistMaintenanceEpoch({ phase, env = process.env, secret, runDocker = runEpochDocker, now }) {
  if (!['capture', 'finish'].includes(phase)) invalid();
  const identity = { runId: env.DPF_SELF_UPGRADE_RUN_ID, targetSha: env.PROMOTE_TARGET_SHA,
    promoterDigest: env.DPF_PROMOTER_DIGEST, recoveryPointDigest: env.DPF_MAINTENANCE_RECOVERY_POINT_DIGEST,
    project: env.PROMOTE_COMPOSE_PROJECT };
  if (!/^SUR-[A-Za-z0-9-]{1,100}$/.test(identity.runId ?? '') || !/^[a-f0-9]{40}$/.test(identity.targetSha ?? '')
    || !/^sha256:[a-f0-9]{64}$/.test(identity.promoterDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(identity.recoveryPointDigest ?? '')
    || !isAbsolute(env.PROMOTE_BACKUP_PATH ?? '') || !isAbsolute(env.DPF_PROMOTER_STATE_DIR ?? '/dpf-state')) invalid();
  const key = secret ?? await readMigrationSecret({ env });
  const checkpointPath = join(env.PROMOTE_BACKUP_PATH, 'maintenance-epoch-checkpoint.json');
  const bytes = await readOptional(checkpointPath);
  if (phase === 'capture') {
    if (bytes) {
      verifyMaintenanceEpoch(JSON.parse(bytes), key, { ...identity, now: (now ?? new Date()).getTime() }, true);
      return;
    }
    const baseline = await captureMaintenanceEpoch({ ...identity, secret: key, runDocker, now });
    await writeOnce(checkpointPath, JSON.stringify(baseline));
    return;
  }
  if (!bytes) invalid();
  const finalPath = join(env.PROMOTE_BACKUP_PATH, 'maintenance-epoch-retirement.json');
  const prior = await readOptional(finalPath);
  const receipt = prior ? JSON.parse(prior)
    : await finishMaintenanceEpoch({ baseline: JSON.parse(bytes), secret: key, expected: identity, runDocker, now });
  verifyMaintenanceEpoch(receipt, key, { ...identity, now: (now ?? new Date()).getTime() });
  const finalBytes = JSON.stringify(receipt);
  await writeOnce(finalPath, finalBytes);
  const pointer = join(env.DPF_PROMOTER_STATE_DIR ?? '/dpf-state', 'maintenance-epoch-retirement.json');
  if (pointer === finalPath) return;
  const temporary = `${pointer}.${randomUUID()}.tmp`;
  await writeFile(temporary, finalBytes, { flag: 'wx', mode: 0o600 });
  await rename(temporary, pointer);
}

if (isEntryModule(import.meta.url)) {
  try {
    const { values } = parseArgs({ args: scriptArgv(), options: { phase: { type: 'string' }, image: { type: 'string' }, source: { type: 'string' } }, allowPositionals: false });
    if (values.phase === 'scope-image') process.stdout.write(`${await inspectScopeEpochWriterImage({ image: values.image, expectedSource: values.source })}\n`);
    else if (values.phase === 'scope-fallback') process.stdout.write(`${JSON.stringify(await classifyInitialScopeEpochFallback({ image: values.image }))}\n`);
    else await persistMaintenanceEpoch({ phase: values.phase });
  } catch {
    // No raw daemon errors, paths, payloads or secrets in the promoter log.
    process.stderr.write('maintenance_epoch_evidence_unavailable\n');
    process.exitCode = 78;
  }
}

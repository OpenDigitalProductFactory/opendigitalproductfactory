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

const exec = promisify(execFile);
const SERVICES = ['portal', 'sandbox'];
const INSPECT_TEMPLATE = '{"Id":{{json .Id}},"State":{"Running":{{json .State.Running}},"StartedAt":{{json .State.StartedAt}}},"Config":{"Labels":{{json .Config.Labels}}}}';
const invalid = () => { throw new Error('maintenance_epoch_observation_unavailable'); };

/** Read-only observer. It never starts, stops, signals or removes a container. */
export async function observeMaintenanceEnvironments({ project, runDocker }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(project)) invalid();
  const daemonId = (await runDocker(['info', '--format', '{{.ID}}'])).trim();
  const inventory = (await runDocker(['ps', '--all', '--no-trunc', '--format', '{{.ID}}'])).trim().split(/\r?\n/).filter(Boolean);
  if (!inventory.length || inventory.length > 10_000 || inventory.some(id => !/^[a-f0-9]{64}$/.test(id))
    || new Set(inventory).size !== inventory.length) invalid();
  const environments = {};
  // Inspect only this project's candidate services; inventory remains complete
  // for proving removal. Do not load Docker Config.Env or other secret fields.
  const projectIds = (await runDocker(['ps', '--all', '--no-trunc', '--filter', `label=com.docker.compose.project=${project}`,
    '--format', '{{.ID}}'])).trim().split(/\r?\n/).filter(Boolean);
  for (const id of projectIds) {
    if (!inventory.includes(id)) invalid();
    const raw = await runDocker(['inspect', '--type', 'container', '--format', INSPECT_TEMPLATE, id]);
    // The executable prints a bounded JSON projection (not the environment).
    let inspected;
    try { inspected = JSON.parse(raw); } catch { invalid(); }
    const service = inspected.Config?.Labels?.['com.docker.compose.service'];
    if (!SERVICES.includes(service)) continue;
    if (environments[service] || inspected.Id !== id || inspected.State?.Running !== true
      || inspected.Config.Labels['com.docker.compose.project'] !== project) invalid();
    environments[service] = { id, startedAt: inspected.State.StartedAt };
  }
  if (!SERVICES.every(service => environments[service])) invalid();
  // A daemon switch during the multi-call observation invalidates the snapshot.
  if ((await runDocker(['info', '--format', '{{.ID}}'])).trim() !== daemonId) invalid();
  return { daemonId, environments, inventory: inventory.sort() };
}

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
    const { values } = parseArgs({ args: scriptArgv(), options: { phase: { type: 'string' } }, allowPositionals: false });
    await persistMaintenanceEpoch({ phase: values.phase });
  } catch {
    // No raw daemon errors, paths, payloads or secrets in the promoter log.
    process.stderr.write('maintenance_epoch_evidence_unavailable\n');
    process.exitCode = 78;
  }
}

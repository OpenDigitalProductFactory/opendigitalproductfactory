import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

export function resolveEpochDockerInvocation(args, env = process.env) {
  let prefix = [];
  try { prefix = env.DPF_DOCKER_PREFIX_ARGS ? JSON.parse(env.DPF_DOCKER_PREFIX_ARGS) : []; }
  catch { invalid(); }
  if (!Array.isArray(prefix) || prefix.some(value => typeof value !== 'string')) invalid();
  const command = env.DPF_DOCKER_BIN ?? 'docker';
  if (typeof command !== 'string' || command.length === 0) invalid();
  return { command, args: [...prefix, ...args] };
}

export async function runEpochDocker(args, { env = process.env, execute = exec } = {}) {
  const invocation = resolveEpochDockerInvocation(args, env);
  const { stdout } = await execute(invocation.command, invocation.args,
    { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
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

const serviceImageInvalid = () => { throw new Error('runtime_service_image_unproven'); };
const serviceImageId = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const serviceImageKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const SERVICE_IMAGE_INSPECTION = '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"sourceSha":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"inputTreeOid":{{json (index .Config.Labels "dpf.service-image.input-tree")}},"repoDigests":{{json .RepoDigests}}}';

/** Existing artifact evidence owner; the native actuator supplies bounded IO.
 * No compose apply, arbitrary context or mutable source checkout is accepted. */
export async function prepareRuntimeServiceImage({ source, sourceSha, platform, stateDir, runDocker, runGit }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '') || !['linux/amd64', 'linux/arm64'].includes(platform)
    || !isAbsolute(stateDir ?? '') || typeof runDocker !== 'function') serviceImageInvalid();
  const published = source?.kind === 'published', restore = source?.kind === 'restore';
  if (restore) {
    if (!serviceImageKeys(source, ['kind', 'imageId', 'expectedImageId'])
      || !serviceImageId(source.imageId) || !serviceImageId(source.expectedImageId)) serviceImageInvalid();
  } else if (published) {
    if (!serviceImageKeys(source, ['kind', 'sourceSha', 'reference']) || source.sourceSha !== sourceSha
      || !/^ghcr\.io\/[A-Za-z0-9][A-Za-z0-9_.-]*\/dpf-browser-use@sha256:[a-f0-9]{64}$/.test(source.reference ?? '')) serviceImageInvalid();
  } else if (!serviceImageKeys(source, ['kind', 'sourceSha']) || source.kind !== 'source'
    || source.sourceSha !== sourceSha || typeof runGit !== 'function') serviceImageInvalid();
  let scratch;
  try {
    let image, proofSource = structuredClone(source);
    if (restore) image = source.imageId;
    else if (published) {
      await runDocker(['pull', '--platform', platform, source.reference], { timeoutMs: 5 * 60_000 });
      image = source.reference;
    } else {
      // Archive one immutable tree directly to the Docker client's stdin. The
      // moving host checkout and every unrelated service stay outside context.
      const object = `${sourceSha}:services/browser-use`;
      // This native branch starts before promote.sh's Git setup. Trust only
      // the fixed read-only source mount for this command, never global '*'.
      const gitScope = ['-c', 'safe.directory=/host-source'];
      const inputTreeOid = String(await runGit([...gitScope, 'rev-parse', object])).trim();
      if (!/^[a-f0-9]{40}$/.test(inputTreeOid)) serviceImageInvalid();
      const archive = await runGit([...gitScope, 'archive', '--format=tar', object]);
      if (!Buffer.isBuffer(archive) || archive.length === 0 || archive.length > 64 * 1024 * 1024) serviceImageInvalid();
      scratch = await mkdtemp(join(stateDir, '.runtime-image-'));
      const iid = join(scratch, 'image.id');
      await runDocker(['build', '--platform', platform, '--file', 'Dockerfile', '--iidfile', iid,
        '--label', `org.opencontainers.image.revision=${sourceSha}`,
        '--label', `dpf.service-image.input-tree=${inputTreeOid}`, '-'],
      { timeoutMs: 5 * 60_000, input: archive });
      image = (await readFile(iid, 'utf8')).trim();
      if (!serviceImageId(image)) serviceImageInvalid();
      proofSource = { ...source, inputTreeOid };
    }
    const bytes = await runDocker(['image', 'inspect', image, '--format', SERVICE_IMAGE_INSPECTION], { timeoutMs: 30_000 });
    if (Buffer.byteLength(bytes) > 8192) serviceImageInvalid();
    const actual = JSON.parse(bytes);
    if (!serviceImageId(actual.id) || `${actual.os}/${actual.architecture}` !== platform
      || (restore && actual.id !== source.imageId)
      || (!restore && actual.sourceSha !== sourceSha)
      || (published && (!Array.isArray(actual.repoDigests) || !actual.repoDigests.includes(source.reference)))
      || (!published && !restore && (actual.id !== image || actual.inputTreeOid !== proofSource.inputTreeOid))) serviceImageInvalid();
    return { imageId: actual.id, source: proofSource };
  } catch (error) {
    if (error?.message === 'runtime_image_preparation_unsettled') throw new Error('runtime_image_preparation_unsettled');
    serviceImageInvalid();
  }
  finally {
    if (scratch) {
      try { await rm(scratch, { recursive: true, force: true }); }
      catch { throw new Error('runtime_service_image_cleanup_unverified'); }
    }
  }
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

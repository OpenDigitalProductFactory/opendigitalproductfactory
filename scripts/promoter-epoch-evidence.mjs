import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { constants } from 'node:fs';
import { once } from 'node:events';
import { chmod, chown, lstat, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from './lib/canonical-json.mjs';
import { signMaintenanceEpoch, verifyMaintenanceEpoch } from './lib/maintenance-epoch-receipt.mjs';
import { readMigrationSecret } from './promoter-migration-envelope.mjs';
import { signTransitionPayload, verifyTransitionSignature } from './lib/transition-signing.mjs';
import { isEntryModule } from './lib/entry-module.mjs';
import { scriptArgv } from './lib/script-argv.mjs';

import { assertNoCanonicalActuators, hasContinuousMaintenanceStarts, observeMaintenanceEnvironments } from "./lib/maintenance-epoch-receipt.mjs";
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

export async function runEpochDocker(args, { env = process.env, execute = exec, timeoutMs = 15_000 } = {}) {
  const invocation = resolveEpochDockerInvocation(args, env);
  const { stdout } = await execute(invocation.command, invocation.args,
    { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
  return stdout;
}

async function runScopeWriterImageProbe({ image, runDocker, served = false }) {
  const config = (await runDocker(['image', 'inspect', image, '--format', '{{.Id}}'])).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(config)) throw new Error('scope_writer_image_unproven');
  const name = `dpf-scope-writer-probe-${randomUUID()}`;
  let bytes;
  try {
    bytes = await runDocker(['run', '--rm', '--read-only', '--name', name, '--network', 'none', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '1', '--pids-limit', '64', '--pull', 'never',
      '--entrypoint', 'node', config, '/app/apps/web-src/lib/work-capsules/scope-epoch-writer-probe.mjs',
      ...(served ? ['--served'] : [])]);
  } catch {
    try { await runDocker(['rm', '-f', name]); } catch { /* Only this observation's own container. */ }
    throw new Error('scope_writer_image_unproven');
  }
  if (Buffer.byteLength(bytes) > 8192) throw new Error('scope_writer_image_unproven');
  return { bytes, config };
}

/** A scoped packaged-writer proof of the actual immutable portal image.
 * No mounts, network, credentials or deployment effects are exposed to the probe. */
export async function inspectScopeEpochWriterImage({ image, expectedSource = '', runDocker = runEpochDocker }) {
  const { bytes, config } = await runScopeWriterImageProbe({ image, runDocker });
  try {
    const proof = JSON.parse(bytes), hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    if (!proof || Object.keys(proof).length !== 6 || proof.schemaVersion !== 1 || proof.version !== 1
      || !/^[a-f0-9]{40}$/.test(proof.sourceSha ?? '') || (expectedSource && proof.sourceSha !== expectedSource)
      || !hash(proof.sourceContentHash) || !hash(proof.contractSha256) || !proof.writers || typeof proof.writers !== 'object'
      || Array.isArray(proof.writers) || !Object.keys(proof.writers).length || Object.values(proof.writers).some(value => !hash(value))) throw new Error();
  } catch { throw new Error('scope_writer_image_unproven'); }
  if ((await runDocker(['image', 'inspect', image, '--format', '{{.Id}}'])).trim() !== config) throw new Error('scope_writer_image_moved');
  return config;
}

/** Observe the emitted MCP writer in the full, already resolved OCI image. */
export async function inspectServedScopeWriterImage({ image, runDocker = runEpochDocker }) {
  try {
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error();
    const { bytes, config } = await runScopeWriterImageProbe({ image, runDocker, served: true });
    const proof = JSON.parse(bytes), keys = ['serverSha256', 'routeSha256', 'manifestSha256'];
    if (config !== image || !proof || proof.schemaVersion !== 1 || Object.keys(proof).length !== keys.length + 1
      || keys.some(key => typeof proof[key] !== 'string' || !/^[a-f0-9]{64}$/.test(proof[key]))) throw new Error();
    return { image, ...proof };
  } catch { throw new Error('scope_writer_served_image_unproven'); }
}

const servedPortalArgs = ['node', '/usr/local/bin/runtime-secret-bootstrap.mjs', '--',
  '/usr/local/bin/portal-migrate-boot.sh', '/usr/local/bin/node', '--disable-sigusr1', '/app/apps/web/server.js'];
const loaderPrefixes = ['NODE_OPTIONS=', 'NODE_PATH=', 'NODE_CHANNEL_FD=', 'LD_', 'DYLD_', 'BASH_ENV=', 'ENV=', 'DPF_APP_DIR='];
const trustedPath = 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
// Report names of forbidden overrides, never container environment values.
const loaderChecks = loaderPrefixes.map(prefix =>
  `{{if ge (len .) ${prefix.length}}}{{if eq (slice . 0 ${prefix.length}) ${JSON.stringify(prefix)}}}"${prefix}",{{end}}{{end}}`,
).join('') + `{{if ge (len .) 5}}{{if eq (slice . 0 5) "PATH="}}{{if ne . ${JSON.stringify(trustedPath)}}}"PATH=",{{end}}{{end}}{{end}}`;
const portalLaunchTemplate = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},'
  + '"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
  + '"path":{{json .Path}},"args":{{json .Args}},"user":{{json .Config.User}},"workingDir":{{json .Config.WorkingDir}},'
  + `"loaderOverrides":[{{range .Config.Env}}${loaderChecks}{{end}}null],`
  + `"pathMatches":[{{range .Config.Env}}{{if eq . ${JSON.stringify(trustedPath)}}}true,{{end}}{{end}}false],`
  + '"rootReadOnly":{{json .HostConfig.ReadonlyRootfs}},"privileged":{{json .HostConfig.Privileged}},'
  + '"capAdd":{{json (index .HostConfig "CapAdd")}},"capDrop":{{json (index .HostConfig "CapDrop")}},"securityOpt":{{json (index .HostConfig "SecurityOpt")}},'
  + '"pidMode":{{json .HostConfig.PidMode}},"ipcMode":{{json .HostConfig.IpcMode}},"networkMode":{{json .HostConfig.NetworkMode}},'
  + '"usernsMode":{{json .HostConfig.UsernsMode}},"cgroupnsMode":{{json .HostConfig.CgroupnsMode}},'
  + '"devices":{{json (index .HostConfig "Devices")}},"deviceRequests":{{json (index .HostConfig "DeviceRequests")}},'
  + '"deviceRules":{{json (index .HostConfig "DeviceCgroupRules")}},"groupAdd":{{json (index .HostConfig "GroupAdd")}},'
  + '"volumesFrom":{{json (index .HostConfig "VolumesFrom")}},"tmpfs":{{json (index .HostConfig "Tmpfs")}},'
  + '"mounts":[{{range $i, $m := .Mounts}}{{if $i}},{{end}}{"type":{{json $m.Type}},"target":{{json $m.Destination}},'
  + '"write":{{json $m.RW}},"name":{{json (index $m "Name")}},"source":{{json $m.Source}},"propagation":{{json $m.Propagation}}}{{end}}]}';

const portalMountPolicy = new Map([
  ['/run/dpf-actuator', { type: 'volume', write: false, name: 'portal_actuator' }],
  ['/dpf-state', { type: 'bind', write: false }],
  ['/host-dpf', { type: 'bind', write: false }],
  ['/host-worktrees', { type: 'bind', write: false }],
  ['/evidence', { type: 'volume', write: false, name: 'browser_evidence' }],
  ['/workspace', { type: 'volume', write: false, name: 'dpf-source-code' }],
  ['/sandbox-workspace', { type: 'volume', write: true, name: 'sandbox_workspace' }],
  ['/var/lib/dpf/maps', { type: 'volume', write: true, name: 'map_data' }],
  ['/backups', { type: 'bind', write: true }],
  ['/dpf-federation', { type: 'bind', write: true }],
  ['/etc/dpf/pki/root_ca.crt', { type: 'bind', write: false }],
  ['/run/secrets/dpf-edge-action-signing-password', { type: 'bind', write: false }],
  ['/run/secrets/dpf-edge-action-signing-private.pem', { type: 'bind', write: false }],
  ['/run/secrets/dpf-edge-mtls-proxy-secret', { type: 'bind', write: false }],
]);

const isEmptyList = value => value === null || (Array.isArray(value) && value.length === 0);
const exactArguments = (value, expected) => Array.isArray(value) && value.length === expected.length
  && value.every((item, index) => item === expected[index]);

function normalizePortalTmpfs(value) {
  if (!value || Object.keys(value).length !== 1 || typeof value['/tmp'] !== 'string') return null;
  const tokens = value['/tmp'].split(',').sort();
  const expected = ['mode=1777', 'nodev', 'noexec', 'nosuid', 'rw', 'size=512m'];
  return exactArguments(tokens, expected) ? { '/tmp': tokens } : null;
}

const shareMount = '/run/dpf-actuator';
const stateMount = '/dpf-state';
const dockerSocketMount = '/var/run/docker.sock';
const admissionNetwork = 'runtime-admission';

/** Check the fully interpolated, merged Compose service plans without exposing
 * environment values. An exact Docker inspection is still required at boot. */
export function verifyPortalWriterCompose(recipe, { project, image, actuatorImage }) {
  const refuse = () => { throw new Error('scope_writer_compose_unproven'); };
  const portal = recipe?.services?.portal, actuator = recipe?.services?.['portal-actuator'];
  const network = recipe?.networks?.[admissionNetwork], volume = recipe?.volumes?.portal_actuator;
  const safeProfiles = service => !service.privileged && !service.pid && !service.ipc && !service.userns_mode
    && !service.network_mode && (!service.cgroup || service.cgroup === 'private')
    && ['devices', 'device_cgroup_rules', 'group_add', 'volumes_from', 'configs', 'secrets', 'profiles']
      .every(key => service[key] === undefined || isEmptyList(service[key]));
  const safeEnvironment = environment => Object.entries(environment ?? {}).every(([key, value]) =>
    !loaderPrefixes.some(prefix => `${key}=${String(value)}`.startsWith(prefix))
    && (key !== 'PATH' || `PATH=${value}` === trustedPath) && !['DOCKER_HOST', 'DOCKER_CONTEXT'].includes(key));
  const privateBinds = mount => mount.type !== 'bind'
    || (!mount.bind?.propagation || ['private', 'rprivate'].includes(mount.bind.propagation));
  const pinned = (service, id) => /^sha256:[a-f0-9]{64}$/.test(id ?? '') && service.image === id && service.pull_policy === 'never';
  try {
    if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(project) || recipe?.name !== project || !portal || !actuator
      || !pinned(portal, image) || !pinned(actuator, actuatorImage) || !safeProfiles(portal) || !safeProfiles(actuator)
      || portal.read_only !== true || portal.user !== '1000:1000' || !exactArguments(portal.cap_drop, ['ALL'])
      || (portal.cap_add !== undefined && !isEmptyList(portal.cap_add))
      || !exactArguments(portal.security_opt, ['no-new-privileges:true'])
      || portal.entrypoint !== undefined || portal.command !== undefined
      || (portal.working_dir !== undefined && portal.working_dir !== '/app') || !safeEnvironment(portal.environment)
      || !exactArguments(Object.keys(portal.networks ?? {}), ['default']) || !Array.isArray(portal.tmpfs) || portal.tmpfs.length !== 1
      || !portal.tmpfs[0].startsWith('/tmp:') || !normalizePortalTmpfs({ '/tmp': portal.tmpfs[0].slice(5) })
      || actuator.read_only !== true || actuator.user !== '0:0' || !exactArguments(actuator.cap_drop, ['ALL'])
      || !exactArguments(actuator.cap_add, ['CHOWN']) || !exactArguments(actuator.security_opt, ['no-new-privileges:true'])
      || !exactArguments(actuator.entrypoint, ['node', '/app/scripts/promoter-epoch-evidence.mjs'])
      || !exactArguments(actuator.command, ['--phase', 'scope-serve']) || !safeEnvironment(actuator.environment)
      || actuator.environment?.PROMOTE_COMPOSE_PROJECT !== project
      || (actuator.ports !== undefined && !isEmptyList(actuator.ports))
      || !exactArguments(Object.keys(actuator.networks ?? {}), [admissionNetwork])
      || network?.name !== `${project}_${admissionNetwork}` || network.internal !== true || network.external || network.driver_opts
      || Object.keys(recipe.services).some(service => !['portal-actuator', 'postgres'].includes(service)
        && Object.hasOwn(recipe.services[service].networks ?? {}, admissionNetwork))
      || !Object.hasOwn(recipe.services.postgres?.networks ?? {}, admissionNetwork)
      || volume?.name !== `${project}_portal_actuator` || volume.external || volume.driver_opts
      || (volume.driver !== undefined && volume.driver !== 'local')) refuse();
    const portalMounts = new Map();
    if (!Array.isArray(portal.volumes) || !Array.isArray(actuator.volumes)) refuse();
    for (const mount of portal.volumes) {
      const policy = portalMountPolicy.get(mount.target);
      if (!policy || portalMounts.has(mount.target) || mount.type !== policy.type || Boolean(mount.read_only) === policy.write
        || !privateBinds(mount) || (policy.name ? mount.source !== policy.name : !isAbsolute(mount.source))) refuse();
      portalMounts.set(mount.target, mount.source);
    }
    const actionMounts = new Map(actuator.volumes.map(mount => [mount.target, mount]));
    if (actuator.volumes.length !== 3 || actionMounts.size !== 3 || !actuator.volumes.every(privateBinds)
      || portalMounts.get(shareMount) !== 'portal_actuator'
      || actionMounts.get(shareMount)?.type !== 'volume' || actionMounts.get(shareMount).source !== 'portal_actuator'
      || actionMounts.get(shareMount).read_only
      || actionMounts.get(stateMount)?.type !== 'bind' || actionMounts.get(stateMount).source !== portalMounts.get(stateMount)
      || actionMounts.get(stateMount).read_only !== true
      || actionMounts.get(dockerSocketMount)?.type !== 'bind' || actionMounts.get(dockerSocketMount).source !== dockerSocketMount
      || actionMounts.get(dockerSocketMount).read_only) refuse();
  } catch { return refuse(); }
}

/** Observe the effective container recipe. The caller still owns trust in the
 * Docker/actuator transport, initial attestation and process generation. */
export async function observeScopeWriterLaunch({ id, image, project, runDocker = runEpochDocker }) {
  const refuse = () => { throw new Error('scope_writer_launch_unproven'); };
  if (!/^[a-f0-9]{64}$/.test(id) || !/^sha256:[a-f0-9]{64}$/.test(image)
    || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(project)) refuse();
  try {
    const bytes = await runDocker(['inspect', '--type', 'container', '--format', portalLaunchTemplate, id]);
    if (Buffer.byteLength(bytes) > 32768) refuse();
    const value = JSON.parse(bytes), tmpfs = normalizePortalTmpfs(value?.tmpfs);
    if (!value || value.id !== id || value.image !== image || value.project !== project || value.service !== 'portal'
      || value.running !== true || value.path !== 'docker-entrypoint.sh' || !exactArguments(value.args, servedPortalArgs)
      || value.user !== '1000:1000' || value.workingDir !== '/app'
      || !Array.isArray(value.loaderOverrides) || value.loaderOverrides.some(name => name !== null)
      || !exactArguments(value.pathMatches, [true, false])
      || value.rootReadOnly !== true || value.privileged !== false || !isEmptyList(value.capAdd)
      || !exactArguments(value.capDrop, ['ALL']) || !exactArguments(value.securityOpt, ['no-new-privileges:true'])
      || value.pidMode !== '' || value.ipcMode !== 'private' || value.networkMode !== `${project}_default`
      || value.usernsMode !== '' || value.cgroupnsMode !== 'private'
      || [value.devices, value.deviceRequests, value.deviceRules, value.groupAdd, value.volumesFrom].some(values => !isEmptyList(values))
      || !tmpfs || !Array.isArray(value.mounts)) refuse();
    const targets = new Set();
    for (const mount of value.mounts) {
      const policy = portalMountPolicy.get(mount?.target);
      if (!policy || targets.has(mount.target) || mount.type !== policy.type || mount.write !== policy.write
        || typeof mount.source !== 'string' || !isAbsolute(mount.source)) refuse();
      if (policy.name ? mount.name !== `${project}_${policy.name}` || mount.propagation !== ''
        : mount.name !== null || mount.propagation !== 'rprivate') refuse();
      targets.add(mount.target);
    }
    if (!targets.has('/run/dpf-actuator') || !targets.has('/dpf-state')) refuse();
    const { startedAt, ...effective } = value;
    if (typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) refuse();
    const recipe = { ...effective, loaderOverrides: [], tmpfs,
      mounts: value.mounts.toSorted((left, right) => (left.target < right.target ? -1 : 1)) };
    return { id, image, recipeDigest: createHash('sha256').update(canonicalJson(recipe)).digest('hex'), startedAt };
  } catch { return refuse(); }
}

/** Called by the actuator with authenticated retirement and a host-owned launch
 * record. This closing observation performs no image launch or state write. */
export async function observeClosedScopeWriterCohort({ launch, retirement, runDocker = runEpochDocker,
  wallNow = Date.now, monotonicNow = () => performance.now() }) {
  const refuse = () => { throw new Error('scope_writer_cohort_unproven'); };
  const deadline = monotonicNow() + 2_000;
  const docker = async args => {
    const remaining = Math.floor(deadline - monotonicNow());
    if (remaining <= 0) refuse();
    const bytes = await runDocker(args, { timeoutMs: remaining });
    if (monotonicNow() >= deadline) refuse();
    return bytes;
  };
  try {
    if (launch.id !== retirement.after.portal.id || !/^[a-f0-9]{64}$/.test(launch.recipeDigest)) refuse();
    const { project, daemonId, runId, targetSha } = retirement;
    const observed = await observeMaintenanceEnvironments({ project, runDocker: docker });
    const currentLaunch = await observeScopeWriterLaunch({ id: launch.id, image: launch.image, project, runDocker: docker });
    await assertNoCanonicalActuators({ runDocker: docker });
    const observedAt = wallNow();
    if (observed.daemonId !== daemonId || currentLaunch.recipeDigest !== launch.recipeDigest
      || currentLaunch.startedAt !== observed.environments.portal.startedAt
      || retirement.retiredContainerIds.some(id => observed.inventory.includes(id))
      || !hasContinuousMaintenanceStarts(retirement.after, observed.environments, observedAt)) refuse();
    return { runId, sourceSha: targetSha, project, daemonId, launch: currentLaunch, cohort: observed.environments, observedAt };
  } catch { return refuse(); }
}

const launchEvidenceKind = 'scope-writer-launch';
const evidenceHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const receiptDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Produce separate launch evidence. The signed retirement remains immutable. */
export async function collectScopeWriterLaunchEvidence({ retirement, secret, image, currentRun,
  runDocker = runEpochDocker, now = new Date() }) {
  const signed = verifyMaintenanceEpoch(retirement, secret, { ...currentRun, now: now.getTime() });
  if (signed.project !== currentRun.project) throw new Error('scope_writer_launch_evidence_invalid');
  const launch = await observeScopeWriterLaunch({ id: signed.after.portal.id, image, project: signed.project, runDocker });
  const served = await inspectServedScopeWriterImage({ image, runDocker });
  if (!hasContinuousMaintenanceStarts(signed.after, {
    ...signed.after, portal: { id: launch.id, startedAt: launch.startedAt },
  }, now.getTime())) throw new Error('scope_writer_launch_evidence_invalid');
  const envelope = { version: 1, kind: launchEvidenceKind,
    payload: canonicalJson({ runId: signed.runId, targetSha: signed.targetSha, project: signed.project,
      promoterDigest: signed.promoterDigest, recoveryPointDigest: signed.recoveryPointDigest,
      retirementDigest: receiptDigest(retirement), launch, served }) };
  return { ...envelope, signature: signTransitionPayload(envelope, secret) };
}

export function verifyScopeWriterLaunchEvidence({ evidence, retirement, secret, now = new Date() }) {
  try {
    const { signature, ...envelope } = evidence;
    if (Object.keys(envelope).length !== 3 || envelope.version !== 1 || envelope.kind !== launchEvidenceKind
      || typeof envelope.payload !== 'string' || Buffer.byteLength(envelope.payload) > 8192) throw new Error();
    verifyTransitionSignature(envelope, signature, secret);
    const payload = JSON.parse(envelope.payload);
    if (canonicalJson(payload) !== envelope.payload || payload.retirementDigest !== receiptDigest(retirement)) throw new Error();
    const signed = verifyMaintenanceEpoch(retirement, secret, { ...payload, now: now.getTime() });
    const { launch, served } = payload;
    if (payload.project !== signed.project || launch.id !== signed.after.portal.id || !evidenceHash(launch.recipeDigest)
      || !/^sha256:[a-f0-9]{64}$/.test(launch.image) || served.image !== launch.image || served.schemaVersion !== 1
      || ![served.serverSha256, served.routeSha256, served.manifestSha256].every(evidenceHash)) throw new Error();
    return { launch, served, retirement: signed, retirementDigest: payload.retirementDigest };
  } catch { throw new Error('scope_writer_launch_evidence_invalid'); }
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

async function replaceEvidencePointer(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

async function readHostObservationFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o22) !== 0 || info.size > 32_768) throw new Error();
    const bytes = Buffer.alloc(info.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== info.size) throw new Error();
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally { await file.close(); }
}

const retirementFile = 'maintenance-epoch-retirement.json';
const scopeLaunchFile = 'scope-writer-launch.json';

export async function persistScopeWriterLaunch({ stateDir, backupDir, secret, image, currentRun,
  runDocker = runEpochDocker, now = new Date() }) {
  if (!isAbsolute(stateDir) || !isAbsolute(backupDir)) throw new Error('scope_writer_launch_evidence_invalid');
  const retirement = await readHostObservationFile(join(stateDir, retirementFile));
  const backupPath = join(backupDir, scopeLaunchFile);
  let launch;
  try { launch = await readHostObservationFile(backupPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    launch = await collectScopeWriterLaunchEvidence({ retirement, secret, image, currentRun, runDocker, now });
  }
  const verified = verifyScopeWriterLaunchEvidence({ evidence: launch, retirement, secret, now });
  if (verified.launch.image !== image || verified.retirement.runId !== currentRun.runId
    || verified.retirement.targetSha !== currentRun.targetSha || verified.retirement.project !== currentRun.project
    || verified.retirement.promoterDigest !== currentRun.promoterDigest
    || verified.retirement.recoveryPointDigest !== currentRun.recoveryPointDigest) throw new Error('scope_writer_launch_evidence_invalid');
  const bytes = JSON.stringify(launch);
  await writeOnce(backupPath, bytes);
  const pointer = join(stateDir, scopeLaunchFile);
  if (pointer !== backupPath) await replaceEvidencePointer(pointer, bytes);
}

export async function readScopeWriterObserverBinding({ stateDir, secret, now = new Date() }) {
  try {
    if (!isAbsolute(stateDir)) throw new Error();
    const [evidence, retirement] = await Promise.all([
      readHostObservationFile(join(stateDir, scopeLaunchFile)), readHostObservationFile(join(stateDir, retirementFile)),
    ]);
    return verifyScopeWriterLaunchEvidence({ evidence, retirement, secret, now });
  } catch { throw new Error('scope_writer_launch_evidence_invalid'); }
}

async function serveScopeWriterObserver(env) {
  const { createScopeWriterObserver, observeActuatorProjectServices, SCOPE_WRITER_OBSERVER_SOCKET } = await import('./lib/scope-writer-observation.mjs');
  const stateDir = env.DPF_PROMOTER_STATE_DIR ?? '/dpf-state';
  const project = env.PROMOTE_COMPOSE_PROJECT;
  const directory = await lstat(dirname(SCOPE_WRITER_OBSERVER_SOCKET));
  if (process.getuid() !== 0 || !directory.isDirectory() || directory.uid !== 0 || (directory.mode & 0o022) !== 0
    || typeof project !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(project)) throw new Error('scope_writer_observer_installation_invalid');
  const secret = await readMigrationSecret({ env });
  const server = createScopeWriterObserver(async () => {
    const { launch, retirement, served, retirementDigest } = await readScopeWriterObserverBinding({ stateDir, secret });
    if (retirement.project !== project) throw new Error('scope_writer_observer_installation_invalid');
    return { ...await observeClosedScopeWriterCohort({ launch, retirement }), served, retirementDigest };
  }, () => observeActuatorProjectServices(project));
  process.umask(0o117);
  server.listen(SCOPE_WRITER_OBSERVER_SOCKET);
  await once(server, 'listening');
  try {
    await chown(SCOPE_WRITER_OBSERVER_SOCKET, 0, 1000);
    await chmod(SCOPE_WRITER_OBSERVER_SOCKET, 0o660);
  } catch (error) { server.close(); throw error; }
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
  const finalPath = join(env.PROMOTE_BACKUP_PATH, retirementFile);
  const prior = await readOptional(finalPath);
  const receipt = prior ? JSON.parse(prior)
    : await finishMaintenanceEpoch({ baseline: JSON.parse(bytes), secret: key, expected: identity, runDocker, now });
  verifyMaintenanceEpoch(receipt, key, { ...identity, now: (now ?? new Date()).getTime() });
  const finalBytes = JSON.stringify(receipt);
  await writeOnce(finalPath, finalBytes);
  const pointer = join(env.DPF_PROMOTER_STATE_DIR ?? '/dpf-state', retirementFile);
  if (pointer === finalPath) return;
  await replaceEvidencePointer(pointer, finalBytes);
}

if (isEntryModule(import.meta.url)) {
  try {
    const { values } = parseArgs({ args: scriptArgv(), options: {
      phase: { type: 'string' }, image: { type: 'string' }, source: { type: 'string' },
      container: { type: 'string' }, project: { type: 'string' },
    }, allowPositionals: false });
    if (values.phase === 'scope-image') process.stdout.write(`${await inspectScopeEpochWriterImage({ image: values.image, expectedSource: values.source })}\n`);
    else if (values.phase === 'scope-served-image') {
      const observation = await inspectServedScopeWriterImage({ image: values.image });
      process.stdout.write(`${JSON.stringify(observation)}\n`);
    }
    else if (values.phase === 'scope-launch') {
      const observation = await observeScopeWriterLaunch({ id: values.container, image: values.image, project: values.project });
      process.stdout.write(`${JSON.stringify(observation)}\n`);
    }
    else if (values.phase === 'scope-record-launch') {
      const env = process.env;
      await persistScopeWriterLaunch({ stateDir: env.DPF_PROMOTER_STATE_DIR ?? '/dpf-state', backupDir: env.PROMOTE_BACKUP_PATH,
        secret: await readMigrationSecret({ env }), image: values.image, currentRun: {
          runId: env.DPF_SELF_UPGRADE_RUN_ID, targetSha: env.PROMOTE_TARGET_SHA, project: env.PROMOTE_COMPOSE_PROJECT,
          promoterDigest: env.DPF_PROMOTER_DIGEST, recoveryPointDigest: env.DPF_MAINTENANCE_RECOVERY_POINT_DIGEST,
        } });
    }
    else if (values.phase === 'scope-serve') await serveScopeWriterObserver(process.env);
    else if (values.phase === 'scope-fallback') process.stdout.write(`${JSON.stringify(await classifyInitialScopeEpochFallback({ image: values.image }))}\n`);
    else await persistMaintenanceEpoch({ phase: values.phase });
  } catch {
    // No raw daemon errors, paths, payloads or secrets in the promoter log.
    process.stderr.write('maintenance_epoch_evidence_unavailable\n');
    process.exitCode = 78;
  }
}

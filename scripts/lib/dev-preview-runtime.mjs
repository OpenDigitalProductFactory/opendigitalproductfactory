import { DELIVERY_WORKFLOW_TOOLS, deliveryReadinessFromDiscovery } from '../../packages/integration-shared/src/delivery-readiness-contract.cjs';
export const REQUIRED_PREVIEW_DELIVERY_TOOLS = DELIVERY_WORKFLOW_TOOLS;
import { gitText } from './git.mjs';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDpfStatePath } from './resolve-compose-install-context.mjs';
import { validateComposeSafety } from './compose-safety.mjs';
import { resolveMcpCredential } from './mcp-credential.mjs';
import { mcpCall } from './mcp-client.mjs';
import { superviseLeaseRun, admittedLeaseTtlMs } from './lease-supervisor.mjs';
import { sampleLocalCiHostPressure } from './local-ci-host-pressure.mjs';

export function assertToolReadiness(response) {
  const report = deliveryReadinessFromDiscovery(response);
  const denied = [...new Set([...report.missingTokenTools, ...report.missingCoworkerTools, ...report.unavailableTools])];
  if (!report.ready) throw new Error(`preview_delivery_permissions_incomplete:${denied.join(',')}; platform administrator must reconcile approved permissions; client cannot self-grant`);
}

export async function assertAdmittedWorktreePath(admittedPath, worktree) {
  if (typeof admittedPath !== 'string' || !admittedPath.trim() || !isAbsolute(admittedPath)) {
    throw new Error('preview_admission_binding_mismatch');
  }
  let canonicalPath;
  try { canonicalPath = await realpath(admittedPath); }
  catch { throw new Error('preview_admission_binding_mismatch'); }
  if (canonicalPath !== worktree) throw new Error('preview_admission_binding_mismatch');
}

export function previewOverride({ worktree, sha, leaseId, cloneImage }) {
  const service = () => ({
    volumes: [{ type: 'bind', source: worktree, target: '/workspace' }],
    labels: { 'dpf.preview.lease': leaseId, 'dpf.preview.sha': sha },
    environment: { DPF_ENVIRONMENT: 'dev', DPF_ENVIRONMENT_CLASS: 'development', DPF_PREVIEW_SOURCE_SHA: sha, DPF_PREVIEW_LEASE_ID: leaseId, AUTH_SECRET: '${DPF_PREVIEW_AUTH_SECRET:?preview auth prerequisite}' },
  });
  const init = service();
  if (cloneImage) {
    init.image = cloneImage;
    init.entrypoint = ['/bin/sh', '-c'];
    init.command = ['cd /workspace && pnpm install --frozen-lockfile && pnpm --filter @dpf/db exec prisma generate && pnpm --filter @dpf/db exec node ./scripts/dev-preview-migrate-deploy.mjs && cd /app && pnpm --filter @dpf/db exec tsx src/sanitized-clone.ts'];
    init.labels['dpf.preview.clone-image'] = cloneImage;
  }
  return { services: { 'dev-init': init, 'dev-portal': service() } };
}

export function assertPreviewConfig(config, { worktree, sha, leaseId }) {
  for (const name of ['dev-init', 'dev-portal']) {
    const service = config.services?.[name];
    const mount = service?.volumes?.find(volume => volume.target === '/workspace');
    if (mount?.type !== 'bind' || resolve(mount.source) !== worktree) throw new Error(`preview_mount_mismatch:${name}`);
    if (service.environment?.DPF_ENVIRONMENT_CLASS !== 'development'
        || service.labels?.['dpf.preview.sha'] !== sha
        || service.labels?.['dpf.preview.lease'] !== leaseId) throw new Error(`preview_identity_mismatch:${name}`);
  }
  const init = config.services['dev-init'].environment;
  if (!init.CONTRIBUTOR_PREVIEW_PASSWORD || !init.PRODUCTION_DATABASE_URL || !init.DATABASE_URL
      || init.PRODUCTION_DATABASE_URL === init.DATABASE_URL) throw new Error('preview_prerequisites_incomplete');
  if (config.services['dev-portal'].environment.DATABASE_URL !== init.DATABASE_URL) throw new Error('preview_portal_database_mismatch');
  const destination = new URL(init.DATABASE_URL);
  if (destination.hostname !== 'dev-postgres' || destination.pathname !== '/dpf') throw new Error('preview_destination_not_disposable');
}

export function assertPreviewContainer(container, { worktree, sha, leaseId }) {
  const mount = container.Mounts?.find(volume => volume.Destination === '/workspace');
  if (mount?.Type !== 'bind' || resolve(mount.Source) !== worktree) throw new Error('preview_actual_mount_mismatch');
  if (!container.Config?.Env?.includes('DPF_ENVIRONMENT_CLASS=development')
      || !container.Config?.Env?.includes(`DPF_PREVIEW_SOURCE_SHA=${sha}`)
      || !container.Config?.Env?.includes(`DPF_PREVIEW_LEASE_ID=${leaseId}`)) throw new Error('preview_actual_environment_mismatch');
  if (container.Config?.Labels?.['dpf.preview.sha'] !== sha
      || container.Config?.Labels?.['dpf.preview.lease'] !== leaseId) throw new Error('preview_actual_identity_mismatch');
}

// Output from config/inspect may contain secrets. Capture it privately and report
// only the operation name on failure; never echo command arguments or stderr.
export function commandRunner({ docker = 'docker', env = process.env } = {}) {
  const children = new Set();
  return {
    async run(args, { capture = true, bin = docker } = {}) {
      return new Promise((done, fail) => {
        const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        children.add(child);
        let output = '';
        child.stdout.on('data', chunk => { if (capture) output += chunk; });
        child.stderr.resume();
        child.once('error', () => { children.delete(child); fail(new Error('preview_process_unavailable')); });
        child.once('close', code => { children.delete(child); code === 0 ? done(output.trim()) : fail(new Error('preview_operation_failed')); });
      });
    },
    terminate() { for (const child of children) child.kill('SIGKILL'); },
  };
}

export function protectedServiceIdentity(containers) {
  return containers.filter(container => !container.Config?.Labels?.['com.docker.compose.service']?.startsWith('dev-'))
    .map(container => ({ id: container.Id, service: container.Config?.Labels?.['com.docker.compose.service'],
      startedAt: container.State?.StartedAt, running: container.State?.Running,
      volumes: (container.Mounts || []).filter(mount => mount.Type === 'volume').map(mount => [mount.Destination, mount.Name]) }))
    .sort((left, right) => String(left.service).localeCompare(String(right.service)));
}

export async function stopOwnedPreviewContainers({ runner, leaseId, projectName, initName, ownedIds = new Set() }) {
  const failures = [];
  const candidates = new Set();
  // Compose can create a portal before returning an error or being fenced.
  // Discover it independently of the post-start inspection's recorded IDs.
  const queries = [
    ['ps', '-aq', '--no-trunc', '--filter', `label=dpf.preview.lease=${leaseId}`,
      '--filter', `label=com.docker.compose.project=${projectName}`,
      '--filter', 'label=com.docker.compose.service=dev-portal'],
    ['ps', '-aq', '--no-trunc', '--filter', `name=^/${initName}$`],
    ...[...ownedIds].map(id => ['ps', '-aq', '--no-trunc', '--filter', `id=${id}`]),
  ];
  for (const query of queries) {
    try { for (const id of (await runner.run(query)).split(/\s+/).filter(Boolean)) candidates.add(id); }
    catch (error) { failures.push(error); }
  }
  for (const id of candidates) {
    try {
      const [container] = JSON.parse(await runner.run(['inspect', id]));
      if (!container || container.Id !== id) throw new Error('preview_cleanup_identity_unverified');
      const labels = container.Config?.Labels || {};
      const service = labels['com.docker.compose.service'];
      if (labels['dpf.preview.lease'] !== leaseId || labels['com.docker.compose.project'] !== projectName) continue;
      if (service === 'dev-portal' || (service === 'dev-init' && container.Name === `/${initName}`)) {
        await runner.run(['stop', container.Id]);
      }
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'preview_owned_cleanup_failed');
}

export async function runPreviewLifecycle({ compose, inspect, verifySource, stopOwned, ready, wait, active }) {
  // Preparation/configuration/image admission is completed by the caller first.
  // A failed initialization can never reach the start operation.
  await verifySource();
  await compose(['stop', 'dev-portal']);
  await compose(['up', '-d', '--no-deps', '--no-recreate', '--no-build', '--wait', 'dev-postgres']);
  try {
    await compose(['run', '--rm', '--no-deps', '--name', active.initName, 'dev-init']);
    await verifySource();
    await compose(['up', '-d', '--no-deps', '--no-build', 'dev-portal']);
    await inspect();
    await ready();
    await wait();
  } finally { await stopOwned(); }
}

async function runAdmittedPreview(env, cleanupState) {
  const worktree = await realpath(env.DPF_DEV_WORKTREE || '');
  const leaseId = env.DPF_DEV_PORTAL_LEASE_ID;
  const ownerSessionId = env.DPF_DEV_PORTAL_OWNER_SESSION_ID;
  if (!leaseId || !ownerSessionId) throw new Error('preview_admission_missing');
  const statePath = resolveDpfStatePath({ env, home: homedir() });
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const root = await realpath(state.installPath);
  const files = state.composeFiles?.map(file => resolve(root, file));
  if (!files?.length) throw new Error('preview_install_compose_missing');
  // Canonical settings stay at the install. The override contains no secrets.
  const envFile = resolve(root, '.env');
  await readFile(envFile); // Mandatory install prerequisites, before runtime mutation.
  const runtimeEnv = { ...env, CONTRIBUTOR_PREVIEW_PASSWORD: randomBytes(32).toString('base64url'), DPF_PREVIEW_AUTH_SECRET: randomBytes(48).toString('base64url'), DPF_DEV_WORKTREE: worktree };
  const runner = commandRunner({ docker: env.DPF_DEV_PORTAL_DOCKER_BIN || 'docker', env: runtimeEnv });
  const git = async args => gitText(args, { cwd: worktree });
  const sha = await git(['rev-parse', 'HEAD']);
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (env.DPF_DEV_PORTAL_SOURCE_SHA !== sha) throw new Error('preview_claim_source_changed');
  if (branch === 'HEAD' || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('preview_source_not_topic_commit');
  const verifySource = async () => {
    if ((await git(['rev-parse', 'HEAD'])) !== sha || (await git(['rev-parse', '--abbrev-ref', 'HEAD'])) !== branch
        || await git(['status', '--porcelain'])) throw new Error('preview_source_changed');
  };
  await verifySource();
  // Use the running canonical image for clone implementation, independently
  // of preserved feature source. Never build a substitute image here.
  const portals = (await runner.run(['ps', '-q', '--filter', `label=com.docker.compose.project=${state.composeProjectName || 'dpf'}`, '--filter', 'label=com.docker.compose.service=portal'])).split(/\s+/).filter(Boolean);
  if (portals.length !== 1) throw new Error('preview_canonical_runtime_unavailable');
  const [canonical] = JSON.parse(await runner.run(['inspect', portals[0]]));
  if (!canonical.State?.Running || !/^sha256:[a-f0-9]{64}$/.test(canonical.Image)) throw new Error('preview_canonical_image_unverified');
  // An install predating this repair is not ready to initialize an old feature.
  await runner.run(['exec', portals[0], 'test', '-f', '/app/packages/db/src/sanitized-clone-batches.ts']);
  const identity = { worktree, sha, leaseId, cloneImage: canonical.Image };
  const overridePath = resolve(dirname(statePath), `preview-${randomBytes(12).toString('hex')}.json`);
  await mkdir(dirname(overridePath), { recursive: true, mode: 0o700 });
  await writeFile(overridePath, JSON.stringify(previewOverride(identity)), { mode: 0o600, flag: 'wx' });
  const base = ['compose', '-p', state.composeProjectName || 'dpf', '--project-directory', root, '--env-file', envFile,
    ...files.flatMap(file => ['-f', file]), '-f', overridePath, '--profile', 'dev'];
  let protectedBefore;
  const protectedSnapshot = async () => {
    const ids = (await runner.run(['ps', '-aq', '--filter', `label=com.docker.compose.project=${state.composeProjectName || 'dpf'}`])).split(/\s+/).filter(Boolean);
    return ids.length ? protectedServiceIdentity(JSON.parse(await runner.run(['inspect', ...ids]))) : [];
  };
  const compose = async args => {
    const safety = validateComposeSafety({ args: base.slice(1).concat(args), env: { ...runtimeEnv, DPF_ALLOW_ROOT_COMPOSE_UP: '0', DPF_ALLOW_DESTRUCTIVE_COMPOSE: '0' } });
    if (!safety.ok) throw new Error('preview_compose_intent_refused');
    const result = await runner.run([...base, ...args]);
    if (protectedBefore && JSON.stringify(await protectedSnapshot()) !== JSON.stringify(protectedBefore)) throw new Error('preview_protected_service_changed');
    return result;
  };
  const ownedIds = new Set();
  const initName = `dpf-preview-init-${randomBytes(12).toString('hex')}`;
  let finish;
  const wait = new Promise(resolveWait => { finish = resolveWait; });
  const stopOwned = async () => {
    await stopOwnedPreviewContainers({ runner, leaseId, projectName: state.composeProjectName || 'dpf', initName, ownedIds });
  };
  const terminate = async () => { runner.terminate(); try { await stopOwned(); } finally { finish(); } };
  const mcpUrl = env.DPF_MCP_URL || 'http://127.0.0.1:3000/api/mcp/v1';
  const call = (tool, args) => mcpCall(tool, args, { mcpUrl, bearerToken: resolveMcpCredential({ mcpUrl, env }).bearer });

  const release = async () => {
    const result = await call('release_nonprod_environment_lease', { leaseId, ownerSessionId });
    if (!result.success) throw new Error(`Release ${leaseId} for owning session ${ownerSessionId}: ${result.message || result.error || 'approval required'}`);
  };
  try {
    assertToolReadiness(await call('load_tools', { names: REQUIRED_PREVIEW_DELIVERY_TOOLS }));
    const leases = await call('list_nonprod_environment_leases', {});
    const admitted = leases.data?.leases?.find(lease => lease.leaseId === leaseId);
    if (!admitted || admitted.status !== 'active' || admitted.ownerSessionId !== ownerSessionId
        || admitted.branchName !== branch
        || !(Date.parse(admitted.expiresAt) > Date.now())
        || admitted.url !== 'http://localhost:3001' || !admitted.purpose?.includes(`(${sha})`)) throw new Error('preview_admission_binding_mismatch');
    await assertAdmittedWorktreePath(admitted.worktreePath, worktree);
    const config = JSON.parse(await compose(['config', '--format', 'json']));
    assertPreviewConfig(config, identity);
    protectedBefore = await protectedSnapshot();
    if (!protectedBefore.some(service => service.service === 'postgres' && service.running)) throw new Error('preview_source_database_not_running');
    // Never build a hand-made runtime. Missing canonical dev images are a prerequisite failure.
    for (const service of ['dev-postgres', 'dev-init', 'dev-portal']) {
      const image = config.services[service].image || `${state.composeProjectName || 'dpf'}-${service}`;
      await runner.run(['image', 'inspect', image]);
    }
    const inspect = async () => {
      const id = await compose(['ps', '-q', 'dev-portal']);
      if (!id || /\s/.test(id)) throw new Error('preview_container_missing');
      ownedIds.add(id);
      const [container] = JSON.parse(await runner.run(['inspect', id]));
      assertPreviewContainer(container, identity);
      await verifySource();
    };
    const signal = () => void terminate().catch(error => { console.error(error.message); process.exitCode = 1; });
    process.on('SIGINT', signal); process.on('SIGTERM', signal);
    try {
      const expiresAt = env.DPF_DEV_PORTAL_LEASE_EXPIRES_AT;
      if (!expiresAt || !(Date.parse(expiresAt) > Date.now())) throw new Error('preview_admission_expired');
      cleanupState.supervised = true;
      const outcome = await superviseLeaseRun({
        ttlMs: admittedLeaseTtlMs(expiresAt, 120000), expiresAt,
        run: () => runPreviewLifecycle({ compose, inspect, verifySource, stopOwned,
          ready: async () => {
            const deadline = Date.now() + 120000;
            for (;;) {
              let response;
              try { response = await fetch('http://localhost:3001/api/health', { signal: AbortSignal.timeout(5000) }); } catch {}
              const body = response?.ok ? await response.json() : null;
              if (body?.status === 'ok') {
                // Preserved feature commits may predate the optional identity
                // health payload. Actual binding is checked independently.
                if (body.preview && (body.preview.sourceSha !== sha || body.preview.leaseId !== leaseId)) throw new Error('preview_served_identity_mismatch');
                await inspect();
                break;
              }
              if (Date.now() >= deadline) throw new Error('preview_served_identity_unverified');
              await new Promise(resolveRetry => setTimeout(resolveRetry, 1000));
            }
            console.log(`Contributor preview bound to ${branch} @ ${sha}; initialization complete.`);
          },
          wait: () => wait, active: { initName } }),
        renew: async () => {
          try { await verifySource(); if (ownedIds.size) await inspect(); } catch { return { success: false, error: 'preview_binding_changed' }; }
          return call('renew_nonprod_environment_lease', { leaseId, ownerSessionId, ttlMinutes: 2,
            hostPressure: await sampleLocalCiHostPressure({ rootPath: worktree, evidenceIsolationHealthy: true }) });
        }, terminate,
        release,
        onEvent: event => { if (event.type === 'release-failed') console.error(event.reason); },
      });
      if (outcome.status !== 'completed') throw new Error(`preview_fenced:${outcome.reason}`);
    } finally { process.off('SIGINT', signal); process.off('SIGTERM', signal); }
  } finally {
    await rm(overridePath, { force: true });

  }
}

export async function main(env = process.env) {
  const cleanupState = { supervised: false };
  try { return await runAdmittedPreview(env, cleanupState); }
  finally {
    // Even prerequisite/source failures reconcile the admitted reservation.
    if (!cleanupState.supervised && env.DPF_DEV_PORTAL_LEASE_ID && env.DPF_DEV_PORTAL_OWNER_SESSION_ID) {
      const mcpUrl = env.DPF_MCP_URL || 'http://127.0.0.1:3000/api/mcp/v1';
      try {
        const result = await mcpCall('release_nonprod_environment_lease', {
          leaseId: env.DPF_DEV_PORTAL_LEASE_ID, ownerSessionId: env.DPF_DEV_PORTAL_OWNER_SESSION_ID,
        }, { mcpUrl, bearerToken: resolveMcpCredential({ mcpUrl, env }).bearer });
        if (!result.success) console.error(`Release ${env.DPF_DEV_PORTAL_LEASE_ID} for owning session ${env.DPF_DEV_PORTAL_OWNER_SESSION_ID}: ${result.message || result.error || 'approval required'}`);
      } catch { console.error(`Release ${env.DPF_DEV_PORTAL_LEASE_ID}: cleanup could not be reconciled; platform expiry remains authoritative`); }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

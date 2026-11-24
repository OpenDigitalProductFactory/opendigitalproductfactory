import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captureMaintenanceEpoch, finishMaintenanceEpoch, persistMaintenanceEpoch,
  resolveEpochDockerInvocation, runEpochDocker } from './promoter-epoch-evidence.mjs';
import * as imageEvidence from './promoter-epoch-evidence.mjs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const secret = 'a'.repeat(64);

describe('selected runtime image artifact qualification', () => {
  const sourceSha = 'a'.repeat(40), inputTreeOid = 'b'.repeat(40), imageId = `sha256:${'c'.repeat(64)}`;
  const reference = `ghcr.io/fixture/dpf-browser-use@sha256:${'d'.repeat(64)}`;
  const details = { id: imageId, os: 'linux', architecture: 'amd64', sourceSha, inputTreeOid, repoDigests: [reference] };

  it('prepares only immutable browser source inputs and qualifies the exact resulting image ID', async () => {
    assert.equal(typeof imageEvidence.prepareRuntimeServiceImage, 'function', 'native selected-image preparation is not implemented');
    const stateDir = await mkdtemp(join(tmpdir(), 'dpf-image-proof-'));
    const calls = [], gitCalls = [], archive = Buffer.from('bounded immutable source archive');
    try {
      const result = await imageEvidence.prepareRuntimeServiceImage({ sourceSha, platform: 'linux/amd64', stateDir,
        source: { kind: 'source', sourceSha },
        runGit: async args => { gitCalls.push(args); return args.includes('rev-parse') ? `${inputTreeOid}\n` : archive; },
        runDocker: async (args, options) => {
          calls.push(args);
          if (args[0] === 'build') { assert.deepEqual(options.input, archive); await writeFile(args[args.indexOf('--iidfile') + 1], `${imageId}\n`); return ''; }
          assert.deepEqual(args.slice(0, 3), ['image', 'inspect', imageId]);
          return JSON.stringify(details);
        },
      });
      assert.deepEqual(gitCalls, [['-c', 'safe.directory=/host-source', 'rev-parse', `${sourceSha}:services/browser-use`], ['-c', 'safe.directory=/host-source', 'archive', '--format=tar', `${sourceSha}:services/browser-use`]]);
      assert.equal(calls.filter(args => args[0] === 'build').length, 1);
      assert(calls[0].includes('--platform') && calls[0].includes('linux/amd64'));
      assert.equal(calls[0].at(-1), '-');
      assert(calls.every(args => !args.includes('compose') && !args.includes('up')));
      assert.deepEqual(result, { imageId, source: { kind: 'source', sourceSha, inputTreeOid } });
      assert.deepEqual(await readdir(stateDir), []);
    } finally { await rm(stateDir, { recursive: true, force: true }); }
  });

  it('uses a pinned published image without source builds or mutable-tag qualification', async () => {
    assert.equal(typeof imageEvidence.prepareRuntimeServiceImage, 'function');
    const stateDir = await mkdtemp(join(tmpdir(), 'dpf-image-published-')), calls = [];
    try {
      const result = await imageEvidence.prepareRuntimeServiceImage({ sourceSha, platform: 'linux/amd64', stateDir,
        source: { kind: 'published', sourceSha, reference },
        runGit: async () => { throw new Error('published preparation must not read Git'); },
        runDocker: async args => { calls.push(args); return args[0] === 'pull' ? '' : JSON.stringify(details); },
      });
      assert.deepEqual(calls[0], ['pull', '--platform', 'linux/amd64', reference]);
      assert.equal(calls.some(args => args.includes('build') || args.includes('up')), false);
      assert.deepEqual(result, { imageId, source: { kind: 'published', sourceSha, reference } });
    } finally { await rm(stateDir, { recursive: true, force: true }); }
  });

  for (const fault of ['source', 'platform', 'image', 'manifest', 'context']) it(`refuses wrong ${fault} artifact proof`, async () => {
    assert.equal(typeof imageEvidence.prepareRuntimeServiceImage, 'function');
    const stateDir = await mkdtemp(join(tmpdir(), 'dpf-image-refusal-'));
    try {
      const wrong = { ...details };
      if (fault === 'source') wrong.sourceSha = 'e'.repeat(40);
      if (fault === 'platform') wrong.architecture = 'arm64';
      if (fault === 'image') wrong.id = 'unknown';
      if (fault === 'manifest') wrong.repoDigests = [];
      const source = { kind: 'published', sourceSha, reference, ...(fault === 'context' ? { contextPath: '/caller-source' } : {}) };
      await assert.rejects(imageEvidence.prepareRuntimeServiceImage({ sourceSha, platform: 'linux/amd64', stateDir, source,
        runDocker: async () => JSON.stringify(wrong), runGit: async () => { throw new Error('not a source build'); },
      }), /runtime_service_image_unproven/);
      assert.deepEqual(await readdir(stateDir), []);
    } finally { await rm(stateDir, { recursive: true, force: true }); }
  });
});
const identity = { runId: 'SUR-EXAMPLE', targetSha: 'a'.repeat(40), promoterDigest: `sha256:${'b'.repeat(64)}`,
  recoveryPointDigest: 'c'.repeat(64), project: 'dpf' };
function harness() {
  let phase = 'before'; let fault = '';
  const commands = [];
  const before = ['1'.repeat(64), '2'.repeat(64)];
  const after = ['3'.repeat(64), '4'.repeat(64)];
  const runDocker = async args => {
    commands.push(args);
    if (fault === 'transport') throw new Error('daemon unavailable PRIVATE_SECRET');
    if (args[0] === 'info') return fault === 'daemon-changed' ? 'different-daemon' : 'daemon-example';
    if (args[0] === 'ps') {
      const ids = phase === 'before' ? before : fault === 'old-present' ? [...before, ...after] : after;
      return ids.join('\n');
    }
    assert.equal(args[0], 'inspect');
    const ids = args.slice(args.indexOf('--format') + 2);
    return ids.map(id => JSON.stringify({ Id: id, State: { Running: fault !== 'stopped', StartedAt: phase === 'before'
      ? '2026-10-15T00:00:00.000Z' : '2026-10-16T01:01:00.000Z' }, Config: { Labels: {
      'com.docker.compose.project': fault === 'wrong-project' ? 'other' : 'dpf',
      'com.docker.compose.service': (id[0] === '1' || id[0] === '3') ? 'portal' : 'sandbox',
    } } })).join('\n');
  };
  return { runDocker, commands, advance: () => { phase = 'after'; }, fail: f => { fault = f; } };
}
const captureAt = new Date('2026-10-16T01:00:00.000Z');
const finishAt = new Date('2026-10-16T01:02:00.000Z');
describe('canonical promoter retirement observation', () => {
  it('routes Docker through the existing host command adapter without a shell', async () => {
    const env = { DPF_DOCKER_BIN: process.execPath, DPF_DOCKER_PREFIX_ARGS: JSON.stringify(['fixture.mjs']) };
    assert.deepEqual(resolveEpochDockerInvocation(['image', 'inspect'], env),
      { command: process.execPath, args: ['fixture.mjs', 'image', 'inspect'] });
    let observed;
    assert.equal(await runEpochDocker(['info'], { env, execute: async (command, args, options) => {
      observed = { command, args, options }; return { stdout: 'adapter-output' };
    } }), 'adapter-output');
    assert.equal(observed.command, process.execPath);
    assert.deepEqual(observed.args, ['fixture.mjs', 'info']);
    assert.equal(observed.options.encoding, 'utf8');
    assert.throws(() => resolveEpochDockerInvocation([], { DPF_DOCKER_PREFIX_ARGS: '{bad' }),
      /maintenance_epoch_observation_unavailable/);
  });
  it('places observations around the actual canonical replacement and skips incomplete refresh', async () => {
    const script = await readFile(new URL('./promote.sh', import.meta.url), 'utf8');
    assert(script.indexOf('--phase capture') < script.indexOf('emit_step docker-up'));
    assert(script.indexOf('--phase finish') > script.indexOf('up -d --no-deps --force-recreate sandbox'));
    assert.match(script, /\$\{_sandbox_ok:-0\} -eq 1[^\n]*-f[^\n]*promoter-epoch-evidence/);
    assert.match(script, /--phase finish \\\n\s*\|\| printf 'step=maintenance-epoch-retirement-unavailable/);
  });
  it('persists a signed checkpoint and final evidence without replacing a checkpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dpf-epoch-test-'));
    try {
      const h = harness();
      const env = { DPF_SELF_UPGRADE_RUN_ID: identity.runId, PROMOTE_TARGET_SHA: identity.targetSha,
        DPF_PROMOTER_DIGEST: identity.promoterDigest, DPF_MAINTENANCE_RECOVERY_POINT_DIGEST: identity.recoveryPointDigest,
        PROMOTE_COMPOSE_PROJECT: identity.project, DPF_PROMOTER_STATE_DIR: directory, PROMOTE_BACKUP_PATH: directory };
      await persistMaintenanceEpoch({ phase: 'capture', env, secret, runDocker: h.runDocker, now: captureAt });
      const checkpoint = await readFile(join(directory, 'maintenance-epoch-checkpoint.json'), 'utf8');
      h.advance();
      await persistMaintenanceEpoch({ phase: 'capture', env, secret, runDocker: h.runDocker, now: finishAt });
      assert.equal(await readFile(join(directory, 'maintenance-epoch-checkpoint.json'), 'utf8'), checkpoint);
      await persistMaintenanceEpoch({ phase: 'finish', env, secret, runDocker: h.runDocker, now: finishAt });
      const saved = JSON.parse(await readFile(join(directory, 'maintenance-epoch-retirement.json'), 'utf8'));
      assert.equal(JSON.parse(saved.payload).runId, identity.runId);
      assert.equal(saved.kind, 'maintenance-epoch-retirement');
      assert(!JSON.stringify(saved).includes('executionSettled'));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('observes both environments using only read-only Docker calls', async () => {
    const h = harness();
    const baseline = await captureMaintenanceEpoch({ ...identity, secret, runDocker: h.runDocker, now: captureAt });
    h.advance();
    const receipt = await finishMaintenanceEpoch({ baseline, secret, expected: identity, runDocker: h.runDocker, now: finishAt });
    const payload = JSON.parse(receipt.payload);
    assert.deepEqual(payload.retiredContainerIds, ['1'.repeat(64), '2'.repeat(64)]);
    assert.equal(payload.after.sandbox.id, '4'.repeat(64));
    assert(h.commands.every(args => ['info', 'ps', 'inspect'].includes(args[0])));
    assert(h.commands.filter(args => args[0] === 'ps').every(args => args.includes('--all') && args.includes('--no-trunc')));
    assert.deepEqual(h.commands.filter(args => args[0] === 'inspect').map(args => args.slice(5)), [
      ['1'.repeat(64), '2'.repeat(64)], ['3'.repeat(64), '4'.repeat(64)],
    ]);
  });
  for (const fault of ['transport', 'daemon-changed', 'old-present', 'wrong-project', 'stopped']) {
    it(`does not produce proof on ${fault}`, async () => {
      const h = harness();
      const baseline = await captureMaintenanceEpoch({ ...identity, secret, runDocker: h.runDocker, now: captureAt });
      h.advance(); h.fail(fault);
      await assert.rejects(finishMaintenanceEpoch({ baseline, secret, expected: identity, runDocker: h.runDocker, now: finishAt }));
    });
  }
});


describe('scope writer actuator observations', () => {
  const launchImage = `sha256:${'b'.repeat(64)}`;
  const launchId = 'c'.repeat(64);
  const launchIdentity = { id: launchId, image: launchImage, project: 'fixture' };
  const launch = () => ({
    ...launchIdentity, service: 'portal', running: true, startedAt: '2026-10-16T01:01:00.000Z',
    path: 'docker-entrypoint.sh',
    args: ['node', '/usr/local/bin/runtime-secret-bootstrap.mjs', '--', '/usr/local/bin/portal-migrate-boot.sh',
      '/usr/local/bin/node', '--disable-sigusr1', '/app/apps/web/server.js'],
    user: '1000:1000', workingDir: '/app', loaderOverrides: [], pathMatches: [true, false],
    rootReadOnly: true, privileged: false, capAdd: null, capDrop: ['ALL'],
    pidMode: '', ipcMode: 'private', networkMode: 'fixture_default',
    securityOpt: ['no-new-privileges:true'], devices: [], deviceRequests: null, deviceRules: null,
    groupAdd: null, usernsMode: '', cgroupnsMode: 'private', volumesFrom: null,
    tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=512m,mode=1777' },
    mounts: [{ type: 'volume', target: '/run/dpf-actuator', write: false, name: 'fixture_portal_actuator',
      source: '/var/lib/docker/volumes/fixture_portal_actuator/_data', propagation: '' },
    { type: 'bind', target: '/dpf-state', write: false, name: null, source: '/install/state', propagation: 'rprivate' }],
  });

  it('qualifies only the canonical generated portal and actuator services before launch', () => {
    const actuatorImage = `sha256:${'d'.repeat(64)}`;
    const recipe = {
      name: 'fixture',
      volumes: { portal_actuator: { name: 'fixture_portal_actuator' } },
      networks: { 'runtime-admission': { name: 'fixture_runtime-admission', internal: true } },
      services: {
        portal: { image: launchImage, pull_policy: 'never', user: '1000:1000', read_only: true,
          cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777'],
          networks: { default: null }, volumes: [
            { type: 'volume', source: 'portal_actuator', target: '/run/dpf-actuator', read_only: true },
            { type: 'bind', source: '/install/state', target: '/dpf-state', read_only: true },
          ] },
        postgres: { networks: { default: null, 'runtime-admission': null } },
        'portal-actuator': { image: actuatorImage, pull_policy: 'never', user: '0:0', read_only: true,
          networks: { 'runtime-admission': null }, cap_drop: ['ALL'], cap_add: ['CHOWN'], security_opt: ['no-new-privileges:true'],
          entrypoint: ['node', '/app/scripts/promoter-epoch-evidence.mjs'], command: ['--phase', 'scope-serve'],
          environment: { PROMOTE_COMPOSE_PROJECT: 'fixture' }, volumes: [
            { type: 'volume', source: 'portal_actuator', target: '/run/dpf-actuator' },
            { type: 'bind', source: '/install/state', target: '/dpf-state', read_only: true },
            { type: 'bind', source: '/var/run/docker.sock', target: '/var/run/docker.sock' },
          ] },
      },
    };
    const expected = { project: 'fixture', image: launchImage, actuatorImage };
    assert.doesNotThrow(() => imageEvidence.verifyPortalWriterCompose(recipe, expected));
    for (const change of [
      value => { value.services.portal.command = ['sh']; },
      value => { value.services.portal.volumes[0].read_only = false; },
      value => { value.services.portal.volumes[1].source = '/different'; },
      value => { value.services.portal.environment = { DOCKER_HOST: 'tcp://peer:2375' }; },
      value => { value.services.portal.networks.untrusted = {}; },
      value => { value.services['portal-actuator'].entrypoint.push('--inspect'); },
      value => { value.services['portal-actuator'].ports = [{ target: 80 }]; },
      value => { value.services['portal-actuator'].environment.PROMOTE_COMPOSE_PROJECT = 'peer'; },
      value => { value.volumes.portal_actuator.driver_opts = { type: 'none', device: '/tmp' }; },
    ]) {
      const changed = structuredClone(recipe);
      change(changed);
      assert.throws(() => imageEvidence.verifyPortalWriterCompose(changed, expected), /scope_writer_compose_unproven/);
    }
  });

  it('qualifies the exact portal launch recipe and derives an order-independent recipe digest', async () => {
    const calls = [];
    const read = observed => imageEvidence.observeScopeWriterLaunch({ ...launchIdentity,
      runDocker: async args => { calls.push(args); return JSON.stringify(observed); },
    });
    const proof = await read(launch());
    const reordered = launch();
    reordered.mounts.reverse();
    assert.deepEqual(proof, await read(reordered));
    assert.deepEqual(Object.keys(proof), ['id', 'image', 'recipeDigest', 'startedAt']);
    assert.equal(proof.id, launchId);
    assert.equal(proof.image, launchImage);
    assert.match(proof.recipeDigest, /^[a-f0-9]{64}$/);
    for (const args of calls) {
      assert.deepEqual(args.slice(0, 3), ['inspect', '--type', 'container']);
      assert.equal(args.at(-1), launchId);
      assert.ok(!args[4].includes('json .Config.Env'));
    }
  });

  it('exposes the scoped post-launch observation through the promoter executable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dpf-scope-launch-'));
    const docker = join(dir, 'docker.mjs');
    const launcher = new URL('./promoter-epoch-evidence.mjs', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    const { spawnSync } = await import('node:child_process');
    try {
      await writeFile(docker, 'if (process.argv[2] !== "inspect") process.exit(42);\nprocess.stdout.write(process.env.DPF_TEST_LAUNCH_REPORT);\n');
      const args = [fileURLToPath(launcher), '--phase', 'scope-launch', '--container', launchId,
        '--image', launchImage, '--project', launchIdentity.project];
      const env = { ...process.env, DPF_DOCKER_BIN: process.execPath, DPF_DOCKER_PREFIX_ARGS: JSON.stringify([docker]),
        DPF_TEST_LAUNCH_REPORT: JSON.stringify(launch()) };
      const child = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 5_000 });
      assert.equal(child.status, 0, child.stderr);
      assert.deepEqual(JSON.parse(child.stdout), await imageEvidence.observeScopeWriterLaunch({ ...launchIdentity,
        runDocker: async () => env.DPF_TEST_LAUNCH_REPORT }));
      const unsafe = spawnSync(process.execPath, args, { env: { ...env,
        DPF_TEST_LAUNCH_REPORT: JSON.stringify({ ...launch(), privileged: true }) }, encoding: 'utf8', timeout: 5_000 });
      assert.equal(unsafe.status, 78);
      assert.equal(unsafe.stdout, '');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('closes over the attested launch and signed replacement cohort without a probe or a write', async () => {
    const h = harness();
    h.advance();
    const portal = { ...launch(), ...launchIdentity, id: '3'.repeat(64), project: 'dpf', networkMode: 'dpf_default' };
    portal.mounts[0].name = 'dpf_portal_actuator';
    const identity = { id: portal.id, image: launchImage, project: portal.project };
    const launchProof = await imageEvidence.observeScopeWriterLaunch({ ...identity, runDocker: async () => JSON.stringify(portal) });
    const retirement = { runId: 'SUR-CLOSED', targetSha: 'a'.repeat(40), project: portal.project, daemonId: 'daemon-example',
      retiredContainerIds: ['1'.repeat(64), '2'.repeat(64)], after: {
        portal: { id: portal.id, startedAt: '2026-10-16T01:00:10.000000005Z' },
        sandbox: { id: '4'.repeat(64), startedAt: '2026-10-16T01:00:20.000000001Z' },
      } };
    const calls = [];
    const runDocker = async (args, options) => {
      calls.push({ args, options });
      if (args.includes('name=dpf-promoter')) return '';
      if (args.includes(portal.id) && args.length === 6 && args[0] === 'inspect') return JSON.stringify(portal);
      return h.runDocker(args);
    };
    const binding = { launch: launchProof, retirement, runDocker, wallNow: () => finishAt.getTime() };
    const result = await imageEvidence.observeClosedScopeWriterCohort(binding);
    assert.equal(result.runId, retirement.runId);
    assert.equal(result.sourceSha, retirement.targetSha);
    assert.equal(result.cohort.portal.id, portal.id);
    assert.equal(result.launch.recipeDigest, launchProof.recipeDigest);
    assert(calls.every(({ args, options }) => ['info', 'ps', 'inspect'].includes(args[0])
      && options.timeoutMs > 0 && options.timeoutMs <= 2_000));
    await assert.rejects(imageEvidence.observeClosedScopeWriterCohort({ ...binding,
      launch: { ...launchProof, recipeDigest: '0'.repeat(64) },
    }), /scope_writer_cohort_unproven/);
    await assert.rejects(imageEvidence.observeClosedScopeWriterCohort({ ...binding, runDocker: async (args, options) =>
      args.includes('name=dpf-promoter') ? 'an-active-actuator' : runDocker(args, options),
    }), /scope_writer_cohort_unproven/);
  });

  it('binds launch evidence to the authenticated retirement bytes and refuses substituted evidence', async () => {
    const h = harness();
    const baseline = await captureMaintenanceEpoch({ ...identity, secret, runDocker: h.runDocker, now: captureAt });
    h.advance();
    const retirement = await finishMaintenanceEpoch({ baseline, secret, expected: identity, runDocker: h.runDocker, now: finishAt });
    const portal = { ...launch(), id: '3'.repeat(64), project: 'dpf', networkMode: 'dpf_default' };
    portal.mounts[0].name = 'dpf_portal_actuator';
    const runDocker = async args => {
      if (args[0] === 'inspect') return JSON.stringify(portal);
      if (args[0] === 'image') return launchImage;
      if (args[0] === 'run') return JSON.stringify({ schemaVersion: 1, serverSha256: '4'.repeat(64),
        routeSha256: '5'.repeat(64), manifestSha256: '6'.repeat(64) });
      throw new Error('unexpected actuator operation');
    };
    const evidence = await imageEvidence.collectScopeWriterLaunchEvidence({ retirement, secret, image: launchImage,
      currentRun: identity, runDocker, now: finishAt });
    const verified = imageEvidence.verifyScopeWriterLaunchEvidence({ evidence, retirement, secret, now: finishAt });
    assert.equal(verified.retirement.runId, identity.runId);
    assert.equal(verified.launch.id, portal.id);
    assert.equal(verified.launch.image, launchImage);
    assert.throws(() => imageEvidence.verifyScopeWriterLaunchEvidence({ evidence: { ...evidence,
      payload: evidence.payload.replace(launchImage, `sha256:${'f'.repeat(64)}`) }, retirement, secret, now: finishAt,
    }), /scope_writer_launch_evidence_invalid/);
    assert.throws(() => imageEvidence.verifyScopeWriterLaunchEvidence({ evidence, retirement: { ...retirement,
      signature: '0'.repeat(64) }, secret, now: finishAt }), /scope_writer_launch_evidence_invalid/);

    const stateDir = await mkdtemp(join(tmpdir(), 'dpf-writer-proof-'));
    try {
      const retirementPath = join(stateDir, 'maintenance-epoch-retirement.json');
      const retiredBytes = JSON.stringify(retirement);
      await writeFile(retirementPath, retiredBytes, { mode: 0o600 });
      await imageEvidence.persistScopeWriterLaunch({ stateDir, backupDir: stateDir, secret, image: launchImage,
        currentRun: identity, runDocker, now: finishAt });
      const restored = await imageEvidence.readScopeWriterObserverBinding({ stateDir, secret, now: finishAt });
      assert.deepEqual(restored, verified);
      assert.equal(await readFile(retirementPath, 'utf8'), retiredBytes);
      const { chmod } = await import('node:fs/promises');
      await chmod(join(stateDir, 'scope-writer-launch.json'), 0o666);
      await assert.rejects(imageEvidence.readScopeWriterObserverBinding({ stateDir, secret, now: finishAt }), /scope_writer_launch_evidence_invalid/);
    } finally { await rm(stateDir, { recursive: true, force: true }); }
  });

  for (const [name, change] of [
    ['a different image', o => { o.image = `sha256:${'d'.repeat(64)}`; }],
    ['a replacement ID', o => { o.id = 'd'.repeat(64); }],
    ['a different project', o => { o.project = 'other'; }],
    ['a stopped writer', o => { o.running = false; }],
    ['a writable root', o => { o.rootReadOnly = false; }],
    ['a root user', o => { o.user = '0:0'; }],
    ['a privileged writer', o => { o.privileged = true; }],
    ['an added capability', o => { o.capAdd = ['SYS_PTRACE']; }],
    ['a supplementary group', o => { o.groupAdd = ['120']; }],
    ['an injected device', o => { o.deviceRequests = [{ Driver: 'cdi' }]; }],
    ['an added device rule', o => { o.deviceRules = ['c 1:3 rwm']; }],
    ['a host user namespace override', o => { o.usernsMode = 'host'; }],
    ['a host cgroup namespace override', o => { o.cgroupnsMode = 'host'; }],
    ['a shared PID namespace', o => { o.pidMode = 'host'; }],
    ['an unconfined filter', o => { o.securityOpt.push('seccomp=unconfined'); }],
    ['a loader override', o => { o.loaderOverrides = ['NODE_OPTIONS']; }],
    ['a path override', o => { o.pathMatches = [false]; }],
    ['a shell command override', o => { o.args = ['sh', '-c', 'true']; }],
    ['an executable temporary directory', o => { o.tmpfs['/tmp'] = 'rw,nosuid,nodev,size=512m'; }],
    ['a loader path mount', o => { o.mounts.push({ type: 'bind', target: '/app/apps/web/.next', write: false }); }],
    ['the raw Docker socket', o => { o.mounts.push({ type: 'bind', target: '/var/run/docker.sock', write: false }); }],
    ['a writable actuator socket directory', o => { o.mounts[0].write = true; }],
    ['another actuator volume', o => { o.mounts[0].name = 'peer_portal_actuator'; }],
    ['shared bind propagation', o => { o.mounts[1].propagation = 'rshared'; }],
    ['an absent actuator socket directory', o => { o.mounts.shift(); }],
  ]) it(`refuses ${name} as a canonical scope writer launch`, async () => {
    const observed = launch();
    change(observed);
    assert.equal(typeof imageEvidence.observeScopeWriterLaunch, 'function');
    await assert.rejects(imageEvidence.observeScopeWriterLaunch({ ...launchIdentity,
      runDocker: async () => JSON.stringify(observed),
    }), /scope_writer_launch_unproven/);
  });

  it('keeps unknown or malformed probe failures distinct from positive legacy absence', async () => {
    const { classifyInitialScopeEpochFallback } = await import('./promoter-epoch-evidence.mjs');
    const image = 'sha256:' + 'a'.repeat(64);
    const runner = absent => async args => {
      if (args[0] === 'image') return image;
      if (args.includes('--eval')) { if (!absent) throw new Error('contract present or unavailable'); return 'legacy-scope-epoch-absent'; }
      if (args[0] === 'rm') return '';
      return '{}';
    };
    await assert.rejects(classifyInitialScopeEpochFallback({ image, runDocker: runner(false) }), /scope_writer_fallback_unproven/);
    assert.deepEqual(await classifyInitialScopeEpochFallback({ image, runDocker: runner(true) }), { kind: 'initial-legacy', image });
  });
});


import * as writerProbe from "../apps/web/lib/work-capsules/scope-epoch-writer-probe.mjs";
const { inspectScopeEpochWriters } = writerProbe;
import * as scopeWriterContract from "../apps/web/lib/work-capsules/scope-epoch-contract.ts";
const scopeProbeFixture = () => ({ root: "/packaged", loadContract: async () => scopeWriterContract,
  readFile: async path => Buffer.from(path.endsWith(".dpf-image-version") ? "a".repeat(40)
    : path.endsWith(".dpf-source-content-hash") ? "b".repeat(64) : `packaged source ${path}`) });
it("reports every declared writer's bytes independently of reassessment owners", async () => {
  const proof = await inspectScopeEpochWriters(scopeProbeFixture());
  assert.equal(proof.version, 1); assert.equal(proof.sourceSha, "a".repeat(40));
  assert.deepEqual(Object.keys(proof.writers), [...scopeWriterContract.SCOPE_EPOCH_WRITER_PATHS]);
  assert.ok(Object.values(proof.writers).every(hash => /^[a-f0-9]{64}$/.test(hash)));
  assert.equal(proof.owners, undefined);
});
it("a missing packaged writer is unknown, never a partial compatible report", async () => {
  const f = scopeProbeFixture(), read = f.readFile;
  f.readFile = async path => { if (path.endsWith("scope-release-preflight.ts")) throw new Error("missing"); return read(path); };
  await assert.rejects(inspectScopeEpochWriters(f), /scope_writer_probe_evidence_unavailable/);
});
it("rejects malformed source identity", async () => {
  const f = scopeProbeFixture(), read = f.readFile;
  f.readFile = async path => path.endsWith(".dpf-image-version") ? Buffer.from("unknown") : read(path);
  await assert.rejects(inspectScopeEpochWriters(f), /scope_writer_probe_identity_invalid/);
});

describe('actual served writer bundle evidence', () => {
  const root = '/fixture/app';
  const launcher = `${root}/apps/web/server.js`;
  const route = `${root}/apps/web/.next/server/app/api/mcp/v1/route.js`;
  const manifest = `${root}/apps/web/.next/server/app-paths-manifest.json`;
  const fixture = () => {
    const files = new Map([[launcher, 'compiled standalone entrypoint'], [route, 'compiled MCP route'],
      [manifest, JSON.stringify({ '/api/mcp/v1/route': 'app/api/mcp/v1/route.js' })]]);
    return { files, root,
      readFile: async path => { if (!files.has(path)) throw new Error('missing'); return Buffer.from(files.get(path)); },
      stat: async path => ({ isFile: () => files.has(path), size: Buffer.byteLength(files.get(path) ?? '') }),
      realpath: async path => path,
    };
  };

  it('binds the standalone server and the actual MCP route independently of copied sources', async () => {
    const f = fixture();
    const before = await writerProbe.inspectServedScopeWriter(f);
    assert.deepEqual(Object.keys(before), ['schemaVersion', 'serverSha256', 'routeSha256', 'manifestSha256']);
    f.files.set(route, 'changed emitted route');
    const after = await writerProbe.inspectServedScopeWriter(f);
    assert.equal(after.serverSha256, before.serverSha256);
    assert.notEqual(after.routeSha256, before.routeSha256);
  });

  it('refuses an external symlink or route manifest pointing outside the standalone server', async () => {
    const f = fixture();
    assert.equal(typeof writerProbe.inspectServedScopeWriter, 'function');
    await assert.rejects(writerProbe.inspectServedScopeWriter({ ...f,
      realpath: async path => path === route ? '/workspace/route.js' : path }), /scope_writer_probe_served_bundle_unproven/);
    f.files.set(manifest, JSON.stringify({ '/api/mcp/v1/route': '../../../../workspace/route.js' }));
    await assert.rejects(writerProbe.inspectServedScopeWriter(f), /scope_writer_probe_served_bundle_unproven/);
  });

  it('qualifies emitted bytes through the pinned, isolated promoter image probe', async () => {
    const image = `sha256:${'e'.repeat(64)}`;
    const served = await writerProbe.inspectServedScopeWriter(fixture());
    const calls = [];
    const evidence = await imageEvidence.inspectServedScopeWriterImage({ image, runDocker: async args => {
      calls.push(args);
      if (args[0] === 'image') return image;
      if (args[0] === 'run') return JSON.stringify(served);
      throw new Error('unexpected operation');
    } });
    assert.deepEqual(evidence, { image, ...served });
    const run = calls.find(args => args[0] === 'run');
    assert.deepEqual(run.slice(-3), [image, '/app/apps/web-src/lib/work-capsules/scope-epoch-writer-probe.mjs', '--served']);
    assert(run.includes('--read-only') && run.includes('--cap-drop') && run.includes('--network'));
    assert.equal(run.includes('--mount'), false);
    await assert.rejects(imageEvidence.inspectServedScopeWriterImage({ image, runDocker: async args =>
      args[0] === 'image' ? image : JSON.stringify({ ...served, routeSha256: 'not-a-hash' }),
    }), /scope_writer_served_image_unproven/);
  });
});

it("canonical shell candidate check refuses incompatible portal bytes independently", async () => {
  const { readFile } = await import("node:fs/promises"), { spawnSync } = await import("node:child_process");
  const source = await readFile(new URL("./promote.sh", import.meta.url), "utf8");
  const start = source.indexOf("# scope-writer-compatibility-begin"), end = source.indexOf("# scope-writer-compatibility-end");
  assert.ok(start >= 0 && end > start, "the actual promoter must contain its separate scope writer check");
  const block = source.slice(start, end);
  const proof = await inspectScopeEpochWriters(scopeProbeFixture());
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const { existsSync } = await import("node:fs");
  const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
  const dir = await mkdtemp(join(tmpdir(), "dpf-scope-shell-"));
  const dockerFixture = join(dir, "docker.mjs");
  await writeFile(dockerFixture, `const command = process.argv[2];
if (command === "image") process.stdout.write("sha256:${"c".repeat(64)}\\n");
else if (command === "run") process.stdout.write(process.env.SCOPE_REPORT ?? "");
else if (command !== "rm") process.exitCode = 77;
`);
  const { fileURLToPath } = await import("node:url");
  const scripts = fileURLToPath(new URL(".", import.meta.url));
  const shell = `_promoter_dir='${scripts.replaceAll("'", "'\\''")}'\n${block}\n_assert_scope_writer_image 'sha256:${"c".repeat(64)}' '${proof.sourceSha}'`;
  try {
  for (const [label, report, expected] of [["compatible", proof, 0], ["old", { ...proof, version: 0 }, 78],
    ["wrong source", { ...proof, sourceSha: "d".repeat(40) }, 78]]) {
    const result = spawnSync(bash, ["-c", shell], { encoding: "utf8", timeout: 5000,
      env: { ...process.env, DPF_DOCKER_BIN: process.execPath,
        DPF_DOCKER_PREFIX_ARGS: JSON.stringify([dockerFixture]), SCOPE_REPORT: JSON.stringify(report) } });
    assert.equal(result.status, expected, `${label}: ${result.stderr}`);
  }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// scripts/lib/dev-portal-lease-claim-key.test.mjs
// Node built-in test runner: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { readFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { realpath, mkdtemp, mkdir, writeFile, readFile, link, rm, symlink, unlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from 'node:http';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { createPreviewDeclaration, assertPreviewDeclarationFile, assertPreviewDeclarationMount, previewDeclarationMount, removePreviewDeclaration, reclaimPreviewDeclaration, stopDeclarationWriters, PREVIEW_DECLARATION_TARGET } from './dev-preview-declaration.mjs';
import { guardShellEnv } from './guard-bash.mjs';

const script = readFileSync(
  fileURLToPath(new URL("../dev-portal-lease.sh", import.meta.url)),
  "utf8",
);

const baseClaimKeyLine = script
  .split("\n")
  .find((l) => l.trim().startsWith("base_claim_key="));

// BI-D45898C0. The claim key is the server's idempotency key: environment-lease.ts
// does findUnique({ where: { claimKey } }). Keying it on the PID meant every
// invocation minted a new claim for the same preview, so a restart loop enqueued
// an unbounded set — ~35 waiting, one every ~31s, starving three unrelated
// pre-PR gates behind them.

test("the contributor-preview claim key identifies the resource, not the process", () => {
  assert.ok(baseClaimKeyLine, "base_claim_key assignment must exist");
  assert.match(baseClaimKeyLine, /\$\{WORKTREE_PATH\}/);
  assert.match(baseClaimKeyLine, /\$\{BRANCH\}/);
});

test("the claim key never carries the owner session id — that is what made re-claims unrecognisable", () => {
  assert.doesNotMatch(baseClaimKeyLine, /OWNER_SESSION_ID/);
});

test("the owner session id still travels as ownership, just not as identity of the claim", () => {
  // Attribution is still recorded; it simply must not key the claim.
  assert.match(script, /ownerSessionId/);
  assert.match(script, /resolveAgentIdentity/);
  assert.doesNotMatch(script, /OWNER_SESSION_ID="dev-portal-\$\$"/);
});

test("terminal keys are stopped instead of scanned or replaced", () => {
  assert.doesNotMatch(script, /MAX_TERMINAL_CLAIM_ATTEMPTS|terminal_claim_attempt_sequence|:rerun-/);
  assert.match(script, /terminal lease claim; stop/);
});

import { protectedServiceIdentity, REQUIRED_PREVIEW_DELIVERY_TOOLS, assertToolReadiness, assertPreviewConfig, assertPreviewContainer, assertAdmittedWorktreePath, previewOverride, runPreviewLifecycle, stopOwnedPreviewContainers, commandRunner } from './dev-preview-runtime.mjs';

test('preview diagnostics retain the failed exit code without child output or arguments', async () => {
  const secret = 'diagnostic-secret-must-not-escape';
  await assert.rejects(commandRunner().run(['-e', `console.log('${secret}'); console.error('${secret}'); process.exit(7)`], { bin: process.execPath }), error => {
    assert.equal(error.message, 'preview_operation_failed:exit-7');
    assert.ok(!error.message.includes(secret));
    return true;
  });
});

test('preview renewal receives a delayed transport response inside the existing lease lifetime', async t => {
  const { callPreviewMcp } = await import('./dev-preview-runtime.mjs');
  const server = createServer((request, response) => {
    request.resume();
    const timer = setTimeout(() => response.end(JSON.stringify({ result: {
      content: [{ type: 'text', text: JSON.stringify({ success: true, data: { expiresAt: '2026-10-14T12:02:00Z' } }) }],
    } })), 11_000);
    response.once('close', () => clearTimeout(timer));
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await callPreviewMcp('renew_nonprod_environment_lease', { leaseId: 'NPEL-TEST', ownerSessionId: 'fixture', ttlMinutes: 2 }, {
    mcpUrl: `http://127.0.0.1:${server.address().port}/api/mcp/v1`, bearerToken: 'fixture-local-only',
  });
  assert.equal(result.success, true);
});

test('preview diagnostics distinguish lease failure categories without retaining arbitrary reasons', async () => {
  const { previewLeaseEventSummary } = await import('./dev-preview-runtime.mjs');
  assert.equal(previewLeaseEventSummary({ type: 'heartbeat-renewed' }), null);
  assert.deepEqual(previewLeaseEventSummary({ type: 'authority-deadline', reason: 'lease-authority-deadline' }),
    { type: 'authority-deadline', category: 'authority-deadline' });
  assert.deepEqual(previewLeaseEventSummary({ type: 'heartbeat-lost', reason: 'preview_binding_changed' }),
    { type: 'heartbeat-lost', category: 'source-binding' });
  for (const reason of ['preview_startup_exceeded_budget', 'preview_init_not_running']) {
    assert.deepEqual(previewLeaseEventSummary({ type: 'heartbeat-lost', reason }), { type: 'heartbeat-lost', category: 'startup-liveness' });
  }
  assert.deepEqual(previewLeaseEventSummary({ type: 'heartbeat-uncertain', reason: 'mcp timed out after 10000ms diagnostic-secret-must-not-escape' }),
    { type: 'heartbeat-uncertain', category: 'transport-timeout' });
  assert.deepEqual(previewLeaseEventSummary({ type: 'release-failed', reason: 'diagnostic-secret-must-not-escape' }),
    { type: 'release-failed', category: 'unclassified' });
});
const identity = { worktree: resolve('/feature/worktree'), sha: 'a'.repeat(40), leaseId: 'NPEL-MINE' };
const config = () => {
  const result = previewOverride(identity);
  Object.assign(result.services['dev-init'].environment, { CONTRIBUTOR_PREVIEW_PASSWORD: 'only-in-memory',
    DATABASE_URL: 'postgresql://dpf:dpf_dev@dev-postgres:5432/dpf', PRODUCTION_DATABASE_URL: 'postgresql://source@postgres:5432/dpf' });
  result.services["dev-portal"].environment.DATABASE_URL = result.services["dev-init"].environment.DATABASE_URL;
  return result;
};

test('admission compares filesystem identity and rejects ambiguous or foreign paths', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dpf-preview-path-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const other = join(directory, 'other');
  mkdirSync(other);
  const canonical = await realpath(directory);
  await assertAdmittedWorktreePath(directory.replace(/\\/g, '/'), canonical);
  for (const invalid of [undefined, null, '', 'relative/worktree', other, join(directory, 'missing')]) {
    await assert.rejects(assertAdmittedWorktreePath(invalid, canonical), /admission_binding_mismatch/);
  }
});
test('configuration rejects the original root checkout mount and missing prerequisites before mutations', () => {
  assertPreviewConfig(config(), identity);
  const wrong = config(); wrong.services['dev-init'].volumes[0].source = '/root';
  assert.throws(() => assertPreviewConfig(wrong, identity), /mount_mismatch/);
  const missing = config(); delete missing.services['dev-init'].environment.CONTRIBUTOR_PREVIEW_PASSWORD;
  assert.throws(() => assertPreviewConfig(missing, identity), /prerequisites/);
  const production = config(); production.services['dev-portal'].environment.DPF_ENVIRONMENT_CLASS = 'production';
  assert.throws(() => assertPreviewConfig(production, identity), /identity_mismatch/);
});
test('actual Docker mount and source/lease labels must match the admitted preview', () => {
  const actual = { Mounts: [{ Type: 'bind', Source: identity.worktree, Destination: '/workspace' }], Config: { Labels: previewOverride(identity).services['dev-portal'].labels, Env: ["DPF_ENVIRONMENT_CLASS=development", `DPF_PREVIEW_SOURCE_SHA=${identity.sha}`, `DPF_PREVIEW_LEASE_ID=${identity.leaseId}`] } };
  assertPreviewContainer(actual, identity);
  actual.Mounts[0].Source = '/root';
  assert.throws(() => assertPreviewContainer(actual, identity), /actual_mount_mismatch/);
});
test('actual Docker Desktop Windows mount identifies only its admitted host worktree', () => {
  const windows = { ...identity, worktree: 'D:/DPF-worktrees/scoped-investment-balance' };
  const actual = { Mounts: [{ Type: 'bind', Source: '/run/desktop/mnt/host/d/DPF-worktrees/scoped-investment-balance', Destination: '/workspace' }], Config: { Labels: previewOverride(windows).services['dev-portal'].labels, Env: ['DPF_ENVIRONMENT_CLASS=development', `DPF_PREVIEW_SOURCE_SHA=${windows.sha}`, `DPF_PREVIEW_LEASE_ID=${windows.leaseId}`] } };
  assertPreviewContainer(actual, windows);
  for (const wrong of ['/run/desktop/mnt/host/e/DPF-worktrees/scoped-investment-balance', '/run/desktop/mnt/host/d/DPF-source-root', 'DPF-worktrees/scoped-investment-balance', '/run/desktop/mnt/host/d/DPF-worktrees/../DPF-source-root']) {
    actual.Mounts[0].Source = wrong;
    assert.throws(() => assertPreviewContainer(actual, windows), /actual_mount_mismatch/);
  }
});

const macIdentity = { ...identity, worktree: '/Users/markbodman/dpf-worktrees/reusable-continuation' };
const actualForMount = (source, target = macIdentity) => ({
  Mounts: [{ Type: 'bind', Source: source, Destination: '/workspace' }],
  Config: { Labels: previewOverride(target).services['dev-portal'].labels,
    Env: ['DPF_ENVIRONMENT_CLASS=development', `DPF_PREVIEW_SOURCE_SHA=${target.sha}`, `DPF_PREVIEW_LEASE_ID=${target.leaseId}`] },
});

test('actual Docker Desktop POSIX alias identifies the exact admitted Mac worktree', () => {
  const actual = actualForMount(`/host_mnt${macIdentity.worktree}`);
  assertPreviewContainer(actual, { ...macIdentity, dockerOperatingSystem: 'Docker Desktop' });
  const literal = { ...macIdentity, worktree: `/host_mnt${macIdentity.worktree}` };
  assertPreviewContainer(actualForMount(literal.worktree, literal), { ...literal, dockerOperatingSystem: 'Docker Desktop' });
  assertPreviewContainer(actualForMount(`/host_mnt${literal.worktree}`, literal), { ...literal, dockerOperatingSystem: 'Docker Desktop' });
});

test('a Desktop-looking POSIX path cannot supply engine proof or weaken path and binding checks', () => {
  const source = `/host_mnt${macIdentity.worktree}`;
  for (const dockerOperatingSystem of [undefined, '', 'Linux', 'Ubuntu 24.04 LTS', 'docker desktop', 'Docker Desktop other']) {
    assert.throws(() => assertPreviewContainer(actualForMount(source), { ...macIdentity, dockerOperatingSystem }), /actual_mount_mismatch/);
  }
  for (const wrong of ['/host_mnt/Users/markbodman/dpf', source.replace('/Users/', '/users/'),
    `${source}\0`, `${source}\r`, `${source}\n`, `/host_mnt${macIdentity.worktree}/../reusable-continuation`,
    `/host_mnt${macIdentity.worktree}/./`, source.slice(1), source.replace('/host_mnt/', '/host_mnt-other/'),
    `/other${source}`, `${source}-other`, `/host_mnt/host_mnt${macIdentity.worktree}`]) {
    assert.throws(() => assertPreviewContainer(actualForMount(wrong), { ...macIdentity, dockerOperatingSystem: 'Docker Desktop' }), /actual_mount_mismatch/);
  }
  for (const invalid of [`${macIdentity.worktree}\n`, '/Users/markbodman/dpf-worktrees/../reusable-continuation', 'Users/feature']) {
    assert.throws(() => assertPreviewContainer(actualForMount(source), { ...macIdentity, worktree: invalid, dockerOperatingSystem: 'Docker Desktop' }), /actual_mount_mismatch/);
  }
});

test('Desktop alias still enforces every actual container environment and identity field', () => {
  for (const entry of ['DPF_ENVIRONMENT_CLASS=development', `DPF_PREVIEW_SOURCE_SHA=${macIdentity.sha}`, `DPF_PREVIEW_LEASE_ID=${macIdentity.leaseId}`]) {
    const actual = actualForMount(`/host_mnt${macIdentity.worktree}`);
    actual.Config.Env = actual.Config.Env.filter(value => value !== entry);
    assert.throws(() => assertPreviewContainer(actual, { ...macIdentity, dockerOperatingSystem: 'Docker Desktop' }), /actual_environment_mismatch/);
  }
  for (const label of ['dpf.preview.sha', 'dpf.preview.lease']) {
    const actual = actualForMount(`/host_mnt${macIdentity.worktree}`);
    actual.Config.Labels[label] = 'foreign';
    assert.throws(() => assertPreviewContainer(actual, { ...macIdentity, dockerOperatingSystem: 'Docker Desktop' }), /actual_identity_mismatch/);
  }
});

test('each keeper inspection reads bounded daemon metadata anew and fences an alias after engine changes', async () => {
  const { inspectPreviewBinding } = await import('./dev-preview-runtime.mjs');
  let operatingSystem = 'Docker Desktop';
  const calls = [];
  const runner = { run: async (args, options) => {
    calls.push({ args, options });
    if (args[0] === 'info') return operatingSystem;
    assert.deepEqual(args, ['inspect', 'fixture-container']);
    return JSON.stringify([actualForMount(`/host_mnt${macIdentity.worktree}`)]);
  } };
  await inspectPreviewBinding({ runner, id: 'fixture-container', identity: macIdentity });
  operatingSystem = 'Ubuntu 24.04 LTS';
  await assert.rejects(inspectPreviewBinding({ runner, id: 'fixture-container', identity: macIdentity }), /actual_mount_mismatch/);
  operatingSystem = '';
  await assert.rejects(inspectPreviewBinding({ runner, id: 'fixture-container', identity: macIdentity }), /actual_mount_mismatch/);
  const infoCalls = calls.filter(call => call.args[0] === 'info');
  assert.equal(infoCalls.length, 3);
  for (const call of infoCalls) {
    assert.deepEqual(call.args, ['info', '--format', '{{.OperatingSystem}}']);
    assert.equal(call.options.timeoutMs, 10000);
  }
});

test('failed engine metadata holds the new alias and preserves direct POSIX and Windows keeper bindings', async () => {
  const { inspectPreviewBinding } = await import('./dev-preview-runtime.mjs');
  const windows = { ...identity, worktree: 'D:/DPF-worktrees/scoped-investment-balance' };
  for (const [target, source, passes] of [[macIdentity, `/host_mnt${macIdentity.worktree}`, false],
    [macIdentity, macIdentity.worktree, true], [windows, '/run/desktop/mnt/host/d/DPF-worktrees/scoped-investment-balance', true]]) {
    const runner = { run: async args => {
      if (args[0] === 'info') throw new Error('private daemon output');
      return JSON.stringify([actualForMount(source, target)]);
    } };
    const check = inspectPreviewBinding({ runner, id: 'fixture-container', identity: target });
    if (passes) await check;
    else await assert.rejects(check, /actual_mount_mismatch/);
  }
});

test('bounded preview command timeout terminates only its child without leaking output', async () => {
  const runner = commandRunner();
  const otherChild = runner.run(['-e', "setTimeout(() => console.log('unrelated-result'), 75)"], { bin: process.execPath });
  await assert.rejects(runner.run(['-e', "console.log('private-child-output'); setTimeout(() => {}, 250)"],
    { bin: process.execPath, timeoutMs: 25 }), error => {
    assert.equal(error.message, 'preview_operation_timeout');
    assert.ok(!error.message.includes('private-child-output'));
    return true;
  });
  assert.equal(await otherChild, 'unrelated-result');
});

test('startup isolates dependencies, waits for clone success, verifies actual binding, then permits serving', async () => {
  const calls = [];
  await runPreviewLifecycle({ compose: async args => calls.push(args), inspect: async () => calls.push('inspect'),
    verifySource: async () => calls.push('source'), stopOwned: async () => calls.push('cleanup'),
    ready: async () => calls.push('ready'), wait: async () => {}, active: { initName: 'unique-init' } });
  assert.deepEqual(calls, ['source', ['stop', 'dev-portal'],
    ['up', '-d', '--no-deps', '--no-recreate', '--no-build', '--wait', 'dev-postgres'],
    ['run', '--rm', '--no-deps', '--name', 'unique-init', 'dev-init'], 'source',
    ['up', '-d', '--no-deps', '--no-build', 'dev-portal'], 'inspect', 'ready', 'cleanup']);
});
test('failed clone never starts or serves a portal', async () => {
  const calls = [];
  await assert.rejects(runPreviewLifecycle({ compose: async args => { calls.push(args); if (args[0] === 'run') throw new Error('OOM'); },
    inspect: async () => assert.fail('must not inspect a served preview'), verifySource: async () => {},
    stopOwned: async () => calls.push('cleanup'), ready: async () => assert.fail('must not serve'),
    wait: async () => {}, active: { initName: 'failed-init' } }), /OOM/);
  assert.equal(calls.some(args => Array.isArray(args) && args[0] === 'up' && args.at(-1) === 'dev-portal'), false);
  assert.equal(calls.at(-1), 'cleanup');
});
test('changed worktree is refused before any runtime mutation', async () => {
  await assert.rejects(runPreviewLifecycle({ verifySource: async () => { throw new Error('source_changed'); },
    compose: async () => assert.fail('runtime mutation'), active: {} }), /source_changed/);
});

test('startup checks the whole shared delivery contract and both permission layers', () => {
  const granted = name => ({ name, serverHasTool: true, tokenGranted: true, agentGranted: true, callableByName: true });
  const rows = REQUIRED_PREVIEW_DELIVERY_TOOLS.map(granted);
  assertToolReadiness({ status: rows });
  assert.ok(REQUIRED_PREVIEW_DELIVERY_TOOLS.includes('review_semantic_change'));
  const unbound = rows.map(row => ({ ...row, agentGranted: null }));
  assertToolReadiness({ result: { content: [{ type: 'text', text: JSON.stringify({ status: unbound }) }] } });
  for (const bad of [{ ...rows[0], agentGranted: false }, { ...rows[0], tokenGranted: false },
    { ...unbound[0], tokenGranted: false }, { ...unbound[0], callableByName: false },
    { ...unbound[0], callableByName: undefined }, { ...unbound[0], serverHasTool: false },
    { ...unbound[0], agentGranted: undefined }, { ...unbound[0], agentGranted: 'true' }]) {
    assert.throws(() => assertToolReadiness({ count: 100, status: [bad, ...rows.slice(1)] }), /permissions_incomplete/);
  }
  assert.throws(() => assertToolReadiness({ status: [...rows, rows[0]] }), /permissions_incomplete/);
  assert.throws(() => assertToolReadiness({ status: rows.filter(row => row.name !== 'review_semantic_change') }), /permissions_incomplete/);
  assert.throws(() => assertToolReadiness({ loadedToolNames: REQUIRED_PREVIEW_DELIVERY_TOOLS }), /permissions_incomplete/);
});

test('protected live-service identity detects recreation, restart or volume substitution', () => {
  const container = { Id: 'live-db', Config: { Labels: { 'com.docker.compose.service': 'postgres' } }, State: { Running: true, StartedAt: 'before' }, Mounts: [{ Type: 'volume', Name: 'live-data', Destination: '/var/lib/postgresql/data' }] };
  const before = protectedServiceIdentity([container]);
  assert.notDeepEqual(protectedServiceIdentity([{ ...container, Id: 'recreated-db' }]), before);
  assert.notDeepEqual(protectedServiceIdentity([{ ...container, State: { ...container.State, StartedAt: 'after' } }]), before);
  assert.notDeepEqual(protectedServiceIdentity([{ ...container, Mounts: [{ ...container.Mounts[0], Name: 'wrong-data' }] }]), before);
});

test('preserved feature initialization takes the bounded clone from the canonical image', () => {
  const cloneImage = `sha256:${'b'.repeat(64)}`;
  const override = previewOverride({ ...identity, cloneImage });
  assert.equal(override.services['dev-init'].image, cloneImage);
  assert.deepEqual(override.services['dev-init'].entrypoint, ['/bin/sh', '-c']);
  assert.match(override.services['dev-init'].command[0], /cd \/workspace.*migrate-deploy.*cd \/app.*sanitized-clone/);
  assert.equal(override.services['dev-init'].volumes[0].source, identity.worktree);
  assert.equal(override.services['dev-portal'].volumes[0].source, identity.worktree);
});

for (const interruption of ['compose-error-after-start', 'lease-fence-before-inspect']) {
  test(`cleanup finds an unrecorded portal after ${interruption} and preserves foreign/live containers`, async () => {
    const labels = { 'dpf.preview.lease': identity.leaseId, 'com.docker.compose.project': 'dpf', 'com.docker.compose.service': 'dev-portal' };
    const containers = [
      { Id: 'mine', Config: { Labels: labels } },
      { Id: 'foreign', Config: { Labels: { ...labels, 'dpf.preview.lease': 'NPEL-FOREIGN' } } },
      { Id: 'other-project', Config: { Labels: { ...labels, 'com.docker.compose.project': 'other' } } },
      { Id: 'live', Config: { Labels: { ...labels, 'com.docker.compose.service': 'portal' } } },
    ];
    let started = false;
    const stopped = [];
    const runner = { run: async args => {
      if (args[0] === 'ps') return args.some(arg => arg.startsWith('name=')) ? '' : started ? containers.map(c => c.Id).join('\n') : '';
      if (args[0] === 'inspect') return JSON.stringify(containers.filter(c => args.slice(1).includes(c.Id)));
      if (args[0] === 'stop') { stopped.push(args[1]); return ''; }
      assert.fail(`unexpected docker command ${args}`);
    } };
    const cleanup = () => stopOwnedPreviewContainers({ runner, leaseId: identity.leaseId, projectName: 'dpf', initName: 'unique-init', ownedIds: new Set() });
    await assert.rejects(runPreviewLifecycle({
      compose: async args => { if (args[0] === 'up' && args.at(-1) === 'dev-portal') { started = true; if (interruption.startsWith('compose-error')) throw new Error(interruption); await cleanup(); throw new Error(interruption); } },
      inspect: async () => assert.fail('interruption precedes inspection'), verifySource: async () => {},
      stopOwned: cleanup, ready: async () => assert.fail('must not serve'), wait: async () => {}, active: { initName: 'unique-init' },
    }), new RegExp(interruption));
    assert.ok(stopped.includes('mine'), 'partially started portal must be stopped even without a recorded ID');
    assert.ok(stopped.every(id => id === 'mine'), 'cleanup must preserve foreign projects, leases and live services');
  });
}


test('the policy claim-key suite runs without installed workspace dependencies', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'dpf-claim-key-no-deps-'));
  try {
    const source = dirname(fileURLToPath(import.meta.url));
    mkdirSync(join(fixture, 'scripts'), { recursive: true });
    cpSync(source, join(fixture, 'scripts/lib'), { recursive: true });
    cpSync(join(source, '../dev-portal-lease.sh'), join(fixture, 'scripts/dev-portal-lease.sh'));
    const shared = join(fixture, 'packages/integration-shared/src');
    mkdirSync(shared, { recursive: true });
    cpSync(join(source, '../../packages/integration-shared/src/delivery-readiness-contract.cjs'), join(shared, 'delivery-readiness-contract.cjs'));
    cpSync(join(source, '../../packages/integration-shared/src/preview-mount-identity.cjs'), join(shared, 'preview-mount-identity.cjs'));
    // mcp-credential.mjs re-exports the client_credentials exchange from the skill pack (BI-84C1F526).
    const packLib = join(fixture, 'packages/dpf-skill-pack/scripts/lib');
    mkdirSync(packLib, { recursive: true });
    cpSync(join(source, '../../packages/dpf-skill-pack/scripts/lib/client-credentials-exchange.mjs'), join(packLib, 'client-credentials-exchange.mjs'));
    const { NODE_TEST_CONTEXT: inheritedTestContext, ...env } = process.env;
    const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=^the contributor-preview', join(fixture, 'scripts/lib/dev-portal-lease-claim-key.test.mjs')], { encoding: 'utf8', cwd: fixture, env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

import { EXIT_SOURCE_DRIFT } from "./sandbox-freshness.mjs";
const pin = { worktree: resolve('/feature/worktree'), branch: 'feat/example', sha: 'a'.repeat(40),
  ownerProvider: 'codex', ownerSessionId: 'session', resumeLeaseId: 'NPEL-ABC123',
  taskRunId: 'TR-NONPROD-ABC123', claimKey: 'preview:immutable', mcpUrl: 'https://localhost/api/mcp/v1',
  waitDeadline: '2026-10-14T12:00:00Z' };
const now = () => Date.parse('2026-10-14T11:00:00Z');
const source = () => ({ sha: pin.sha, branch: pin.branch, dirty: false });

test('queued preview registers the existing durable consumer with frozen source and lease identity', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  let registration;
  const result = await resumePreviewQueue(pin, { now, readSource: source, observerDirectory: '/observers',
    env: { DPF_LOCAL_CI_TEST_WORKERS: '2' },
    spawnResumer: args => { registration = args; return { spawned: true, survivesSession: true, pid: 123 }; },
    runChild: () => assert.fail('queued registration must not start a runtime') });
  assert.equal(result.code, 75);
  assert.equal(result.spawned, true);
  assert.deepEqual(registration.pin, { branch: pin.branch, sha: pin.sha, worktree: pin.worktree,
    ownerProvider: pin.ownerProvider, ownerSessionId: pin.ownerSessionId, resumeLeaseId: pin.resumeLeaseId });
  assert.equal(registration.deadlineMs, 60 * 60_000);
  assert.equal(registration.env.DPF_LOCAL_CI_TEST_WORKERS, '2');
  assert.ok(registration.gateArgv.includes(pin.taskRunId));
  assert.ok(registration.gateArgv.includes(pin.claimKey));
});

test('a queued preview accepts the canonical ?tier=full endpoint and still refuses other URL extras', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  const register = () => ({ spawned: true, survivesSession: true, pid: 123 });
  // The bootstrap persists DPF_MCP_URL as <PUBLIC_URL>/api/mcp/v1?tier=full (BI-F91D4DB7).
  const canonical = await resumePreviewQueue({ ...pin, mcpUrl: 'https://localhost/api/mcp/v1?tier=full' },
    { now, readSource: source, observerDirectory: '/observers', spawnResumer: register });
  assert.equal(canonical.code, 75);
  assert.equal(canonical.spawned, true);
  for (const mcpUrl of ['https://localhost/api/mcp/v1?tier=full&token=x', 'https://localhost/api/mcp/v1?tier=core',
    'https://localhost/api/mcp/v1?token=x', 'https://localhost/api/mcp/v1#frag', 'https://user:pw@localhost/api/mcp/v1?tier=full']) {
    const refused = await resumePreviewQueue({ ...pin, mcpUrl }, { now, readSource: source,
      spawnResumer: () => assert.fail(`${mcpUrl} must not register`) });
    assert.equal(refused.reason, 'invalid-pin', mcpUrl);
  }
});

test('the registered preview consumer reclaims the same lease without forking another consumer', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  let command;
  const result = await resumePreviewQueue(pin, { now, readSource: source, env: { DPF_DURABLE_RESUME: '1' },
    spawnResumer: () => assert.fail('recursive consumer'),
    runChild: args => { command = args; return Promise.resolve(75); } });
  assert.equal(result.code, 75);
  assert.ok(command.args.includes('refresh'));
  assert.equal(command.env.DPF_DEV_PORTAL_RESUME_LEASE_ID, pin.resumeLeaseId);
  assert.equal(command.env.DPF_DEV_PORTAL_TASK_RUN_ID, pin.taskRunId);
  assert.equal(command.env.DPF_DEV_PORTAL_CLAIM_KEY, pin.claimKey);
  assert.equal(command.env.DPF_DEV_PORTAL_EXPECTED_SOURCE_SHA, pin.sha);
  assert.equal(command.env.DPF_DEV_PORTAL_EXPECTED_BRANCH, pin.branch);
});

test('the actual shell refuses same-SHA branch drift and newly dirty source before claiming', async t => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  const worktree = mkdtempSync(join(tmpdir(), 'dpf-preview-queue-race-'));
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'feat/pinned']);
  writeFileSync(join(worktree, 'fixture.txt'), 'fixture');
  git(['add', 'fixture.txt']);
  git(['-c', 'user.name=Preview Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  const sha = git(['rev-parse', 'HEAD']);
  const cliPin = { ...pin, worktree, sha, branch: 'feat/pinned', waitDeadline: new Date(Date.now() + 120_000).toISOString() };
  const cliArgs = Object.entries(cliPin).flatMap(([key, value]) => [`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value]);
  const replay = spawnSync(process.execPath, [fileURLToPath(new URL('../dev-preview-queue-resume.mjs', import.meta.url)),
    ...cliArgs, '--sha', sha, '--branch', 'feat/pinned', '--resume-lease-id', pin.resumeLeaseId],
  { cwd: worktree, env: { ...process.env, DPF_DURABLE_RESUME: '', DPF_DURABLE_RESUMER: 'off' }, encoding: 'utf8' });
  assert.equal(replay.status, 75, replay.stderr);
  assert.equal(JSON.parse(replay.stderr.trim()).reason, 'disabled');
  const deps = { now, env: { ...guardShellEnv(), DPF_DURABLE_RESUME: '1', DPF_DEV_PORTAL_CURL_BIN: 'missing-preview-test-transport', DPF_DEV_PORTAL_BRANCH: 'feat/original' } };
  const branchDrift = await resumePreviewQueue({ ...pin, worktree, sha, branch: 'feat/original', mcpUrl: 'http://127.0.0.1:1/api/mcp/v1' },
    { ...deps, readSource: () => ({ sha, branch: 'feat/original', dirty: false }) });
  assert.equal(branchDrift.code, EXIT_SOURCE_DRIFT);
  writeFileSync(join(worktree, 'fixture.txt'), 'changed');
  const dirty = await resumePreviewQueue({ ...pin, worktree, sha, branch: 'feat/pinned', mcpUrl: 'http://127.0.0.1:1/api/mcp/v1' },
    { ...deps, readSource: () => ({ sha, branch: 'feat/pinned', dirty: false }) });
  assert.equal(dirty.code, EXIT_SOURCE_DRIFT);
});

test('the actual shell refuses source drift between consumer inspection and its claim', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  const worktree = fileURLToPath(new URL('../../', import.meta.url));
  const sha = '0'.repeat(40);
  const result = await resumePreviewQueue({ ...pin, worktree, sha, mcpUrl: 'http://127.0.0.1:1/api/mcp/v1' }, {
    now, readSource: () => ({ sha, branch: pin.branch, dirty: false }),
    env: { ...guardShellEnv(), DPF_DURABLE_RESUME: '1', DPF_DEV_PORTAL_CURL_BIN: 'missing-preview-test-transport' },
  });
  assert.equal(result.code, EXIT_SOURCE_DRIFT);
});

test('moved or dirty source stops before reclaiming or starting anything', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  for (const actual of [{ ...source(), sha: 'b'.repeat(40) }, { ...source(), branch: 'feat/other' }, { ...source(), dirty: true }]) {
    const result = await resumePreviewQueue(pin, { now, readSource: () => actual,
      spawnResumer: () => assert.fail('drift must not register'), runChild: () => assert.fail('drift must not reclaim') });
    assert.equal(result.code, EXIT_SOURCE_DRIFT);
  }
});

test('expired waits and an explicitly disabled consumer do not mutate the queued claim', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  const deps = { now, readSource: source, spawnResumer: () => assert.fail('must not register'), runChild: () => assert.fail('must not reclaim') };
  const expired = await resumePreviewQueue({ ...pin, waitDeadline: '2026-10-14T10:59:00Z' }, deps);
  assert.equal(expired.reason, 'wait-deadline');
  const disabled = await resumePreviewQueue(pin, { ...deps, env: { DPF_DURABLE_RESUMER: 'off' } });
  assert.equal(disabled.reason, 'disabled');
});

test('admitted child outcomes are retained and untrusted launcher reasons never escape', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  for (const code of [0, 1]) {
    assert.equal((await resumePreviewQueue(pin, { now, readSource: source, env: { DPF_DURABLE_RESUME: '1' }, runChild: () => code })).code, code);
  }
  const result = await resumePreviewQueue(pin, { now, readSource: source, observerDirectory: '/observers',
    spawnResumer: () => ({ spawned: false, reason: 'secret-must-not-escape' }) });
  assert.equal(result.reason, 'consumer-unavailable');
  assert.ok(!JSON.stringify(result).includes('secret-must-not-escape'));
});

// BI-E95458DE: a preview renewed its CI-slot lease for ~86 minutes before any
// portal container existed. Renewal checked the container only once it was
// owned, so the whole initialization stage renewed unchecked and unbounded.
test('startup reports each phase so renewal can tell initializing from serving', async () => {
  const { runPreviewLifecycle: run } = await import('./dev-preview-runtime.mjs');
  const calls = [];
  await run({ compose: async args => calls.push(args[0] === 'run' ? 'init-run' : args[0]), inspect: async () => {},
    verifySource: async () => {}, stopOwned: async () => {}, ready: async () => calls.push('ready'), wait: async () => {},
    onPhase: phase => calls.push(`phase:${phase}`), active: { initName: 'unique-init' } });
  assert.deepEqual(calls, ['stop', 'up', 'phase:init', 'init-run', 'phase:start', 'up', 'ready', 'phase:serving']);
});

test('renewal refuses a startup that stalls or outlives its budget, and defers to the container once serving', async () => {
  const { previewStartupLiveness, PREVIEW_STARTUP_BUDGET_MS, PREVIEW_INIT_GRACE_MS } = await import('./dev-preview-runtime.mjs');
  const base = { startedAtMs: 0, phaseStartedAtMs: 0, initRunning: true };
  assert.equal(previewStartupLiveness({ ...base, phase: 'init', nowMs: 60_000 }), null);
  // The init container is gone but the lifecycle has not moved on: nothing is initializing.
  assert.equal(previewStartupLiveness({ ...base, phase: 'init', initRunning: false, nowMs: PREVIEW_INIT_GRACE_MS + 1 }), 'preview_init_not_running');
  // Docker may not have created the container yet at the first renewal.
  assert.equal(previewStartupLiveness({ ...base, phase: 'init', initRunning: false, nowMs: PREVIEW_INIT_GRACE_MS - 1 }), null);
  for (const phase of ['prepare', 'init', 'start']) {
    assert.equal(previewStartupLiveness({ ...base, phase, nowMs: PREVIEW_STARTUP_BUDGET_MS + 1 }), 'preview_startup_exceeded_budget');
  }
  assert.equal(previewStartupLiveness({ ...base, phase: 'serving', initRunning: false, nowMs: PREVIEW_STARTUP_BUDGET_MS * 10 }), null);
  assert.equal(PREVIEW_STARTUP_BUDGET_MS, 20 * 60_000);
});

test('the startup budget is operator-tunable and ignores unusable values', async () => {
  const { previewStartupBudgetMs, PREVIEW_STARTUP_BUDGET_MS } = await import('./dev-preview-runtime.mjs');
  assert.equal(previewStartupBudgetMs({ DPF_DEV_PORTAL_STARTUP_BUDGET_MINUTES: '45' }), 45 * 60_000);
  for (const bad of [undefined, '', '0', '-3', 'soon']) {
    assert.equal(previewStartupBudgetMs({ DPF_DEV_PORTAL_STARTUP_BUDGET_MINUTES: bad }), PREVIEW_STARTUP_BUDGET_MS);
  }
});

// BI-6B109903: generated declaration lifetime and strict source fencing.
const original = '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/types/routes.d.ts";\nimport "./.next/types/root-params.d.ts";\n';

test('the real Next development writer changes only the projected runtime declaration, leaving admitted Git source clean', async t => {
  const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
  try { webRequire.resolve('next/package.json'); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    t.skip('UNRUN: Next is not installed in this dependency-free checkout; dependency-present qualification must execute the real writer.');
    return;
  }
  // A present package with a missing or broken writer must fail, not skip.
  const { writeAppTypeDeclarations } = webRequire('next/dist/lib/typescript/writeAppTypeDeclarations.js');
  const directory = await mkdtemp(join(tmpdir(), 'dpf-preview-declaration-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  const app = join(source, 'apps/web');
  await mkdir(app, { recursive: true });
  const declaration = join(app, 'next-env.d.ts');
  await writeFile(declaration, original);
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Preview Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const generate = baseDir => writeAppTypeDeclarations({ baseDir, distDir: '.next/dev', imageImportsEnabled: true, hasAppDir: true, hasPagesDir: false });

  // Reproduce the incumbent failure with the installed writer, not a stub.
  await generate(app);
  assert.match(git(['status', '--porcelain']), /M apps\/web\/next-env.d.ts/);
  await writeFile(declaration, original);
  assert.equal(git(['status', '--porcelain']), '');

  const backing = join(directory, 'owned-next-env.d.ts');
  await writeFile(backing, original, { mode: 0o600 });
  const override = previewOverride({ worktree: source, sha: git(['rev-parse', 'HEAD']), leaseId: 'NPEL-FIXTURE', declarationPath: backing });
  const mount = override.services['dev-portal'].volumes.find(item => item.target === '/workspace/apps/web/next-env.d.ts');
  assert.ok(mount, 'the preview must project a runtime-owned file over the generated declaration');
  assert.equal(mount.source, backing);
  assert.equal(mount.type, 'bind');
  assert.equal(mount.bind.create_host_path, false);
  const runtime = join(directory, 'runtime');
  await mkdir(runtime);
  // This hardlink models the real writer's direct-write inode behavior only;
  // a governed preview separately proves native Docker mount behavior.
  await link(mount.source, join(runtime, 'next-env.d.ts'));
  await generate(runtime);
  assert.match(await readFile(backing, 'utf8'), /\.next\/dev\/types\/routes/);
  assert.equal(await readFile(declaration, 'utf8'), original);
  assert.equal(git(['status', '--porcelain']), '');
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dpf-preview-owned-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worktree = join(directory, 'source');
  const stateDirectory = join(directory, 'state');
  await mkdir(join(worktree, 'apps/web'), { recursive: true });
  await mkdir(stateDirectory);
  await writeFile(join(worktree, 'apps/web/next-env.d.ts'), original);
  return { directory, worktree, stateDirectory };
}

for (const replacement of ['regular', 'symlink']) {
  test(`seed path replacement after its regular-file check is refused (${replacement})`, async t => {
    const input = await fixture(t);
    const seed = await realpath(join(input.worktree, 'apps/web/next-env.d.ts'));
    const foreign = join(input.directory, 'foreign-seed');
    await writeFile(foreign, 'foreign seed bytes');
    const originalLstat = fs.promises.lstat;
    let replaced = false;
    t.mock.method(fs.promises, 'lstat', async (...args) => {
      const checked = await originalLstat(...args);
      if (args[0] === seed && !replaced) {
        replaced = true;
        if (replacement === 'regular') await fs.promises.rename(foreign, seed);
        else { await unlink(seed); await symlink(foreign, seed); }
      }
      return checked;
    });
    syncBuiltinESMExports();
    let failure;
    try {
      await createPreviewDeclaration(input);
    } catch (error) {
      failure = error;
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
    assert.equal(replaced, true, 'the real seed pathname changed after its check');
    assert.ok(failure, 'a raced seed must be refused before foreign bytes can supply backing');
    assert.match(failure.message, /preview_declaration_seed_(invalid|changed)/);
    assert.deepEqual(await fs.promises.readdir(input.stateDirectory), [], 'no backing may be created from a raced seed');
  });
}

for (const fault of ['open-error', 'stat-error', 'read-error', 'path-swap', 'content-mutation', 'path-missing', 'post-read-stat-error', 'close-error']) {
  test(`seed descriptor failure refuses backing and closes every opened handle (${fault})`, async t => {
    const input = await fixture(t);
    const seed = await realpath(join(input.worktree, 'apps/web/next-env.d.ts'));
    const foreign = join(input.directory, 'foreign-seed');
    await writeFile(foreign, 'foreign seed bytes');
    const originalOpen = fs.promises.open;
    let opened = false, openCalls = 0, closeCalls = 0, readCalls = 0;
    t.mock.method(fs.promises, 'open', async (...args) => {
      openCalls += 1;
      if (fault === 'open-error') throw Object.assign(new Error('seed-open-fixture-error'), { code: 'EACCES' });
      const handle = await originalOpen(...args);
      opened = true;
      const close = handle.close.bind(handle);
      t.mock.method(handle, 'close', async (...closeArgs) => {
        closeCalls += 1;
        await close(...closeArgs);
        if (fault === 'close-error') throw new Error('seed-close-fixture-error');
      });
      const stat = handle.stat.bind(handle);
      let statCalls = 0;
      t.mock.method(handle, 'stat', async (...statArgs) => {
        statCalls += 1;
        if (fault === 'stat-error' || (fault === 'post-read-stat-error' && statCalls === 2)) throw new Error('seed-stat-fixture-error');
        return stat(...statArgs);
      });
      const read = handle.readFile.bind(handle);
      t.mock.method(handle, 'readFile', async (...readArgs) => {
        readCalls += 1;
        if (fault === 'read-error') throw new Error('seed-read-fixture-error');
        const bytes = await read(...readArgs);
        if (fault === 'path-swap') await fs.promises.rename(foreign, seed);
        if (fault === 'path-missing') await unlink(seed);
        if (fault === 'content-mutation') {
          await writeFile(seed, 'x'.repeat(bytes.length));
          await fs.promises.utimes(seed, 0, 0);
        }
        return bytes;
      });
      return handle;
    });
    syncBuiltinESMExports();
    let failure;
    try { await createPreviewDeclaration(input); } catch (error) { failure = error; }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.ok(failure, 'seed uncertainty must refuse before backing creation');
    assert.equal(openCalls, 1, 'a refused open is never retried with weaker flags');
    assert.equal(closeCalls, opened ? 1 : 0, 'every opened seed descriptor closes on failure');
    assert.equal(readCalls, ['open-error', 'stat-error'].includes(fault) ? 0 : 1);
    assert.deepEqual(await fs.promises.readdir(input.stateDirectory), []);
  });
}

test('the validated seed descriptor closes before backing storage is created', async t => {
  const input = await fixture(t);
  const originalOpen = fs.promises.open;
  let closeCalls = 0;
  t.mock.method(fs.promises, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    const close = handle.close.bind(handle);
    t.mock.method(handle, 'close', async (...closeArgs) => {
      const pendingBacking = await fs.promises.readdir(input.stateDirectory);
      await close(...closeArgs);
      closeCalls += 1;
      assert.deepEqual(pendingBacking, []);
    });
    return handle;
  });
  syncBuiltinESMExports();
  let declaration;
  try { declaration = await createPreviewDeclaration(input); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(closeCalls, 1);
  assert.equal(await readFile(declaration.path, 'utf8'), original);
  await removePreviewDeclaration(declaration);
});

test('owned declaration uses exact seed bytes, private regular files and fresh attempt identity', async t => {
  const input = await fixture(t);
  const first = await createPreviewDeclaration(input);
  const second = await createPreviewDeclaration(input);
  assert.notEqual(first.path, second.path);
  assert.equal(await readFile(first.path, 'utf8'), original);
  if (process.platform !== 'win32') {
    assert.equal((await lstat(first.directory)).mode & 0o777, 0o700);
    assert.equal((await lstat(first.path)).mode & 0o777, 0o600);
  }
  await writeFile(first.path, 'generated content');
  await assertPreviewDeclarationFile(first);
  await removePreviewDeclaration(first);
  await removePreviewDeclaration(second);
  await assert.rejects(lstat(first.path), { code: 'ENOENT' });
});

test('backing inside source, ignored directories and symlinked seeds are refused', async t => {
  const input = await fixture(t);
  for (const name of ['node_modules', '..looks-outside']) {
    const stateDirectory = join(input.worktree, name);
    await mkdir(stateDirectory);
    await assert.rejects(createPreviewDeclaration({ ...input, stateDirectory }), /inside_source/);
  }
  const seed = join(input.worktree, 'apps/web/next-env.d.ts');
  await unlink(seed);
  await symlink(join(input.directory, 'missing'), seed);
  await assert.rejects(createPreviewDeclaration(input), /seed_invalid/);
});

test('replacement backing or private directory never authorizes cleanup through a symlink', async t => {
  const input = await fixture(t);
  const declaration = await createPreviewDeclaration(input);
  const foreign = join(input.directory, 'foreign');
  await writeFile(foreign, 'preserve');
  await unlink(declaration.path);
  await symlink(foreign, declaration.path);
  await assert.rejects(assertPreviewDeclarationFile(declaration), /file_changed/);
  await assert.rejects(removePreviewDeclaration(declaration), /file_changed/);
  assert.equal(await readFile(foreign, 'utf8'), 'preserve');
});

test('config and actual mount checks refuse missing, duplicate, foreign, readonly and shadowed overlays', () => {
  const declarationPath = '/state/preview-unique/next-env.d.ts';
  const configured = () => [previewDeclarationMount(declarationPath)];
  assertPreviewDeclarationMount(configured(), { declarationPath });
  const normalized = configured(); delete normalized[0].read_only;
  assertPreviewDeclarationMount(normalized, { declarationPath });
  const mutations = [
    () => [], list => [...list, list[0]],
    list => [{ ...list[0], source: '/foreign/next-env.d.ts' }],
    list => [{ ...list[0], read_only: true }],
    list => [{ ...list[0], bind: { create_host_path: true } }],
    list => [{ ...list[0], target: '/workspace/apps/web' }],
    list => [...list, { type: 'bind', source: '/foreign', target: '/workspace/apps' }],
  ];
  for (const mutate of mutations) assert.throws(() => assertPreviewDeclarationMount(mutate(configured()), { declarationPath }), /mount_mismatch/);
  const actual = () => [{ Type: 'bind', Source: declarationPath, Destination: PREVIEW_DECLARATION_TARGET, RW: true }];
  assertPreviewDeclarationMount(actual(), { declarationPath }, true);
  for (const list of [[], [...actual(), ...actual()], [{ ...actual()[0], RW: false }],
    [{ ...actual()[0], RW: undefined, Mode: 'rw' }], [{ ...actual()[0], Type: 'volume' }],
    [{ ...actual()[0], Source: '/foreign' }], [...actual(), { Destination: '/workspace/apps/web' }]]) {
    assert.throws(() => assertPreviewDeclarationMount(list, { declarationPath }, true), /mount_mismatch/);
  }
  assertPreviewDeclarationMount([...actual(), { Destination: '/workspace' }, { Destination: '/workspace/apps/web/node_modules' }], { declarationPath }, true);
});

test('actual generated file retains exact Windows and qualified Desktop path identity', () => {
  const target = (Source) => [{ Type: 'bind', Source, Destination: PREVIEW_DECLARATION_TARGET, RW: true }];
  assertPreviewDeclarationMount(target('/run/desktop/mnt/host/d/state/next-env.d.ts'), { declarationPath: 'D:/state/next-env.d.ts' }, true);
  assertPreviewDeclarationMount(target('/host_mnt/Users/user/state/next-env.d.ts'), { declarationPath: '/Users/user/state/next-env.d.ts', dockerOperatingSystem: 'Docker Desktop' }, true);
  assert.throws(() => assertPreviewDeclarationMount(target('/host_mnt/Users/user/state/next-env.d.ts'), { declarationPath: '/Users/user/state/next-env.d.ts' }, true), /mount_mismatch/);
});

test('the existing preview config and actual-container boundaries both enforce the supplied declaration binding', () => {
  const identity = { worktree: '/source', sha: 'a'.repeat(40), leaseId: 'NPEL-MINE', declarationPath: '/state/next-env.d.ts' };
  const config = previewOverride(identity);
  Object.assign(config.services['dev-init'].environment, { CONTRIBUTOR_PREVIEW_PASSWORD: 'fixture',
    DATABASE_URL: 'postgresql://fixture@dev-postgres:5432/dpf', PRODUCTION_DATABASE_URL: 'postgresql://fixture@postgres:5432/dpf' });
  config.services['dev-portal'].environment.DATABASE_URL = config.services['dev-init'].environment.DATABASE_URL;
  assertPreviewConfig(config, identity);
  config.services['dev-portal'].volumes.pop();
  assert.throws(() => assertPreviewConfig(config, identity), /declaration_mount_mismatch/);
  const container = { Mounts: [{ Type: 'bind', Source: identity.worktree, Destination: '/workspace' },
    { Type: 'bind', Source: identity.declarationPath, Destination: PREVIEW_DECLARATION_TARGET, RW: true }],
    Config: { Labels: previewOverride(identity).services['dev-portal'].labels,
      Env: ['DPF_ENVIRONMENT_CLASS=development', `DPF_PREVIEW_SOURCE_SHA=${identity.sha}`, `DPF_PREVIEW_LEASE_ID=${identity.leaseId}`] } };
  assertPreviewContainer(container, identity);
  container.Mounts.pop();
  assert.throws(() => assertPreviewContainer(container, identity), /declaration_mount_mismatch/);
});

function writerRunner({ foreign = false, ancestor = false, readonly = false, fail = '', partial = false, partialMount = false } = {}) {
  const calls = [];
  let containers = [{ Id: 'owned', Name: '/portal', State: { Running: true },
    Config: { Labels: { 'dpf.preview.lease': 'NPEL-MINE', 'com.docker.compose.project': 'dpf', 'com.docker.compose.service': 'dev-portal' } },
    Mounts: [{ Type: 'bind', Source: '/state/next-env.d.ts', Destination: PREVIEW_DECLARATION_TARGET, RW: true }] }];
  if (foreign) containers.push({ ...containers[0], Id: 'foreign', Config: { Labels: {} },
    Mounts: [{ ...containers[0].Mounts[0], Source: ancestor ? '/state' : '/state/next-env.d.ts', RW: !readonly }] });
  if (partialMount) containers.push({ Id: 'foreign', Config: { Labels: {} }, Mounts: [{ Source: '/state/next-env.d.ts', RW: true }] });
  const runner = { run: async args => {
    calls.push(args);
    if (args[0] === fail) throw new Error('unavailable');
    if (args[0] === 'info') return 'Linux';
    if (args[0] === 'ps') return containers.map(c => c.Id).join('\n');
    if (args[0] === 'inspect') return JSON.stringify(partial ? [] : containers.filter(c => args.slice(1).includes(c.Id)));
    if (args[0] === 'stop') containers.find(c => c.Id === args[1]).State.Running = false;
    if (args[0] === 'rm') containers = containers.filter(c => c.Id !== args[1]);
    return '';
  } };
  return { runner, calls };
}

const cleanupIdentity = { declarationPath: '/state/next-env.d.ts', leaseId: 'NPEL-MINE', projectName: 'dpf', initName: 'unique-init' };
test('owned writers stop and are removed before successful reference-free cleanup', async () => {
  const { runner, calls } = writerRunner();
  await stopDeclarationWriters({ runner, ...cleanupIdentity });
  assert.ok(calls.findIndex(c => c[0] === 'stop') < calls.findIndex(c => c[0] === 'rm'));
  assert.equal(calls.filter(c => c[0] === 'ps').length, 2);
});

test('foreign references and uncertain inventory, stop or removal retain backing', async t => {
  const input = await fixture(t);
  for (const options of [{ foreign: true }, { foreign: true, readonly: true }, { foreign: true, ancestor: true }, { partial: true }, { partialMount: true }, { fail: 'ps' }, { fail: 'inspect' }, { fail: 'stop' }, { fail: 'rm' }]) {
    const declaration = await createPreviewDeclaration(input);
    const { runner, calls } = writerRunner(options);
    await assert.rejects(async () => {
      await stopDeclarationWriters({ runner, ...cleanupIdentity });
      await removePreviewDeclaration(declaration);
    });
    assert.equal(await readFile(declaration.path, 'utf8'), original);
    if (options.foreign || options.partial || options.partialMount || ['ps', 'inspect'].includes(options.fail)) assert.equal(calls.some(c => c[0] === 'stop'), false);
  }
});

test('canonical readonly state-directory mounts remain untouched and do not pin the generated child file', async () => {
  const { runner, calls } = writerRunner({ foreign: true, ancestor: true, readonly: true });
  await stopDeclarationWriters({ runner, ...cleanupIdentity });
  assert.equal(calls.some(c => ['stop', 'rm'].includes(c[0]) && c[1] === 'foreign'), false);
});

test('writable Windows drive-root and POSIX-root binds retain backing even when inspected on another host', async () => {
  for (const [declarationPath, source] of [['D:/state/next-env.d.ts', '/run/desktop/mnt/host/d/'], ['/state/next-env.d.ts', '/']]) {
    const foreign = { Id: 'foreign', Config: { Labels: {} }, Mounts: [{ Type: 'bind', Source: source, RW: true }] };
    const runner = { run: async args => {
      if (args[0] === 'info') return 'Docker Desktop';
      if (args[0] === 'ps') return 'foreign';
      if (args[0] === 'inspect') return JSON.stringify([foreign]);
      assert.fail('foreign root writer must never be stopped or removed');
    } };
    await assert.rejects(stopDeclarationWriters({ runner, ...cleanupIdentity, declarationPath }), /foreign_reference/);
  }
});

test('refused prerequisites grant no Docker cleanup authority, while admitted writer cleanup precedes unlink', async t => {
  const input = await fixture(t);
  const unpublished = await createPreviewDeclaration(input);
  await reclaimPreviewDeclaration({ declaration: unpublished, runtimeMayHaveWriters: false,
    stopOwned: async () => assert.fail('no stop/rm authority before admission and runtime creation') });
  await assert.rejects(lstat(unpublished.path), { code: 'ENOENT' });
  const published = await createPreviewDeclaration(input);
  let stopped = false;
  await reclaimPreviewDeclaration({ declaration: published, runtimeMayHaveWriters: true,
    stopOwned: async () => { assert.equal(await readFile(published.path, 'utf8'), original); stopped = true; } });
  assert.equal(stopped, true);
  await assert.rejects(lstat(published.path), { code: 'ENOENT' });
  const uncertain = await createPreviewDeclaration(input);
  await assert.rejects(reclaimPreviewDeclaration({ declaration: uncertain, runtimeMayHaveWriters: true,
    stopOwned: async () => { throw new Error('ownership-unproven'); } }), /ownership-unproven/);
  assert.equal(await readFile(uncertain.path, 'utf8'), original);
});

test('initializer source mutation still refuses portal startup and cleans up', async t => {
  const input = await fixture(t);
  let changed = false;
  const calls = [];
  await assert.rejects(runPreviewLifecycle({
    verifySource: async () => { if (changed) throw new Error('preview_source_changed'); },
    compose: async args => { calls.push(args); if (args[0] === 'run') { await writeFile(join(input.worktree, 'apps/web/next-env.d.ts'), 'changed by init'); changed = true; } },
    inspect: async () => assert.fail('must not inspect'), ready: async () => assert.fail('must not serve'), wait: async () => {},
    stopOwned: async () => calls.push('cleanup'), active: { initName: 'unique-init' },
  }), /preview_source_changed/);
  assert.equal(calls.some(c => Array.isArray(c) && c[0] === 'up' && c.at(-1) === 'dev-portal'), false);
  assert.equal(calls.at(-1), 'cleanup');
});

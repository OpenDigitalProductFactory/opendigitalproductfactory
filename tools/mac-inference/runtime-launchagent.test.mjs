import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRuntimeLaunchAgent, parseLaunchAgentStatus, createRuntimeLaunchAgent } from './runtime-launchagent.mjs';
import * as nativeJobs from './runtime-launchagent.mjs';

const absent = { code: 113, stderr: 'Could not find service "local.dpf-inference.test"', stdout: '' };
const owned = { code: 0, stdout: 'program = /private/test/runtime/bin/dmr\npid = 123\n', stderr: '' };
const settings = { label: 'local.dpf-inference.test', packageRoot: '/private/test/runtime', stateRoot: '/private/test/state',
  port: 30700, leaseFile: '/private/test/lease.json', hardDeadline: '2026-10-26T02:00:00Z' };

test('native job uses direct argv, loopback, independent finite lease and child-group cleanup', () => {
  const text = renderRuntimeLaunchAgent(settings);
  assert.match(text, /<string>\/private\/test\/runtime\/bin\/dmr<\/string><string>serve<\/string>/);
  assert.match(text, /127\.0\.0\.1/); assert.match(text, /DPF_INFERENCE_LEASE_FILE/);
  assert.match(text, /AbandonProcessGroup<\/key><false\/>/); assert.match(text, /KeepAlive<\/key><false\/>/);
  assert.doesNotMatch(text, /\/bin\/(bash|sh)|Bearer|api_token/);
  assert.match(renderRuntimeLaunchAgent({ ...settings, stateRoot: '/private/a&b/state' }), /a&amp;b/);
});
test('invalid identities and unbounded jobs refuse before launchd', () => {
  assert.throws(() => renderRuntimeLaunchAgent({ ...settings, label: 'foreign.service' }), /identity/);
  assert.throws(() => renderRuntimeLaunchAgent({ ...settings, leaseFile: '' }), /lease/);
  assert.throws(() => renderRuntimeLaunchAgent({ ...settings, hardDeadline: 'unknown' }), /lease/);
});
test('missing domain or failed status cannot masquerade as an absent job', () => {
  assert.deepEqual(parseLaunchAgentStatus(absent), { exists: false });
  assert.throws(() => parseLaunchAgentStatus({ code: 113, stdout: '', stderr: 'Could not find domain' }), /unavailable/);
  assert.throws(() => parseLaunchAgentStatus({ code: 0, stdout: 'state = waiting' }), /identity/);
});
function lifecycle(run, extra = {}) {
  return createRuntimeLaunchAgent({ label: settings.label, program: '/private/test/runtime/bin/dmr',
    plistPath: '/private/test/job.plist', stateRoot: settings.stateRoot, workspaceRoot: '/private/test',
    readAuthority: async () => {}, run, processes: async () => [], delay: async () => {}, ...extra });
}
test('lost authority before bootstrap prevents any service start', async () => {
  const calls = [];
  const job = lifecycle(async args => { calls.push(args); return absent; }, { readAuthority: async () => { throw new Error('fenced'); } });
  await assert.rejects(job.start(), /fenced/); assert.deepEqual(calls, []);
});
test('foreign occupied label is never replaced or stopped', async () => {
  const calls = []; const job = lifecycle(async args => { calls.push(args); return { ...owned, stdout: 'program = /foreign/bin/dmr\npid = 99\n' }; });
  await assert.rejects(job.start(), /occupied/); assert.equal((await job.stop()).bootstrapAttempted, false);
  assert.equal(calls.some(args => args[0] === 'bootout'), false);
});
test('bootstrap acknowledgement loss is reconciled before owned cleanup', async () => {
  let state = absent; const calls = [];
  const job = lifecycle(async args => {
    calls.push(args);
    if (args[0] === 'print') return state;
    if (args[0] === 'bootstrap') { state = owned; return { code: 5 }; }
    if (args[0] === 'bootout') { state = absent; return { code: 0 }; }
  });
  await assert.rejects(job.start(), /acknowledgement/);
  assert.equal((await job.stop()).stopped, true); assert.equal(calls.filter(args => args[0] === 'bootstrap').length, 1);
});
test('failed process observation and surviving native children cannot prove cleanup', async () => {
  let state = absent;
  const job = lifecycle(async args => {
    if (args[0] === 'print') return state;
    state = args[0] === 'bootstrap' ? owned : absent; return { code: 0 };
  }, { processes: async () => { throw new Error('observation failed'); } });
  await job.start(); await assert.rejects(job.stop(), /observation failed/);
  let second = absent;
  const lingering = lifecycle(async args => {
    if (args[0] === 'print') return second;
    second = args[0] === 'bootstrap' ? owned : absent; return { code: 0 };
  }, { processes: async () => [{ pid: 123 }] });
  await lingering.start(); await assert.rejects(lingering.stop(), /unconfirmed/);
});

const ownedSelection = { label: settings.label, program: '/private/test/runtime/bin/dmr',
  runtimeManifestSha256: 'a'.repeat(64) };
test('a fresh controller stops a prior managed job only after reading its current owned selection', async () => {
  let state = owned; const calls = []; let authorityReads = 0;
  const job = lifecycle(async args => {
    calls.push(args); if (args[0] === 'print') return state;
    if (args[0] === 'bootout') { state = absent; return { code: 0 }; }
    throw new Error('Unexpected service mutation');
  }, { runtimeManifestSha256: ownedSelection.runtimeManifestSha256,
    readExistingOwnership: async () => ownedSelection, readAuthority: async () => { authorityReads++; } });
  const result = await job.stop();
  assert.equal(result.stopped, true); assert.equal(result.adoptedExisting, true);
  assert.equal(calls.filter(args => args[0] === 'bootout').length, 1); assert.ok(authorityReads > 0);
});
test('missing or changed prior selection cannot authorize stopping a pre-existing service', async () => {
  for (const selection of [null, { ...ownedSelection, label: 'foreign.service' },
    { ...ownedSelection, program: '/foreign/bin/dmr' }, { ...ownedSelection, runtimeManifestSha256: 'b'.repeat(64) }]) {
    const calls = []; const job = lifecycle(async args => { calls.push(args); return owned; },
      { runtimeManifestSha256: ownedSelection.runtimeManifestSha256, readExistingOwnership: async () => selection });
    await assert.rejects(job.stop(), /ownership/); assert.equal(calls.some(args => args[0] === 'bootout'), false);
  }
});
test('reopened managed cleanup still refuses lost authority, foreign jobs and surviving descendants', async () => {
  const options = { runtimeManifestSha256: ownedSelection.runtimeManifestSha256,
    readExistingOwnership: async () => ownedSelection };
  const calls = []; const fenced = lifecycle(async args => { calls.push(args); return owned; },
    { ...options, readAuthority: async () => { throw new Error('fenced'); } });
  await assert.rejects(fenced.stop(), /fenced/); assert.deepEqual(calls, []);
  const foreign = lifecycle(async () => ({ ...owned, stdout: 'program = /foreign/dmr\npid = 44\n' }), options);
  await assert.rejects(foreign.stop(), /unowned/);
  const lingering = lifecycle(async () => absent, { ...options, processes: async () => [{ pid: 9 }] });
  await assert.rejects(lingering.stop(), /unconfirmed/);
});
test('permanent job rendering is separate from the leased experiment and binds the active selection', () => {
  const label = 'local.dpf-inference.managed', runtimeManifestSha256 = 'a'.repeat(64), qualificationReportSha256 = 'b'.repeat(64);
  const selection = { schemaVersion: 1, status: 'active', label, program: '/private/test/runtime/bin/dmr',
    port: settings.port, runtimeManifestSha256, qualificationReportSha256, actionKey: 'RA-BOUND' };
  const args = { ...settings, label, selection, runtimeManifestSha256, qualificationReportSha256 };
  const rendered = nativeJobs.renderManagedRuntimeLaunchAgent(args);
  assert.match(rendered, /KeepAlive<\/key><true\/>/); assert.match(rendered, /127\.0\.0\.1/);
  assert.match(rendered, /ThrottleInterval<\/key><integer>10<\/integer>/);
  assert.doesNotMatch(rendered, /DPF_INFERENCE_LEASE_FILE|DPF_INFERENCE_EXPERIMENT_DEADLINE|\/bin\/sh/);
  for (const change of [{ status: 'runtime-api-qualified' }, { label: 'local.dpf-inference.experiment' },
    { program: '/foreign/bin/dmr' }, { port: 9000 }, { runtimeManifestSha256: 'c'.repeat(64) },
    { qualificationReportSha256: 'c'.repeat(64) }, { actionKey: '' }]) {
    assert.throws(() => nativeJobs.renderManagedRuntimeLaunchAgent({ ...args, selection: { ...selection, ...change } }), /selection/);
  }
});

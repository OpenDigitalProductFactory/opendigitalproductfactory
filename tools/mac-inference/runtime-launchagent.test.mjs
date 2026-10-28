import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRuntimeLaunchAgent, parseLaunchAgentStatus, createRuntimeLaunchAgent } from './runtime-launchagent.mjs';

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

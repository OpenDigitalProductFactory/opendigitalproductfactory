import assert from "node:assert/strict";
import test from "node:test";
import { observeHostReservation } from "./host-reservation-observation.mjs";

const binding = { leaseId: "NPEL-OWN", claimKey: "host-resource:v2:attempt:fingerprint",
  environmentKey: "host-heavy-resource", ownerProvider: "codex", ownerSessionId: "own-session",
  worktreePath: "D:/DPF-worktrees/own", branchName: "fix/own" };
const response = row => ({ success: true, entityId: binding.leaseId, data: { lease: row } });

for (const status of ["expired", "released", "cancelled"]) {
  test(`exact persisted ${status} settles only the reservation, including cleared process fields`, async () => {
    let calls = 0;
    const result = await observeHostReservation({ binding, call: async (name, args) => {
      ++calls;
      assert.equal(name, "list_nonprod_environment_leases");
      assert.deepEqual(args, { leaseId: binding.leaseId });
      return response({ ...binding, status, activeKey: null, ownerPid: null });
    } });
    assert.equal(calls, 1);
    assert.equal(result.reservationState, "settled");
    assert.equal(result.leaseStatus, status);
    assert.equal(result.processCleanupVerified, false);
    assert.ok(!("commandSucceeded" in result));
  });
}
for (const status of ["active", "queued"]) {
  test(`persisted ${status} stays pending even after reported expiry time`, async () => {
    const result = await observeHostReservation({ binding, call: async () => response({ ...binding, status,
      expiresAt: "2000-01-01T00:00:00Z" }) });
    assert.equal(result.reservationState, "pending");
    assert.equal(result.processCleanupVerified, false);
  });
}
for (const key of Object.keys(binding)) {
  test(`mismatched retained ${key} cannot settle another reservation`, async () => {
    const result = await observeHostReservation({ binding, call: async () => response({ ...binding,
      [key]: "foreign", status: "expired", activeKey: null }) });
    assert.equal(result.reservationState, "unknown");
    assert.equal(result.reason, "binding-mismatch");
  });
}
for (const reply of [null, { success: true }, { success: true, data: { leases: [], queued: [] } },
  { success: false, error: "not_found" }, { success: true, entityId: "OTHER", data: { lease: binding } }]) {
  test(`unproven readback ${JSON.stringify(reply)} never proves expiry`, async () => {
    assert.equal((await observeHostReservation({ binding, call: async () => reply })).reservationState, "unknown");
  });
}
test("reader failure stays bounded and redacted", async () => {
  let calls = 0;
  const result = await observeHostReservation({ binding, call: async () => { ++calls; throw new Error("private error"); } });
  assert.equal(calls, 1);
  assert.equal(result.reservationState, "unknown");
  assert.doesNotMatch(JSON.stringify(result), /private error/);
});
test("terminal row still occupying a slot is inconsistent", async () => {
  assert.equal((await observeHostReservation({ binding, call: async () => response({ ...binding,
    status: "expired", activeKey: "host-heavy-resource:slot-0" }) })).reservationState, "unknown");
});
test("missing admitted binding does not issue a broad list or release", async () => {
  let calls = 0;
  const result = await observeHostReservation({ binding: { leaseId: "NPEL-OWN" }, call: async () => { ++calls; } });
  assert.equal(calls, 0);
  assert.equal(result.reservationState, "unknown");
});


const previewBinding = { ...binding, claimKey: 'preview-fixture', environmentKey: 'local-integration-ci',
  url: 'http://localhost:3001', ports: [3001], cleanupCommand: 'fixture-cleanup' };
const { observePreviewReservation } = await import('./host-reservation-observation.mjs');
const { supervisePreviewRun, previewLeaseEventSummary } = await import('./dev-preview-runtime.mjs');

for (const status of ['active', 'queued', 'released', 'cancelled', 'expired']) {
  test('preview exact ' + status + ' readback never proves writer cleanup', async () => {
    const calls = [];
    const result = await observePreviewReservation({ binding: previewBinding, call: async (name, args) => {
      calls.push([name, args]);
      return response({ ...previewBinding, status, activeKey: TERMINAL_FIXTURE.has(status) ? null : 'local-integration-ci:slot-0' });
    } });
    assert.deepEqual(calls, [['list_nonprod_environment_leases', { leaseId: binding.leaseId }]]);
    assert.equal(result.reservationState, TERMINAL_FIXTURE.has(status) ? 'settled' : 'pending');
    assert.equal(result.processCleanupVerified, false);
  });
}
const TERMINAL_FIXTURE = new Set(['released', 'cancelled', 'expired']);

for (const key of [...Object.keys(binding), 'url', 'ports']) {
  test('preview readback rejects changed ' + key, async () => {
    const row = { ...previewBinding, [key]: key === 'ports' ? [9999] : 'foreign', status: 'expired', activeKey: null };
    const result = await observePreviewReservation({ binding: previewBinding, call: async () => response(row) });
    assert.equal(result.reservationState, 'unknown');
    assert.equal(result.reason, 'binding-mismatch');
  });
}
for (const changed of [{ environmentKey: 'active-candidate' }, { url: 'http://localhost:9999' },
  { ports: [3001, 9999] }, { claimKey: '' }]) {
  test('preview rejects unsupported retained target ' + JSON.stringify(changed) + ' before reading', async () => {
    let calls = 0;
    const result = await observePreviewReservation({ binding: { ...previewBinding, ...changed },
      call: async () => { ++calls; } });
    assert.equal(calls, 0);
    assert.equal(result.reservationState, 'unknown');
  });
}
test('preview incomplete, missing and unavailable readbacks remain unknown', async () => {
  for (const reply of [null, { success: true }, { success: false }, { success: true, data: { leases: [] } },
    response({ ...previewBinding, status: 'expired', activeKey: 'local-integration-ci:slot-0' })]) {
    assert.equal((await observePreviewReservation({ binding: previewBinding, call: async () => reply })).reservationState, 'unknown');
  }
  const result = await observePreviewReservation({ binding: previewBinding,
    call: async () => { throw new Error('private-fixture-provider-message'); } });
  assert.equal(result.reservationState, 'unknown');
  assert.doesNotMatch(JSON.stringify(result), /private-fixture-provider-message/);
});

for (const runOutcome of ['complete', 'writer-error']) {
  test('preview supervised ' + runOutcome + ' stops renewal and observes without release', async () => {
    const order = [], events = [];
    const writerFailure = new Error('owned-writer-cleanup-failed');
    let releases = 0, renewals = 0, oldHeartbeat;
    const completion = supervisePreviewRun({
      binding: previewBinding, ttlMs: 60000,
      run: async () => { order.push('writer-finalized'); if (runOutcome === 'writer-error') throw writerFailure; return 23; },
      renew: async () => { ++renewals; return { success: true }; }, terminate: async () => {},
      release: async () => { ++releases; },
      schedule: callback => { oldHeartbeat = callback; return 'timer'; },
      cancelSchedule: () => order.push('renewal-stopped'),
      call: async (name, args) => { order.push('reservation-read'); assert.equal(name, 'list_nonprod_environment_leases');
        assert.deepEqual(args, { leaseId: binding.leaseId });
        return response({ ...previewBinding, status: 'active' }); },
      onEvent: event => events.push(event),
    });
    if (runOutcome === 'writer-error') await assert.rejects(completion, error => error === writerFailure);
    else assert.deepEqual(await completion, { status: 'completed', result: 23 });
    await oldHeartbeat();
    assert.deepEqual(order, ['writer-finalized', 'renewal-stopped', 'reservation-read']);
    assert.equal(renewals, 0);
    assert.equal(releases, 0);
    assert.equal(events.at(-1).observation.reservationState, 'pending');
  });
}
test('preview live authority refusal fences the writer and then observes without releasing', async () => {
  let heartbeat, finishWriter, terminations = 0, releases = 0;
  const writer = new Promise(resolve => { finishWriter = resolve; });
  const events = [];
  const completion = supervisePreviewRun({
    binding: previewBinding, ttlMs: 60000, run: () => writer,
    renew: async () => ({ success: false, error: 'lease_lost' }),
    terminate: async () => { ++terminations; finishWriter(9); },
    release: async () => { ++releases; },
    schedule: callback => { heartbeat = callback; return 'timer'; }, cancelSchedule: () => {},
    call: async () => response({ ...previewBinding, status: 'expired', activeKey: null }),
    onEvent: event => events.push(event),
  });
  await heartbeat();
  const result = await completion;
  assert.equal(result.status, 'fenced');
  assert.equal(terminations, 1);
  assert.equal(releases, 0);
  assert.equal(events.at(-1).observation.reservationState, 'settled');
  assert.equal(events.at(-1).observation.processCleanupVerified, false);
});
test('preview observation failure preserves the completed outcome and redacts private messages', async () => {
  const events = [];
  const result = await supervisePreviewRun({ binding: previewBinding, ttlMs: 60000,
    run: async () => 7, renew: async () => ({ success: true }), terminate: async () => {},
    release: async () => assert.fail('release forbidden'),
    schedule: () => 'timer', cancelSchedule: () => {},
    call: async () => { throw new Error('private-fixture-provider-message'); }, onEvent: event => events.push(event) });
  assert.equal(result.result, 7);
  assert.equal(events.at(-1).observation.reservationState, 'unknown');
  assert.doesNotMatch(JSON.stringify(events), /private-fixture-provider-message/);
  assert.deepEqual(previewLeaseEventSummary(events.at(-1)),
    { type: 'reservation-observed', reservationState: 'unknown', processCleanupVerified: false });
  assert.deepEqual(previewLeaseEventSummary({ type: 'reservation-observation-unavailable', reason: 'private-fixture-provider-message' }),
    { type: 'reservation-observation-unavailable', reservationState: 'unknown', processCleanupVerified: false });
});


test('host observer still rejects the full preview shape before reading', async () => {
  let calls = 0;
  assert.equal((await observeHostReservation({ binding: previewBinding, call: async () => { ++calls; } })).reservationState, 'unknown');
  assert.equal(calls, 0);
});

test('preview prerequisite failure after validated admission reads only that reservation', async t => {
  const fs = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { default: childProcess } = await import('node:child_process');
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const { syncBuiltinESMExports } = await import('node:module');
  const { createServer } = await import('node:http');
  const runtime = await import('./dev-preview-runtime.mjs');
  const directory = await fs.mkdtemp(join(tmpdir(), 'dpf-preview-admitted-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = await fs.realpath(directory);
  await fs.mkdir(join(root, 'source'));
  const worktree = await fs.realpath(join(root, 'source'));
  const stateDirectory = join(root, 'state'), install = join(root, 'install');
  await fs.mkdir(join(worktree, 'apps/web'), { recursive: true });
  await fs.mkdir(stateDirectory);
  await fs.mkdir(install);
  await fs.writeFile(join(worktree, 'apps/web/next-env.d.ts'), '// fixture declarations\n');
  await fs.writeFile(join(install, '.env'), '');
  const statePath = join(stateDirectory, 'install-state.json');
  await fs.writeFile(statePath, JSON.stringify({ installPath: install, composeFiles: ['docker-compose.yml'] }));
  const sha = 'a'.repeat(40);
  const admitted = { ...previewBinding, ownerSessionId: 'fixture-owner', branchName: 'fix/fixture',
    worktreePath: worktree, status: 'active', expiresAt: new Date(Date.now() + 60000).toISOString(), purpose: 'fixture (' + sha + ')' };
  const calls = [], dockerCalls = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const packet = JSON.parse(body), name = packet.params?.name, args = packet.params?.arguments;
      calls.push([name, args]);
      const result = name === 'load_tools'
        ? { success: true, status: runtime.REQUIRED_PREVIEW_DELIVERY_TOOLS.map(name => ({
          name, serverHasTool: true, tokenGranted: true, agentGranted: true, callableByName: true })) }
        : name === 'list_nonprod_environment_leases' && args.leaseId
          ? responseFixture({ ...admitted, status: 'expired', activeKey: null })
          : { success: true, data: { leases: [admitted] } };
      response.end(JSON.stringify({ jsonrpc: '2.0', id: packet.id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }));
    });
  });
  const responseFixture = row => ({ success: true, entityId: row.leaseId, data: { lease: row } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  t.mock.method(childProcess, 'execFileSync', (bin, args) => {
    assert.equal(bin, 'git');
    if (args.join(' ') === 'rev-parse HEAD') return sha;
    if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return admitted.branchName;
    if (args.join(' ') === 'status --porcelain') return '';
    assert.fail('unexpected fixture Git operation');
  });
  t.mock.method(childProcess, 'spawn', (bin, args) => {
    assert.equal(bin, 'fixture-docker');
    dockerCalls.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => assert.fail('unexpected fixture termination');
    const output = args[0] === 'ps' ? 'canonical-fixture'
      : args[0] === 'inspect' ? JSON.stringify([{ State: { Running: true }, Image: 'sha256:' + 'a'.repeat(64) }])
        : args[0] === 'exec' ? '' : JSON.stringify({ services: {} });
    setImmediate(() => { child.stdout.end(output); child.stderr.end(); child.emit('close', 0); });
    return child;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(runtime.main({
      DPF_DEV_WORKTREE: worktree, DPF_DEV_PORTAL_LEASE_ID: admitted.leaseId,
      DPF_DEV_PORTAL_OWNER_SESSION_ID: admitted.ownerSessionId, DPF_DEV_PORTAL_SOURCE_SHA: sha,
      DPF_INSTALL_STATE_PATH: statePath, DPF_DEV_PORTAL_DOCKER_BIN: 'fixture-docker',
      DPF_MCP_CLIENT_CREDENTIALS_FILE: join(worktree, 'absent-private-credentials.json'),
      DPF_MCP_BEARER_TOKEN: 'fixture-local-only',
      DPF_MCP_URL: 'http://127.0.0.1:' + server.address().port + '/api/mcp/v1',
    }), /preview_mount_mismatch/);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.deepEqual(calls.map(([name]) => name), ['load_tools', 'list_nonprod_environment_leases', 'list_nonprod_environment_leases']);
  assert.deepEqual(calls.at(-1)[1], { leaseId: admitted.leaseId });
  assert.ok(!dockerCalls.some(args => args.includes('up') || args.includes('rm')), 'no runtime mutation before config acceptance');
});

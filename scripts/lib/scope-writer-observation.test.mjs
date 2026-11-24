import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';

// Import dynamically so the red test identifies the missing transport.
const load = () => import('./scope-writer-observation.mjs');
const unixOnly = { skip: process.platform === 'win32' };

async function withServer(serve, observation, run) {
  const root = await mkdtemp(join(tmpdir(), 'sw-'));
  const socketPath = join(root, 'obs.sock');
  const server = serve(observation);
  try {
    server.listen(socketPath);
    await once(server, 'listening');
    await run(socketPath);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

const call = (socketPath, options) => new Promise((resolve, reject) => {
  const req = request({ socketPath, ...options }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject);
  req.end();
});

it('serves a single bound read without accepting caller-supplied verbs, queries or targets', unixOnly, async () => {
  const { createScopeWriterObserver, readScopeWriterObservation } = await load();
  let calls = 0;
  const snapshot = { runId: 'SUR-TEST', sourceSha: 'a'.repeat(40) };
  await withServer(observe => createScopeWriterObserver({ observe }), async () => { calls++; return snapshot; }, async socketPath => {
    assert.deepEqual(await readScopeWriterObservation({ socketPath }), snapshot);
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/scope-writer/cohort' }), 404);
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/scope-writer/cohort?project=other' }), 404);
    assert.equal(await call(socketPath, { method: 'GET', path: '/images/json' }), 404);
    assert.equal(calls, 1);
  });
});

it('returns a bounded refusal for missing and oversized observations', unixOnly, async () => {
  const { createScopeWriterObserver, readScopeWriterObservation } = await load();
  for (const observe of [() => ({ oversized: 'z'.repeat(16_384) }), () => { throw new Error('private details'); }]) {
    await withServer(probe => createScopeWriterObserver({ observe: probe }), observe, async socketPath => {
      await assert.rejects(readScopeWriterObservation({ socketPath }), { message: 'scope_writer_observation_unavailable' });
    });
  }
});

it('projects only service health in the actuator-owned project', async () => {
  const { observeActuatorProjectServices } = await load();
  const calls = [];
  const lookups = await observeActuatorProjectServices('owned', async path => {
    calls.push(path);
    return [
      { Labels: { 'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'portal', secret: 'redacted' },
        State: 'running', Status: 'Up 1 minute (healthy)', Mounts: ['/host/private'] },
      { Labels: { 'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'postgres' },
        State: 'running', Status: 'Up 1 seconds (health: starting)' },
      { Labels: { 'com.docker.compose.project': 'another', 'com.docker.compose.service': 'sandbox' },
        State: 'running', Status: 'Up 1 minute' },
    ];
  });
  assert.equal(calls.length, 1);
  const endpoint = new URL(calls[0], 'http://engine');
  assert.equal(endpoint.pathname, '/containers/json');
  assert.equal(endpoint.searchParams.get('all'), '1');
  assert.deepEqual(JSON.parse(endpoint.searchParams.get('filters')), { label: ['com.docker.compose.project=owned'] });
  assert.deepEqual(lookups, { portal: { composePresent: true, healthy: true }, postgres: { composePresent: true, healthy: false } });
});

it('binds the typed service health request to the actuator project', unixOnly, async () => {
  const { createScopeWriterObserver, readActuatorProjectServices } = await load();
  let dispatched = 0;
  const services = { portal: { composePresent: true, healthy: true } };
  await withServer(observe => createScopeWriterObserver({ observe, observeServices: async () => {
    dispatched++;
    return services;
  } }), async () => ({}), async socketPath => {
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/project-services?project=peer' }), 404);
    assert.equal(dispatched, 0);
    assert.deepEqual(await readActuatorProjectServices({ socketPath }), services);
    assert.equal(dispatched, 1);
  });
});

it('atomically publishes a listening socket over an older generation', unixOnly, async () => {
  const { createScopeWriterObserver, publishActuatorSocket, readScopeWriterObservation } = await load();
  const root = await mkdtemp(join(tmpdir(), 'sw-restart-'));
  const socketPath = join(root, 'obs.sock');
  const servers = ['old', 'current'].map(generation => createScopeWriterObserver({ observe: async () => ({ generation }) }));
  try {
    for (const [index, server] of servers.entries()) {
      await publishActuatorSocket(server, { socketPath, uid: process.getuid(), gid: process.getgid() });
      assert.deepEqual(await readScopeWriterObservation({ socketPath }), { generation: index === 0 ? 'old' : 'current' });
    }
    await new Promise(resolve => servers[0].close(resolve));
    assert.deepEqual(await readScopeWriterObservation({ socketPath }), { generation: 'current' });
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await rm(root, { recursive: true, force: true });
  }
});

it('accepts a preview reconciliation trigger without accepting any target, command or request body', unixOnly, async () => {
  const { createScopeWriterObserver, reconcileEndedPreviewRuntimes } = await load();
  const result = { checked: 1, stopped: 1, held: 0, pending: 0, truncated: false, outcomes: [] };
  let calls = 0;
  await withServer(observe => createScopeWriterObserver({ observe, fencePreviews: async () => { calls++; return result; } }),
    async () => ({}), async socketPath => {
      assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/fence-ended-previews' }), 404);
      assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/fence-ended-previews?target=peer' }), 404);
      assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/fence-ended-previews',
        headers: { 'content-length': '1' } }), 404);
      assert.equal(calls, 0);
      assert.deepEqual(await reconcileEndedPreviewRuntimes({ socketPath }), result);
      assert.equal(calls, 1);
    });
});

it('returns only the fixed CI capacity projection through its read operation', unixOnly, async () => {
  const { createScopeWriterObserver, readActuatorCiCapacity } = await load();
  await withServer(observe => createScopeWriterObserver({ observe, observeCiCapacity: async () =>
    ({ dockerHealthy: true, builderMemoryUsageBytes: [1_000, 0] }) }), async () => ({}), async socketPath => {
    assert.deepEqual(await readActuatorCiCapacity({ socketPath }), { dockerHealthy: true, builderMemoryUsageBytes: [1_000, 0] });
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/ci-capacity?container=peer' }), 404);
  });
});

it('lets the native substrate owner select and reconcile its own targets', unixOnly, async () => {
  const { createScopeWriterObserver, reconcileActuatorSubstrate } = await load();
  let triggers = 0;
  await withServer(observe => createScopeWriterObserver({ observe, reconcileSubstrate: async () => {
    triggers++;
    return { restarted: 0 };
  } }), async () => ({}), async socketPath => {
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/reconcile-substrate?container=peer' }), 404);
    assert.deepEqual(await reconcileActuatorSubstrate({ socketPath }), { restarted: 0 });
    assert.equal(triggers, 1);
  });
});

it('dispatches only bounded logs for a named canonical service', unixOnly, async () => {
  const { createScopeWriterObserver, readActuatorServiceLogs } = await load();
  const calls = [];
  await withServer(observe => createScopeWriterObserver({ observe, readServiceLogs: async (...input) => {
    calls.push(input);
    return { output: 'log fixture' };
  } }), async () => ({}), async socketPath => {
    assert.deepEqual(await readActuatorServiceLogs('sandbox', 50, { socketPath }), { output: 'log fixture' });
    for (const query of ['service=peer&tail=50', 'service=sandbox&tail=501', 'service=sandbox&tail=50&container=peer']) {
      assert.equal(await call(socketPath, { method: 'GET', path: `/v1/runtime/service-logs?${query}` }), 404);
    }
    assert.deepEqual(calls, [['sandbox', 50]]);
  });
});

it('routes fixed project diagnostics and promoter reconciliation without caller targets', unixOnly, async () => {
  const { createScopeWriterObserver, readActuatorProjectContainers, reconcileActuatorPromoters } = await load();
  const rows = { containers: [{ ID: 'a'.repeat(64), Service: 'sandbox', State: 'running' }] };
  let sweeps = 0;
  await withServer(observe => createScopeWriterObserver({ observe, observeProjectContainers: async () => rows,
    sweepPromoters: async () => ({ removed: ++sweeps }) }), async () => ({}), async socketPath => {
    assert.deepEqual(await readActuatorProjectContainers({ socketPath }), rows);
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/project-containers?project=peer' }), 404);
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/sweep-promoters?action=peer' }), 404);
    assert.deepEqual(await reconcileActuatorPromoters({ socketPath }), { removed: 1 });
    assert.equal(sweeps, 1);
  });
});

it('omits peer containers and private Docker fields from project diagnostics', async () => {
  const { observeActuatorProjectContainers } = await load();
  const owner = { 'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'portal' };
  const portal = { Id: 'a'.repeat(64), Names: ['/owned-portal-1'], State: 'running', Status: 'Up',
    Labels: { ...owner, private: 'value' }, Mounts: ['/private'], Command: 'private args' };
  const result = await observeActuatorProjectContainers('owned', async () => [portal,
    { ...portal, Labels: { ...owner, 'com.docker.compose.project': 'peer' } },
    { ...portal, Labels: { ...owner, 'com.docker.compose.oneoff': 'True' } },
  ]);
  assert.deepEqual(result, { containers: [{ ID: portal.Id, Name: 'owned-portal-1', Service: 'portal', State: 'running', Status: 'Up' }] });
});

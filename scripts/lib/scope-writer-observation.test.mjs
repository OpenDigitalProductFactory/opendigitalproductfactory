import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';

// Import dynamically so the red test identifies the missing transport.
const load = () => import('./scope-writer-observation.mjs');

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

it('serves a single bound read without accepting caller-supplied verbs, queries or targets', async () => {
  const { createScopeWriterObserver, readScopeWriterObservation } = await load();
  let calls = 0;
  const snapshot = { runId: 'SUR-TEST', sourceSha: 'a'.repeat(40) };
  await withServer(createScopeWriterObserver, async () => { calls++; return snapshot; }, async socketPath => {
    assert.deepEqual(await readScopeWriterObservation({ socketPath }), snapshot);
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/scope-writer/cohort' }), 404);
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/scope-writer/cohort?project=other' }), 404);
    assert.equal(await call(socketPath, { method: 'GET', path: '/images/json' }), 404);
    assert.equal(calls, 1);
  });
});

it('returns a bounded refusal for missing and oversized observations', async () => {
  const { createScopeWriterObserver, readScopeWriterObservation } = await load();
  for (const observe of [() => ({ oversized: 'z'.repeat(16_384) }), () => { throw new Error('private details'); }]) {
    await withServer(createScopeWriterObserver, observe, async socketPath => {
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

it('binds the typed service health request to the actuator project', async () => {
  const { createScopeWriterObserver, readActuatorProjectServices } = await load();
  let dispatched = 0;
  const services = { portal: { composePresent: true, healthy: true } };
  await withServer(observe => createScopeWriterObserver(observe, async () => {
    dispatched++;
    return services;
  }), async () => ({}), async socketPath => {
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/project-services?project=peer' }), 404);
    assert.equal(dispatched, 0);
    assert.deepEqual(await readActuatorProjectServices({ socketPath }), services);
    assert.equal(dispatched, 1);
  });
});

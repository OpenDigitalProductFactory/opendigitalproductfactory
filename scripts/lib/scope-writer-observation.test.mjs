import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
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

const call = (socketPath, options, body) => new Promise((resolve, reject) => {
  const req = request({ socketPath, ...options }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject);
  req.end(body);
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

it('transports bounded conversion bytes without taking an image, entrypoint or container name', unixOnly, async () => {
  const { createScopeWriterObserver, runActuatorDoctools } = await load();
  const bytes = Buffer.from([0xff, 0x00, 0x01]);
  const received = [];
  await withServer(observe => createScopeWriterObserver({ observe, doctools: {
    limit: () => 4,
    run: async (operation, input) => {
      received.push({ operation, input });
      return { exitCode: 0, stdoutBytes: bytes, stderr: 'test output', outputLimitExceeded: false };
    },
  } }), async () => ({}), async socketPath => {
    const options = { socketPath, timeoutMs: 2_000, maxOutputBytes: 4 };
    const result = await runActuatorDoctools({ kind: 'convert', from: 'docx', to: 'pdf' }, bytes, options);
    assert.deepEqual(result, { exitCode: 0, stdoutBytes: bytes, stdout: '', stderr: 'test output', outputLimitExceeded: false });
    for (const suffix of ['?image=peer', '/entrypoint', '?container=portal']) {
      assert.equal(await call(socketPath, { method: 'POST', path: `/v1/runtime/doctools/convert/docx/pdf${suffix}`,
        headers: { 'content-type': 'application/octet-stream', 'content-length': bytes.length } }, bytes), 404);
    }
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/doctools/render',
      headers: { 'content-type': 'application/octet-stream', 'content-length': 5 } }, Buffer.alloc(5)), 413);
    assert.deepEqual(received, [{ operation: { kind: 'convert', from: 'docx', to: 'pdf' }, input: bytes }]);
  });
});

it('projects the running portal image from the bound project and refuses ambiguity', async () => {
  const { observeActuatorPortalImage } = await load();
  const image = `sha256:${'a'.repeat(64)}`;
  const portal = { Id: 'b'.repeat(64), ImageID: image, State: 'running',
    Labels: { 'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'portal' } };
  assert.deepEqual(await observeActuatorPortalImage('owned', async () => [portal]), { image, containerId: portal.Id });
  for (const rows of [[portal, portal], [{ ...portal, ImageID: 'mutable:latest' }], [{ ...portal, State: 'exited' }]]) {
    await assert.rejects(observeActuatorPortalImage('owned', async () => rows), { message: 'scope_writer_observation_unavailable' });
  }
});

it('admits only the isolated canonical sandbox for Docker-side operations', async () => {
  const { observeActuatorSandbox } = await load();
  const id = 'c'.repeat(64);
  const labels = { 'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'sandbox' };
  const sandbox = {
    Id: id, Image: `sha256:${'d'.repeat(64)}`, Name: '/owned-sandbox-1', Config: { Labels: labels,
      Env: ['PATH=/usr/bin', 'DPF_ENVIRONMENT=sandbox', 'DATABASE_URL=postgresql://dpf:dpf_sandbox@sandbox-postgres:5432/dpf'] },
    HostConfig: { Privileged: false, NetworkMode: 'owned_sandbox-runtime', PidMode: '', IpcMode: 'private', CgroupnsMode: 'private' },
    NetworkSettings: { Networks: { 'owned_sandbox-runtime': { NetworkID: 'e'.repeat(64) } } },
    Mounts: [{ Type: 'volume', Name: 'owned_sandbox_workspace', Propagation: '', Destination: '/workspace', RW: true }],
    State: { Running: true },
  };
  const observe = (actual, volumeOptions = {}) => observeActuatorSandbox('owned', async path => {
    if (path.startsWith('/containers/json?')) return [{ Id: id, Labels: labels }];
    if (path === `/containers/${id}/json`) return actual;
    if (path === '/volumes/owned_sandbox_workspace') return { Name: 'owned_sandbox_workspace', Driver: 'local', Options: volumeOptions,
      Labels: { 'com.docker.compose.project': 'owned', 'com.docker.compose.volume': 'sandbox_workspace' } };
    throw new Error('unexpected lookup');
  }, id);
  assert.deepEqual(await observe(sandbox), { containerId: id, name: 'owned-sandbox-1', image: sandbox.Image, running: true });
  for (const changed of [
    { Id: '9'.repeat(64) },
    { HostConfig: { ...sandbox.HostConfig, Privileged: true } },
    { HostConfig: { ...sandbox.HostConfig, NetworkMode: 'owned_default' } },
    { HostConfig: { ...sandbox.HostConfig, PidMode: 'host' } },
    { Config: { ...sandbox.Config, Env: [...sandbox.Config.Env, 'AUTH_SECRET=wrong'] } },
    { Config: { ...sandbox.Config, Env: sandbox.Config.Env.map(value => value.replace('sandbox-postgres', 'postgres')) } },
    { Mounts: [...sandbox.Mounts, { Type: 'bind', Source: '/var/run/docker.sock', Destination: '/local.sock', RW: false }] },
    { NetworkSettings: { Networks: { ...sandbox.NetworkSettings.Networks, 'owned_default': { NetworkID: '9'.repeat(64) } } } },
  ]) await assert.rejects(observe({ ...sandbox, ...changed }), { message: 'scope_writer_observation_unavailable' });
  await assert.rejects(observe(sandbox, { type: 'none', o: 'bind', device: '/untrusted' }), { message: 'scope_writer_observation_unavailable' });
});

it('binds a bidirectional runtime stream before forwarding input and kills it on disconnect', unixOnly, async () => {
  const { createScopeWriterObserver, openActuatorRuntimeSession } = await load();
  const starts = [], input = [], kills = [];
  let disconnected;
  const disconnect = new Promise(resolve => { disconnected = resolve; });
  let out;
  await withServer(observe => createScopeWriterObserver({ observe, openRuntimeSession: async owner => {
    starts.push(owner);
    return { write: data => { input.push(data); out(Buffer.from(data)); }, onData: fn => { out = fn; },
      onStderr: () => {}, onClose: () => {}, end: () => {}, kill: () => { kills.push(true); disconnected(); } };
  } }), async () => ({}), async socketPath => {
    const owner = { provider: 'codex', capsuleId: 'WC-RUNTIME', token: 'fixture-only', cwd: '/workspace' };
    const stream = openActuatorRuntimeSession(owner, { socketPath });
    const received = new Promise(resolve => stream.onData(resolve));
    stream.write('ready\n');
    assert.equal(String(await received), 'ready\n');
    stream.kill();
    await disconnect;
    assert.deepEqual(starts, [owner]);
    assert.deepEqual(input.map(String), ['ready\n']);
    assert.equal(kills.length, 1);
  });
});

it('serves only the actuator-owned current reassessment proof', unixOnly, async () => {
  const { createScopeWriterObserver, readActuatorReassessmentProof } = await load();
  const proof = { configDigest: 'sha256:' + 'a'.repeat(64), sourceSha: 'b'.repeat(40) };
  let calls = 0;
  await withServer(observe => createScopeWriterObserver({ observe, readReassessmentProof: async () => { calls++; return proof; } }),
    async () => ({}), async socketPath => {
      assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/reassessment-proof?image=peer' }), 404);
      assert.deepEqual(await readActuatorReassessmentProof({ socketPath }), proof);
      assert.equal(calls, 1);
    });
});

it('restarts only a catalog service named by a fixed query, never a caller-supplied container', unixOnly, async () => {
  const { createScopeWriterObserver, restartActuatorService } = await load();
  const calls = [];
  await withServer(observe => createScopeWriterObserver({ observe, restartService: async service => {
    calls.push(service);
    return { service, container: `owned-${service}-1` };
  } }), async () => ({}), async socketPath => {
    assert.deepEqual(await restartActuatorService('sandbox', { socketPath }), { service: 'sandbox', container: 'owned-sandbox-1' });
    for (const query of ['service=peer', 'service=portal-init', 'service=sandbox&container=peer', 'container=abc']) {
      assert.equal(await call(socketPath, { method: 'POST', path: `/v1/runtime/restart-service?${query}` }), 404);
    }
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/restart-service?service=sandbox' }), 404);
    await assert.rejects(restartActuatorService('peer', { socketPath }));
    assert.deepEqual(calls, ['sandbox']);
  });
});

it('resolves exactly one owned project container before restarting it by full ID', async () => {
  const { restartActuatorProjectService } = await load();
  const owner = { 'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'postgres' };
  const postgres = { Id: 'b'.repeat(64), Names: ['/owned-postgres-1'], State: 'exited', Status: 'Exited (1)', Labels: owner };
  const restarted = [];
  const restart = async id => { restarted.push(id); };
  const peers = [postgres, { ...postgres, Id: 'c'.repeat(64), Labels: { ...owner, 'com.docker.compose.project': 'peer' } },
    { ...postgres, Id: 'd'.repeat(64), Labels: { ...owner, 'com.docker.compose.oneoff': 'True' } }];
  assert.deepEqual(await restartActuatorProjectService('owned', 'postgres', async () => peers, restart),
    { service: 'postgres', container: 'owned-postgres-1' });
  assert.deepEqual(restarted, [postgres.Id]);
  await assert.rejects(restartActuatorProjectService('owned', 'postgres', async () => [postgres, { ...postgres, Id: 'e'.repeat(64) }], restart));
  await assert.rejects(restartActuatorProjectService('owned', 'postgres', async () => [], restart));
  await assert.rejects(restartActuatorProjectService('owned', 'redis', async () => peers, restart));
  await assert.rejects(restartActuatorProjectService('owned', 'postgres', async () => [{ ...postgres, Id: 'short' }], restart));
  assert.deepEqual(restarted, [postgres.Id]);
});

it('accepts only an exact container ID for a bounded daemon restart', async () => {
  const { boundedDockerSocketRestart } = await import('./docker-socket.mjs');
  const paths = [];
  const factory = (options, onResponse) => {
    paths.push(`${options.method} ${options.path}`);
    const response = new EventEmitter();
    response.statusCode = 204;
    queueMicrotask(() => { onResponse(response); response.emit('end'); });
    const req = new EventEmitter();
    req.setTimeout = () => {}; req.end = () => {}; req.destroy = () => {};
    return req;
  };
  await boundedDockerSocketRestart('a'.repeat(64), factory);
  assert.deepEqual(paths, [`POST /containers/${'a'.repeat(64)}/restart?t=10`]);
  for (const bad of ['dpf-postgres-1', 'a'.repeat(12), `${'a'.repeat(64)}/../x`]) {
    await assert.rejects(boundedDockerSocketRestart(bad, factory), /docker_engine_restart_identity_invalid/);
  }
  assert.equal(paths.length, 1);
});


it('runs the fixed Docker disk prune only as a parameterless actuator operation', unixOnly, async () => {
  const { createScopeWriterObserver, pruneActuatorDockerDisk } = await load();
  let runs = 0;
  await withServer(observe => createScopeWriterObserver({ observe, pruneDockerDisk: async () => ({ prunedDockerDisk: true, run: ++runs }) }),
    async () => ({}), async socketPath => {
      for (const path of ['/v1/runtime/prune-docker-disk?image=peer', '/v1/runtime/prune-docker-disk/all']) {
        assert.equal(await call(socketPath, { method: 'POST', path }), 404);
      }
      assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/prune-docker-disk' }), 404);
      assert.deepEqual(await pruneActuatorDockerDisk({ socketPath }), { prunedDockerDisk: true, run: 1 });
      assert.equal(runs, 1);
    });
});

it('carries one bounded JSON promoter launch request to its owner and nothing else', unixOnly, async () => {
  const { createScopeWriterObserver, launchActuatorPromoter } = await load();
  const received = [];
  await withServer(observe => createScopeWriterObserver({ observe, launchPromoter: async body => {
    received.push(body);
    return { exitCode: 0, stdout: 'promoted', stderr: '' };
  } }), async () => ({}), async socketPath => {
    const body = { owner: { kind: 'self-upgrade', runId: 'SUR-1' }, params: { targetSha: 'a'.repeat(40) } };
    assert.deepEqual(await launchActuatorPromoter(body, { socketPath, timeoutMs: 2_000 }), { exitCode: 0, stdout: 'promoted', stderr: '' });
    const json = { 'Content-Type': 'application/json' };
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/promoter-launch?run=peer',
      headers: { ...json, 'Content-Length': 2 } }, '{}'), 404);
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/promoter-launch',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': 2 } }, '{}'), 415);
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/promoter-launch',
      headers: { ...json, 'Content-Length': 300 * 1024 } }, '{'), 413);
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/promoter-launch',
      headers: { ...json, 'Content-Length': 5 } }, 'nope!'), 400);
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/promoter-launch' }), 404);
    assert.deepEqual(received, [body]);
  });
});

it('carries one bounded JSON source writer request to its owner only', unixOnly, async () => {
  const { createScopeWriterObserver, runActuatorSourceWriter } = await load();
  const received = [];
  await withServer(observe => createScopeWriterObserver({ observe, sourceWriter: async body => {
    received.push(body);
    return { ok: true, upstreamSha: 'b'.repeat(40) };
  } }), async () => ({}), async socketPath => {
    const body = { owner: { kind: 'upstream-refresh' }, operation: 'refresh-upstream-head', input: { remote: 'origin', branch: 'main' } };
    assert.deepEqual(await runActuatorSourceWriter(body, { socketPath, timeoutMs: 2_000 }), { ok: true, upstreamSha: 'b'.repeat(40) });
    const json = { 'Content-Type': 'application/json' };
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/source-writer?op=push', headers: { ...json, 'Content-Length': 2 } }, '{}'), 404);
    assert.equal(await call(socketPath, { method: 'POST', path: '/v1/runtime/source-writer', headers: { 'Content-Type': 'text/plain', 'Content-Length': 2 } }, '{}'), 415);
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/source-writer' }), 404);
    assert.deepEqual(received, [body]);
  });
});

it('carries one bounded candidate stage request to its owner only', unixOnly, async () => {
  const { createScopeWriterObserver, buildActuatorPromoterCandidate } = await load();
  const received = [];
  const artifact = { digest: `sha256:${'c'.repeat(64)}`, sourceSha: 'a'.repeat(40) };
  await withServer(observe => createScopeWriterObserver({ observe, promoterCandidate: async body => {
    received.push(body);
    return artifact;
  } }), async () => ({}), async socketPath => {
    const body = { owner: { kind: 'self-upgrade', runId: 'SUR-CAND1' }, input: { targetSha: 'a'.repeat(40) } };
    assert.deepEqual(await buildActuatorPromoterCandidate(body, { socketPath, timeoutMs: 2_000 }), artifact);
    await assert.rejects(buildActuatorPromoterCandidate({ pad: 'x'.repeat(2048) }, { socketPath, timeoutMs: 2_000 }));
    assert.equal(await call(socketPath, { method: 'GET', path: '/v1/runtime/promoter-candidate' }), 404);
    assert.deepEqual(received, [body]);
  });
});

it('carries image, reassessment and runtime protocol requests only to their own owners', unixOnly, async () => {
  const { createScopeWriterObserver, runActuatorDoctoolsImage, proveActuatorReassessmentCandidate, probeActuatorRuntimeProtocol, runActuatorSandboxDb } = await load();
  const received = [];
  const owner = (name, reply) => async body => { received.push([name, body]); return reply; };
  await withServer(observe => createScopeWriterObserver({ observe,
    doctoolsImage: owner('image', { exitCode: 0, stdout: 'sha256:x', stderr: '' }),
    reassessmentCandidate: owner('reassessment', { proof: true }),
    runtimeProtocol: owner('protocol', { info: true }),
    sandboxDb: owner('sandbox-db', { ok: true, detail: '' }),
  }), async () => ({}), async socketPath => {
    const image = { operation: 'present', reference: `dpf-promoter:${'a'.repeat(40)}` };
    const reassessment = { owner: { kind: 'self-upgrade', runId: 'SUR-R1' }, input: { targetSha: 'a'.repeat(40), release: false } };
    const protocol = { observedHostSnapshot: null };
    assert.deepEqual(await runActuatorDoctoolsImage(image, { socketPath, timeoutMs: 2_000 }), { exitCode: 0, stdout: 'sha256:x', stderr: '' });
    assert.deepEqual(await proveActuatorReassessmentCandidate(reassessment, { socketPath, timeoutMs: 2_000 }), { proof: true });
    assert.deepEqual(await probeActuatorRuntimeProtocol(protocol, { socketPath, timeoutMs: 2_000 }), { info: true });
    const database = { owner: { kind: 'build', buildId: 'FB-12345678' }, operation: 'ready' };
    assert.deepEqual(await runActuatorSandboxDb(database, { socketPath, timeoutMs: 2_000 }), { ok: true, detail: '' });
    await assert.rejects(runActuatorSandboxDb({ pad: 'x'.repeat(2048) }, { socketPath, timeoutMs: 2_000 }));
    await assert.rejects(proveActuatorReassessmentCandidate({ pad: 'x'.repeat(2048) }, { socketPath, timeoutMs: 2_000 }));
    await assert.rejects(probeActuatorRuntimeProtocol({ pad: 'x'.repeat(70 * 1024) }, { socketPath, timeoutMs: 2_000 }));
    for (const path of ['/v1/runtime/doctools-image', '/v1/runtime/reassessment-candidate', '/v1/runtime/runtime-protocol', '/v1/runtime/sandbox-db']) {
      assert.equal(await call(socketPath, { method: 'GET', path }), 404);
    }
    assert.deepEqual(received, [['image', image], ['reassessment', reassessment], ['protocol', protocol], ['sandbox-db', database]]);
  });
});

it('sends only to the canonical actuator socket or a test socket in the temporary directory', async () => {
  const { isAllowedActuatorSocketPath, readScopeWriterObservation, SCOPE_WRITER_OBSERVER_SOCKET } = await load();
  assert.equal(isAllowedActuatorSocketPath(SCOPE_WRITER_OBSERVER_SOCKET), true);
  assert.equal(isAllowedActuatorSocketPath('/tmp/x/obs.sock', '/tmp', true), true);
  // Outside a test runner the temporary-directory exception does not exist.
  assert.equal(isAllowedActuatorSocketPath('/tmp/x/obs.sock', '/tmp', false), false);
  assert.equal(isAllowedActuatorSocketPath(SCOPE_WRITER_OBSERVER_SOCKET, '/tmp', false), true);
  for (const target of ['/var/run/docker.sock', '/run/docker.sock', '/tmp/../var/run/docker.sock', '/tmp/x/obs', 'obs.sock', '', null]) {
    assert.equal(isAllowedActuatorSocketPath(target, '/tmp', true), false, String(target));
  }
  // Refused before any connection opens: no socket exists at this path.
  await assert.rejects(readScopeWriterObservation({ socketPath: '/var/run/docker.sock' }), { message: 'scope_writer_observation_unavailable' });
});

it('detects the actuator mount with one fail-closed rule', async () => {
  const { usesPrivateActuator, usesPrivateActuatorSync } = await load();
  const mounted = '1 2 0:1 / /run/dpf-actuator rw - tmpfs tmpfs rw\n';
  const plain = '1 2 0:1 / / rw - overlay overlay rw\n';
  const missing = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  const denied = Object.assign(new Error('EACCES'), { code: 'EACCES' });
  // Read and parsed: the mount table decides.
  assert.equal(await usesPrivateActuator({ read: async () => mounted, platform: 'linux' }), true);
  assert.equal(await usesPrivateActuator({ read: async () => plain, platform: 'linux' }), false);
  assert.equal(usesPrivateActuatorSync({ read: () => plain, platform: 'linux' }), false);
  // Unknown: treated as mounted, so no raw Docker runs.
  assert.equal(await usesPrivateActuator({ read: async () => { throw denied; }, platform: 'linux' }), true);
  assert.equal(await usesPrivateActuator({ read: async () => { throw missing; }, platform: 'linux' }), true);
  assert.equal(await usesPrivateActuator({ read: async () => null, platform: 'linux' }), true);
  assert.equal(usesPrivateActuatorSync({ read: () => { throw denied; }, platform: 'linux' }), true);
  // An empty or malformed table is an unknown too: mounted.
  for (const table of ['', '\n', 'garbage\n', `${plain}not a mount record\n`, '1 2 0:1 / /run/dpf-actuator rw tmpfs\n',
    'x 2 0:1 / / rw - overlay overlay rw\n']) {
    assert.equal(await usesPrivateActuator({ read: async () => table, platform: 'linux' }), true, JSON.stringify(table));
    assert.equal(usesPrivateActuatorSync({ read: () => table, platform: 'linux' }), true, JSON.stringify(table));
  }
  assert.equal(await usesPrivateActuator({ read: async () => `${plain}36 35 98:0 /mnt1 /mnt2 rw,noatime master:1 - ext3 /dev/root rw,errors=continue\n`, platform: 'linux' }), false);
  // Real Linux tables carry namespace mounts whose root is not a path; they are well-formed.
  const nsfs = '4026 29 0:4 net:[4026531992] /run/docker/netns/default rw shared:5 - nsfs nsfs rw\n';
  assert.equal(await usesPrivateActuator({ read: async () => `${plain}${nsfs}`, platform: 'linux' }), false);
  // No /proc off Linux is a definite "not mounted".
  assert.equal(await usesPrivateActuator({ read: async () => { throw missing; }, platform: 'darwin' }), false);
  assert.equal(usesPrivateActuatorSync({ read: () => { throw missing; }, platform: 'win32' }), false);
  assert.equal(usesPrivateActuatorSync({ read: () => { throw denied; }, platform: 'darwin' }), true);
});

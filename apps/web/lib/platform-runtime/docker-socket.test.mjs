import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { boundedDockerSocketGet, boundedDockerSocketStop } from './docker-socket.mjs';

const id = 'b'.repeat(64);
function transport({ status = 200, body = '{}', failure, timeout = false } = {}) {
  const observed = {};
  const factory = (options, receive) => {
    observed.options = options;
    const req = new EventEmitter();
    req.destroy = () => { observed.destroyed = true; };
    req.setTimeout = (ms, callback) => { observed.timeoutMs = ms; observed.onTimeout = callback; };
    req.end = () => queueMicrotask(() => {
      if (timeout) { observed.onTimeout(); return; }
      if (failure === 'request') { req.emit('error', new Error('fixture-private-detail')); return; }
      const response = new EventEmitter(); response.statusCode = status; receive(response);
      if (failure === 'response') { response.emit('error', new Error('fixture-private-detail')); return; }
      response.emit('data', Buffer.from(body)); response.emit('end');
    });
    return req;
  };
  return { factory, observed };
}

test('existing Docker GET retains bounded JSON behavior', async () => {
  const { factory, observed } = transport({ body: '{"Running":false}' });
  assert.deepEqual(await boundedDockerSocketGet('/containers/fixture/json', factory, 5000, 1024), { Running: false });
  assert.equal(observed.options.method, 'GET');
});

for (const status of [204, 304]) test(`fixed Docker stop accepts empty ${status}`, async () => {
  const { factory, observed } = transport({ status, body: '' });
  assert.equal(await boundedDockerSocketStop(id, factory), undefined);
  assert.deepEqual(observed.options, { socketPath: '/var/run/docker.sock', path: `/containers/${id}/stop?t=5`, method: 'POST' });
  assert.equal(observed.timeoutMs, 10_000);
});

test('stop refuses names, partial IDs and injected paths before I/O', async () => {
  for (const value of ['portal', id.slice(0, 12), id + '/kill', 'https://host/' + id, null]) {
    await assert.rejects(boundedDockerSocketStop(value, () => assert.fail('unverified I/O')), /stop_identity_invalid/);
  }
});

for (const failure of ['request', 'response']) test(`Docker ${failure} failure is controlled without private details`, async () => {
  const { factory } = transport({ failure });
  await assert.rejects(boundedDockerSocketStop(id, factory), error => {
    assert.match(error.message, /^docker_engine_(?:response_)?unavailable$/);
    assert.ok(!error.message.includes('fixture-private-detail')); return true;
  });
});

test('oversized response and invalid JSON do not escape or grow the buffer', async () => {
  const large = transport({ body: 'fixture-private-detail'.repeat(1000) });
  await assert.rejects(boundedDockerSocketGet('/info', large.factory, 5000, 64), /response_too_large/);
  assert.equal(large.observed.destroyed, true);
  const invalid = transport({ body: 'fixture-private-detail' });
  await assert.rejects(boundedDockerSocketGet('/info', invalid.factory, 5000, 1024), { message: 'docker_engine_response_invalid' });
});

test('stop timeout and non-contract HTTP response remain unverified', async () => {
  await assert.rejects(boundedDockerSocketStop(id, transport({ timeout: true }).factory), /docker_engine_timeout/);
  await assert.rejects(boundedDockerSocketStop(id, transport({ status: 200 }).factory), /stop_response_unverified/);
  await assert.rejects(boundedDockerSocketStop(id, transport({ status: 500, body: 'fixture-private-detail' }).factory), { message: 'docker_engine_http_500' });
});

test('synchronous transport failure is controlled', async () => {
  await assert.rejects(boundedDockerSocketStop(id, () => { throw new Error('fixture-private-detail'); }), { message: 'docker_engine_unavailable' });
});

test('an active slowly streaming response still has a total deadline', async () => {
  let tick, destroyed = false;
  const factory = (_options, receive) => {
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => { destroyed = true; clearInterval(tick); };
    req.end = () => {
      const response = new EventEmitter(); response.statusCode = 200; receive(response);
      tick = setInterval(() => response.emit('data', Buffer.from(' ')), 1);
    };
    return req;
  };
  await assert.rejects(boundedDockerSocketGet('/info', factory, 20, 1024), /docker_engine_timeout/);
  assert.equal(destroyed, true);
});

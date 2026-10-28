import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './package.mjs';
import { stageRuntimeInstallation } from './runtime-installation.mjs';
import { runtimeInstallationFixture, runtimeAuthorityFixture } from './runtime-test-fixtures.mjs';
import { createNativeRuntimeAdapter } from './runtime-native-adapter.mjs';
import * as native from './runtime-native-adapter.mjs';
import { RUNTIME_LOCK } from './runtime-profile.mjs';

async function fixture(t) {
  const f = await runtimeInstallationFixture(t);
  // The installed card hash is bound exactly as on the actual DMR API.
  const cards = f.models.map((model, i) => ({ id: model.digest, config: { fixture: i } }));
  const report = JSON.parse(f.reportBytes.toString());
  f.models.forEach((model, i) => { model.modelMetadataSha256 = sha256(JSON.stringify(cards[i].config));
    report.models[i].modelMetadataSha256 = model.modelMetadataSha256; });
  f.reportBytes = Buffer.from(JSON.stringify(report)); f.binding.qualificationReportSha256 = sha256(f.reportBytes);
  const { servingProfileDigest } = await import('./runtime-installation.mjs');
  f.binding.profileSha256 = servingProfileDigest({ models: f.models, physicalDevice: f.physicalDevice });
  await stageRuntimeInstallation(f);
  await writeFile(join(f.stateDirectory, 'install-state.json'), JSON.stringify({ schemaVersion: 2, installerVersion: 'fixture',
    platform: 'darwin', arch: 'arm64', enabledRuntimeCapabilities: [], capabilityCatalogHash: null, capabilityStateVersion: null }), { mode: 0o600 });
  const authority = await runtimeAuthorityFixture(f.binding), calls = [], services = [];
  let device = f.physicalDevice;
  const rows = f.models.map(model => ({ backend_name: 'llama.cpp', model_name: model.model, mode: model.configuration[0].mode }));
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url), method = options.method ?? 'GET'; calls.push({ url: u.href, method });
    const json = value => Response.json(value);
    if (u.pathname === '/engines/ps') return json(rows);
    if (u.pathname === '/version') return json({ version: RUNTIME_LOCK.packageVersion });
    if (u.pathname === '/') return json({ ok: true });
    if (u.pathname === '/engines/_configure' && method === 'GET') {
      const i = f.models.findIndex(model => model.model === u.searchParams.get('model'));
      const { model, mode, ...Config } = f.models[i].configuration[0];
      return json([{ Backend: 'llama.cpp', Model: model, ModelID: f.models[i].digest, Mode: mode, Config }]);
    }
    const i = f.models.findIndex(model => u.pathname === '/models/' + model.model.split('/').map(encodeURIComponent).join('/'));
    if (i >= 0) return json(cards[i]);
    if (u.pathname.endsWith('/export')) return new Response('fixture archive');
    if (u.pathname === '/models/load' || u.pathname.endsWith('/tag')) return json({ ok: true });
    throw new Error('Unexpected fixture API request ' + method + ' ' + u.pathname);
  };
  const adapter = createNativeRuntimeAdapter({ authority, stateDirectory: f.stateDirectory, baselineEngine: f.baselineEngine,
    platform: 'darwin', architecture: 'arm64', fetchImpl,
    launchAgentsDirectory: join(await realpath(f.root), 'LaunchAgents'),
    run: async (command, args) => ({ stdout: command.endsWith('/lsof') && args.includes('-iTCP:12436')
      ? 'p123\nn127.0.0.1:12436\n' : JSON.stringify({ SPDisplaysDataType: [{ sppci_model: device }] }) }),
    serviceFactory: options => {
      const service = { label: options.label, stops: 0, prepare: async () => {}, start: async () => ({ pid: 123 }),
        stop: async () => { service.stops++; return { stopped: true }; } };
      services.push(service); return service;
    },
    processes: async () => [], observeManaged: async () => ({ exists: false }), delay: async () => {} });
  t.after(() => adapter.stopOwned());
  return { ...f, cards, calls, rows, authority, adapter, services, changeDevice: value => { device = value; } };
}

test('native adapter preflight binds actual staged bytes, physical host, current cards/settings and loaded model identities using reads only', async t => {
  const f = await fixture(t); const snapshot = await f.adapter.preflight(f.authority.action);
  assert.equal(snapshot.models.length, 2); assert.equal(snapshot.loadedModels.length, 2);
  assert.equal(snapshot.baselineEngineSha256, f.binding.baselineEngineSha256);
  assert.ok(f.calls.every(row => row.method === 'GET'));
});

test('native adapter refuses changed physical hardware or model bytes before any service/configuration effect', async t => {
  const f = await fixture(t); f.changeDevice('Apple M4 Max');
  await assert.rejects(f.adapter.preflight(f.authority.action), /qualified|device/);
  f.changeDevice(f.physicalDevice); f.cards[0].id = 'sha256:' + '9'.repeat(64);
  await assert.rejects(f.adapter.preflight(f.authority.action), /identity|digest|changed/);
  assert.ok(f.calls.every(row => row.method === 'GET'));
});

test('stock import does not configure/preload weights, and candidate configuration refuses a resident Docker model', async t => {
  const f = await fixture(t); const snapshot = await f.adapter.preflight(f.authority.action);
  await f.adapter.prepareCandidate(snapshot);
  assert.equal(f.calls.filter(row => row.method === 'POST' && row.url.includes('/engines/_configure')).length, 0);
  await assert.rejects(f.adapter.configureCandidate(snapshot), /resident/);
  assert.equal(f.calls.filter(row => row.method === 'POST' && row.url.includes('/engines/_configure')).length, 0);
});

test('active identity requires mapped runner and engine inodes, not command names or API self-report', () => {
  const expected = { daemonPid: 123, allowedPids: [123, 124], runnerPath: '/private/runtime/bin/dmr', runnerInode: 10,
    enginePath: '/private/runtime/engine/bin/llama-server', engineInode: 20 };
  const observed = 'p123\nftxt\ni10\nn/private/runtime/bin/dmr\np124\nftxt\ni20\nn/private/runtime/engine/bin/llama-server\n';
  assert.deepEqual(native.verifyMappedRuntimeFiles(observed, expected), { daemonPid: 123, enginePids: [124] });
  for (const changed of [observed.replace('i20', 'i99'), observed.replace('/engine/bin/llama-server', '/engine/bin/foreign'),
    observed.replace('p124', 'p999'), observed.replace('i10', 'i88')]) {
    assert.throws(() => native.verifyMappedRuntimeFiles(changed, expected), /mapped|identity/);
  }
});

test('a reachable port is usable only when the selected daemon owns its loopback listener', () => {
  assert.equal(native.verifyOwnedRuntimeListener('p123\nn127.0.0.1:12436\n', 123), true);
  for (const value of ['p999\nn127.0.0.1:12436\n', 'p123\nn*:12436\n', '',
    'p123\nn127.0.0.1:12436\np999\nn127.0.0.1:12436\n']) {
    assert.throws(() => native.verifyOwnedRuntimeListener(value, 123), /listener|ownership/);
  }
});

test('cleanup after permanent startup does not reopen an already confirmed finite shutdown', async t => {
  const f = await fixture(t); const snapshot = await f.adapter.preflight(f.authority.action);
  await f.adapter.prepareCandidate(snapshot); f.rows.length = 0;
  await f.adapter.stopCandidate();
  await writeFile(join(f.stateDirectory, 'install-state.json'), JSON.stringify({ schemaVersion: 2, installerVersion: 'fixture',
    platform: 'darwin', arch: 'arm64', enabledRuntimeCapabilities: [], capabilityCatalogHash: null, capabilityStateVersion: null,
    managedInference: { schemaVersion: 1, mode: 'native', actionKey: f.authority.action.actionKey,
      nodeId: f.authority.action.nodeId, device: f.physicalDevice, port: 12436, ...f.binding } }));
  await f.adapter.startCommitted(snapshot); await f.adapter.stopOwned();
  assert.equal(f.services.find(service => service.label.includes('.transition-')).stops, 1);
  assert.equal(f.services.find(service => service.label.endsWith('.managed')).stops, 1);
});

test('an authoritative parent fence prevents a launch even while the previous signed snapshot has time remaining', async t => {
  const f = await fixture(t); const snapshot = await f.adapter.preflight(f.authority.action);
  f.adapter.fence();
  await assert.rejects(f.adapter.prepareCandidate(snapshot), /fenced/);
  assert.equal(f.services.length, 0);
});

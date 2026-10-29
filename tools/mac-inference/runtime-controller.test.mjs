import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signEdgeActionEnvelope, canonicalizeEdgeActionEnvelope } from '../../packages/db/src/edge-action-envelope.ts';
import { sha256 } from './package.mjs';
import { createTransitionAuthority } from './runtime-authority.mjs';
import { createNativeTransitionStore, executeManagedRuntimeTransition } from './runtime-controller.mjs';

async function fixture(t, operation = 'activate') {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'dpf-native-transition-'));
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const initial = { schemaVersion: 2, installerVersion: 'fixture', platform: 'darwin', arch: 'arm64',
    enabledRuntimeCapabilities: [], capabilityCatalogHash: null, capabilityStateVersion: null };
  const statePath = join(stateDirectory, 'install-state.json');
  await writeFile(statePath, JSON.stringify(initial), { mode: 0o600 });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519'); let valid = true;
  const now = Date.now();
  const envelope = signEdgeActionEnvelope({ version: 'dpf.edge-action/1', signingKeyId: 'fixture', actionKey: 'RA-ACTIVATE',
    actionType: 'inference.runtime.transition', nodeId: 'edge-test', nonce: 'nonce', issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 240000).toISOString(), parameters: { version: 1, operation, leaseId: 'NPEL-TEST',
      sourceSha: 'a'.repeat(40), profileSha256: 'b'.repeat(64), runtimeManifestSha256: 'c'.repeat(64),
      qualificationReportSha256: 'd'.repeat(64), baselineEngineSha256: 'e'.repeat(64) } }, privateKey);
  const admission = signEdgeActionEnvelope({ ...envelope, actionType: 'inference.runtime.admission', nonce: 'admission',
    expiresAt: new Date(now + 25000).toISOString(), parameters: { schemaVersion: 1, ready: true,
      requestDigest: sha256(canonicalizeEdgeActionEnvelope(envelope)), leaseId: 'NPEL-TEST',
      quiescenceRunId: 'QR-test', approvedChangeRequestId: 'CR-test', ownerSessionId: 'our-chat', branchName: 'codex/mac-inference-activation' } }, privateKey);
  const authority = await createTransitionAuthority({ envelope, expectedNodeId: envelope.nodeId, publicKey,
    readAdmission: async () => { if (!valid) throw new Error('fixture authority lost'); return admission; } });
  const calls = [], store = createNativeTransitionStore({ stateDirectory });
  const runtime = Object.fromEntries(['preflight', 'prepareCandidate', 'drainBaseline', 'configureCandidate', 'verifyCandidate',
    'stopCandidate', 'startCommitted', 'verifyCommitted', 'stopOwned', 'restoreBaseline', 'verifyBaseline', 'stopPrevious']
    .map(name => [name, async () => { calls.push(name); return name === 'preflight' ? { loadedModels: ['chat', 'embedding'] } : { stopped: true }; }]));
  const authorize = async (operation, actionKey) => {
    const action = signEdgeActionEnvelope({ ...envelope, actionKey, nonce: 'nonce-' + actionKey,
      parameters: { ...envelope.parameters, operation } }, privateKey);
    const proof = signEdgeActionEnvelope({ ...admission, actionKey, nonce: 'admission-' + actionKey,
      parameters: { ...admission.parameters, requestDigest: sha256(canonicalizeEdgeActionEnvelope(action)) } }, privateKey);
    return createTransitionAuthority({ envelope: action, expectedNodeId: action.nodeId, publicKey, readAdmission: async () => proof });
  };
  return { stateDirectory, statePath, initial, calls, store, runtime, authority, envelope, authorize, loseAuthority: () => { valid = false; },
    readState: async () => JSON.parse(await readFile(statePath, 'utf8')) };
}

test('activation fences new requests, drains Docker, verifies/stops the finite candidate and commits one owned native service', async t => {
  const f = await fixture(t);
  f.runtime.configureCandidate = async () => {
    f.calls.push('configureCandidate'); assert.equal((await f.readState()).managedInference.mode, 'transitioning');
  };
  const result = await executeManagedRuntimeTransition(f);
  assert.equal(result.status, 'active'); assert.equal(result.settlement, 'confirmed');
  assert.equal((await f.readState()).managedInference.mode, 'native');
  assert.ok(f.calls.indexOf('drainBaseline') < f.calls.indexOf('configureCandidate'));
  assert.ok(f.calls.indexOf('stopCandidate') < f.calls.indexOf('startCommitted'));
  assert.equal((await readdir(f.stateDirectory)).includes('.runtime-transition-apply.lock'), false);
  await assert.rejects(executeManagedRuntimeTransition(f), /already|occupied|consumed/);
});

test('a failed candidate restores captured state only after confirmed owned cleanup', async t => {
  const f = await fixture(t); f.runtime.verifyCandidate = async () => { throw new Error('fixture tool response failed'); };
  await assert.rejects(executeManagedRuntimeTransition(f), /tool response failed/);
  assert.ok(f.calls.indexOf('stopOwned') < f.calls.indexOf('restoreBaseline'));
  assert.deepEqual(await f.readState(), f.initial);
  assert.equal((await readdir(f.stateDirectory)).includes('.runtime-transition-apply.lock'), false);
});

test('unknown cleanup retains the fence/operation lock and never loads competing Docker weights', async t => {
  const f = await fixture(t); f.runtime.verifyCandidate = async () => { throw new Error('fixture candidate failed'); };
  f.runtime.stopOwned = async () => { f.calls.push('stopOwned'); throw new Error('descendant closure unknown'); };
  await assert.rejects(executeManagedRuntimeTransition(f), /unknown|unconfirmed/);
  assert.equal(f.calls.includes('restoreBaseline'), false);
  assert.equal((await f.readState()).managedInference.mode, 'uncertain');
  assert.ok((await readdir(f.stateDirectory)).includes('.runtime-transition-apply.lock'));
});

test('lost authority before execution has no state effects; loss during execution cannot restore baseline or claim success', async t => {
  const f = await fixture(t); f.loseAuthority();
  await assert.rejects(executeManagedRuntimeTransition(f), /authority lost/);
  assert.deepEqual(await f.readState(), f.initial); assert.deepEqual(f.calls, []);
  const g = await fixture(t); g.runtime.configureCandidate = async () => { g.loseAuthority(); };
  await assert.rejects(executeManagedRuntimeTransition(g), /authority|unknown/);
  assert.equal(g.calls.includes('restoreBaseline'), false);
  assert.notEqual((await g.readState()).managedInference.mode, 'native');
});

test('plain asserted authority cannot reach the operation store or host adapter', async t => {
  const f = await fixture(t);
  await assert.rejects(executeManagedRuntimeTransition({ ...f, authority: { action: f.envelope, assertCurrent: async () => ({ ready: true }) } }), /Unverified/);
  assert.deepEqual(f.calls, []); assert.deepEqual(await f.readState(), f.initial);
});

test('a separately admitted rollback stops the exact selected native runtime before restoring Docker', async t => {
  const f = await fixture(t); await executeManagedRuntimeTransition(f); f.calls.length = 0;
  f.authority = await f.authorize('rollback', 'RA-ROLLBACK');
  const result = await executeManagedRuntimeTransition(f);
  assert.equal(result.status, 'rolled-back'); assert.equal((await f.readState()).managedInference.mode, 'docker');
  assert.ok(f.calls.indexOf('stopPrevious') < f.calls.indexOf('restoreBaseline'));
  assert.equal(f.calls.includes('startCommitted'), false);
});

test('an unconfirmed candidate shutdown cannot be followed by a permanent service start', async t => {
  const f = await fixture(t); f.runtime.stopCandidate = async () => ({ stopped: false });
  await assert.rejects(executeManagedRuntimeTransition(f), /shutdown|unconfirmed/);
  assert.equal(f.calls.includes('startCommitted'), false);
});

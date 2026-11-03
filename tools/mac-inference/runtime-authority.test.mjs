import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { canonicalizeEdgeActionEnvelope, signEdgeActionEnvelope } from '../../packages/db/src/edge-action-envelope.ts';
import { sha256 } from './package.mjs';
import { createTransitionAuthority, requireTransitionAuthority } from './runtime-authority.mjs';

function fixture() {
  const keys = generateKeyPairSync('ed25519'); let now = Date.parse('2026-10-28T21:00:00Z');
  const envelope = signEdgeActionEnvelope({ version: 'dpf.edge-action/1', signingKeyId: 'fixture', actionKey: 'RA-TEST',
    nodeId: 'edge-test', actionType: 'inference.runtime.transition', nonce: 'nonce-original', issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 240000).toISOString(), parameters: { version: 1, operation: 'activate', sourceSha: 'a'.repeat(40),
      profileSha256: 'b'.repeat(64), runtimeManifestSha256: 'c'.repeat(64), qualificationReportSha256: 'd'.repeat(64),
      baselineEngineSha256: 'e'.repeat(64), leaseId: 'NPEL-TEST' } }, keys.privateKey);
  const signAdmission = change => signEdgeActionEnvelope({ version: 'dpf.edge-action/1', signingKeyId: 'fixture', actionKey: envelope.actionKey,
    nodeId: envelope.nodeId, actionType: 'inference.runtime.admission', nonce: 'nonce-read', issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 25000).toISOString(), parameters: { schemaVersion: 1, ready: true,
      requestDigest: sha256(canonicalizeEdgeActionEnvelope(envelope)), leaseId: 'NPEL-TEST', quiescenceRunId: 'QR-test',
      approvedChangeRequestId: 'CR-test', ownerSessionId: 'our-chat', branchName: 'codex/mac-inference-activation', ...change } }, keys.privateKey);
  let admission = signAdmission();
  return { envelope, keys, signAdmission, advance: ms => { now += ms; }, setAdmission: value => { admission = value; },
    options: { envelope, expectedNodeId: 'edge-test', publicKey: keys.publicKey, now: () => now, readAdmission: async () => admission } };
}

test('transition authority reuses the signed machine envelope and requires fresh bound drain/admission proof', async () => {
  const f = fixture(); const authority = await createTransitionAuthority(f.options);
  assert.equal(requireTransitionAuthority(authority).action.actionKey, 'RA-TEST');
  assert.equal((await authority.assertCurrent()).leaseId, 'NPEL-TEST');
  f.advance(26000); await assert.rejects(authority.assertCurrent(), /expired|fresh/);
});

test('a qualified report, plain ready object or another signed request cannot confer host admission', async () => {
  assert.throws(() => requireTransitionAuthority({ assertCurrent() {}, action: {} }), /Unverified/);
  for (const change of [{ ready: false }, { requestDigest: '0'.repeat(64) }, { leaseId: 'NPEL-OTHER' },
    { quiescenceRunId: '' }, { approvedChangeRequestId: '' }, { command: 'arbitrary' }]) {
    const f = fixture(); f.setAdmission(f.signAdmission(change));
    await assert.rejects(createTransitionAuthority(f.options), /admission|binding/);
  }
  const f = fixture(); f.setAdmission({ ready: true });
  await assert.rejects(createTransitionAuthority(f.options), /admission|envelope/);
});

test('wrong node, changed parameters, stale original and invalid signature refuse before host effects', async () => {
  for (const change of [f => { f.options.expectedNodeId = 'another-node'; },
    f => { f.envelope.parameters.operation = 'rollback'; },
    f => { f.advance(240001); }, f => { f.envelope.signature = 'invalid'; }]) {
    const f = fixture(); change(f); await assert.rejects(createTransitionAuthority(f.options), /envelope|signature|expired|node/);
  }
});

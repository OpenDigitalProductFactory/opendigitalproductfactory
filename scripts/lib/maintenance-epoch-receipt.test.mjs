import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signMaintenanceEpoch, verifyMaintenanceEpoch } from './maintenance-epoch-receipt.mjs';
import * as epochs from './maintenance-epoch-receipt.mjs';

const secret = 'a'.repeat(64);
const at = '2026-10-16T01:00:00.000Z';
const old = (id) => ({ id: id.repeat(64), startedAt: '2026-10-15T00:00:00.000Z' });
const fresh = (id) => ({ id: id.repeat(64), startedAt: '2026-10-16T01:01:00.000Z' });
export const fixture = () => ({
  schemaVersion: 1, runId: 'SUR-EXAMPLE', targetSha: 'a'.repeat(40), promoterDigest: `sha256:${'b'.repeat(64)}`,
  recoveryPointDigest: 'c'.repeat(64), project: 'dpf', daemonId: 'daemon-example', capturedAt: at,
  before: { portal: old('1'), sandbox: old('2') },
  completedAt: '2026-10-16T01:02:00.000Z', after: { portal: fresh('3'), sandbox: fresh('4') },
  retiredContainerIds: ['1'.repeat(64), '2'.repeat(64)], inventoryDigest: 'd'.repeat(64),
});
const expected = () => ({ runId: 'SUR-EXAMPLE', targetSha: 'a'.repeat(40), promoterDigest: `sha256:${'b'.repeat(64)}`,
  recoveryPointDigest: 'c'.repeat(64), now: Date.parse('2026-10-16T01:03:00.000Z') });

describe('authenticated maintenance epoch retirement', () => {
  it('verifies exact source/run/recovery identity without granting retry or settlement', () => {
    const output = verifyMaintenanceEpoch(signMaintenanceEpoch(fixture(), secret), secret, expected());
    assert.deepEqual(output, fixture());
    assert.equal(Object.hasOwn(output, 'executionSettled'), false);
    assert.equal(Object.hasOwn(output, 'retryAllowed'), false);
  });
  it('authenticates nested identities and rejects wrong keys', () => {
    const envelope = signMaintenanceEpoch(fixture(), secret);
    const data = JSON.parse(envelope.payload);
    data.after.sandbox.id = '9'.repeat(64);
    assert.throws(() => verifyMaintenanceEpoch({ ...envelope, payload: JSON.stringify(data) }, secret, expected()));
    assert.throws(() => verifyMaintenanceEpoch(envelope, 'z'.repeat(64), expected()));
  });
  for (const key of ['runId', 'targetSha', 'promoterDigest', 'recoveryPointDigest']) {
    it(`rejects cross-binding reuse: ${key}`, () => {
      assert.throws(() => verifyMaintenanceEpoch(signMaintenanceEpoch(fixture(), secret), secret, { ...expected(), [key]: 'different' }));
    });
  }
  for (const [title, mutate] of [
    ['unchanged sandbox', p => { p.after.sandbox.id = p.before.sandbox.id; }],
    ['missing sandbox', p => { delete p.after.sandbox; }],
    ['partial ID', p => { p.before.portal.id = '123'; }],
    ['unknown nested property', p => { p.after.portal.health = 'good'; }],
    ['extra top property', p => { p.executionSettled = true; }],
    ['unknown schema', p => { p.schemaVersion = 2; }],
    ['future observation', p => { p.completedAt = '2027-01-01T00:00:00.000Z'; }],
    ['backward observation', p => { p.completedAt = '2026-10-15T00:00:00.000Z'; }],
    ['old replacement start', p => { p.after.portal.startedAt = p.before.portal.startedAt; }],
    ['unfinished removal', p => { p.retiredContainerIds.pop(); }],
  ]) {
    it(`rejects signed but insufficient evidence: ${title}`, () => {
      // Valid authentication cannot turn incomplete observation into retirement.
      assert.throws(() => verifyMaintenanceEpoch(signMaintenanceEpoch(mutateCopy(mutate), secret), secret, expected()));
    });
  }
});
function mutateCopy(mutate) { const p = fixture(); mutate(p); return p; }

describe('authenticated replacement start continuity', () => {
  const original = fixture().after;
  original.portal.startedAt = '2026-10-16T01:01:00.296462753Z';
  const observedAt = Date.parse('2026-10-16T01:03:00.000Z');

  it('accepts exact replacement IDs with increasing starts at full Docker precision', () => {
    const current = structuredClone(original);
    current.portal.startedAt = '2026-10-16T01:01:00.296462754Z';
    current.sandbox.startedAt = '2026-10-16T01:02:00.001Z';
    assert.equal(epochs.hasContinuousMaintenanceStarts(original, current, observedAt), true);
    assert.equal(epochs.hasContinuousMaintenanceStarts(original, original, observedAt), true);
  });

  for (const [label, time] of [
    ['one-nanosecond reversal', '2026-10-16T01:01:00.296462752Z'],
    ['future sub-millisecond part', '2026-10-16T01:03:00.000000001Z'],
    ['normalized calendar value', '2026-11-31T01:01:00.300Z'],
    ['normalized midnight', '2026-10-15T24:00:00Z'],
    ['extra precision', '2026-10-16T01:01:01.0000000001Z'],
    ['non-UTC equivalent', '2026-10-16T02:01:00.296462753+01:00'],
  ]) it(`refuses a ${label}`, () => {
    const current = structuredClone(original);
    current.portal.startedAt = time;
    const ceiling = label === 'normalized calendar value' ? Date.parse('2027-01-01T00:00:00.000Z') : observedAt;
    assert.equal(epochs.hasContinuousMaintenanceStarts(original, current, ceiling), false);
  });

  it('requires both exact signed replacement identities', () => {
    const current = structuredClone(original);
    current.sandbox.id = '5'.repeat(64);
    assert.equal(epochs.hasContinuousMaintenanceStarts(original, current, observedAt), false);
    assert.equal(epochs.hasContinuousMaintenanceStarts(original, { portal: original.portal }, observedAt), false);
  });
});

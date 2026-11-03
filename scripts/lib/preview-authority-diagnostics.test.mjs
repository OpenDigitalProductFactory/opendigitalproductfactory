import assert from 'node:assert/strict';
import test from 'node:test';
import { previewLeaseEventSummary as summary } from './dev-preview-runtime.mjs';
import { superviseLeaseRun } from './lease-supervisor.mjs';
const at = '2026-11-03T01:14:37.161Z';
const expiresAt = '2026-11-03T01:16:36.153Z';

test('retains acknowledged authority and uncertainty chronology without raw messages', () => {
  assert.deepEqual(summary({ type: 'heartbeat-renewed', at, expiresAt }),
    { type: 'heartbeat-renewed', at, expiresAt });
  assert.deepEqual(summary({ type: 'heartbeat-uncertain', at, expiresAt, attempt: 2, reason: 'ETIMEDOUT private-secret' }),
    { type: 'heartbeat-uncertain', category: 'transport-timeout', at, expiresAt, attempt: 2 });
  assert.deepEqual(summary({ type: 'authority-deadline', at, expiresAt, reason: 'lease-authority-deadline' }),
    { type: 'authority-deadline', category: 'authority-deadline', at, expiresAt });
});

test('rejects malformed chronology, counters and arbitrary diagnostic payloads', () => {
  for (const invalid of ['private-secret', '2026-02-30T00:00:00.000Z', 123, null, {}, '2026-11-03T01:14:37.161Z private-secret']) {
    assert.deepEqual(summary({ type: 'heartbeat-uncertain', at: invalid, expiresAt: invalid, reason: 'private-secret', child: 'private-secret' }),
      { type: 'heartbeat-uncertain', category: 'unclassified' });
  }
  for (const attempt of [-1, 0, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER, '2']) {
    assert.deepEqual(summary({ type: 'heartbeat-uncertain', attempt }), { type: 'heartbeat-uncertain', category: 'unclassified' });
  }
  assert.equal(summary({ type: 'heartbeat-renewed' }), null, 'incomplete ACK cannot become authority evidence');
  assert.equal(summary({ type: 'private-secret', at, expiresAt }), null);
});

test('classifies fixed owned cleanup failure without exposing aggregate children', () => {
  assert.deepEqual(summary({ type: 'fence-termination-failed', at, reason: 'preview_owned_cleanup_failed', errors: ['private-secret'] }),
    { type: 'fence-termination-failed', category: 'owned-cleanup', at });
  assert.deepEqual(summary({ type: 'fence-termination-failed', reason: 'preview_owned_cleanup_failed private-secret' }),
    { type: 'fence-termination-failed', category: 'unclassified' });
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
for (const response of ['success', 'transport-error']) {
  test(`late ${response} while fence termination is pending cannot revive supervision`, async () => {
    const child = deferred(), renewal = deferred(), stopping = deferred();
    const events = []; let heartbeat, deadline, deadlineCount = 0, retryCount = 0;
    const result = superviseLeaseRun({ ttlMs: 1000, expiresAt: new Date(1000).toISOString(), now: () => 0,
      run: () => child.promise,
      renew: async () => { await renewal.promise; if (response === 'transport-error') throw new Error('ETIMEDOUT'); return { success: true, expiresAt: new Date(2000).toISOString() }; },
      terminate: () => stopping.promise, observeReservation: async () => ({ reservationState: 'pending' }),
      schedule: fn => { heartbeat = fn; return 1; }, cancelSchedule: () => {},
      scheduleDeadline: fn => { deadline = fn; ++deadlineCount; return 2; }, cancelDeadline: () => {},
      scheduleRetry: () => { ++retryCount; return 3; }, cancelRetry: () => {}, onEvent: event => events.push(event),
    });
    const pending = heartbeat(); const fencing = deadline();
    renewal.resolve(); await pending;
    const observed = { deadlineCount, retryCount, renewed: events.filter(e => e.type === 'heartbeat-renewed').length };
    stopping.resolve(); await fencing; child.resolve({ status: 143 });
    assert.equal((await result).status, 'fenced');
    assert.deepEqual(observed, { deadlineCount: 1, retryCount: 0, renewed: 0 });
  });
}

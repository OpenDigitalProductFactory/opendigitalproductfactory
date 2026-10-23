import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captureMaintenanceEpoch, finishMaintenanceEpoch, persistMaintenanceEpoch } from './promoter-epoch-evidence.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const secret = 'a'.repeat(64);
const identity = { runId: 'SUR-EXAMPLE', targetSha: 'a'.repeat(40), promoterDigest: `sha256:${'b'.repeat(64)}`,
  recoveryPointDigest: 'c'.repeat(64), project: 'dpf' };
function harness() {
  let phase = 'before'; let fault = '';
  const commands = [];
  const before = ['1'.repeat(64), '2'.repeat(64)];
  const after = ['3'.repeat(64), '4'.repeat(64)];
  const runDocker = async args => {
    commands.push(args);
    if (fault === 'transport') throw new Error('daemon unavailable PRIVATE_SECRET');
    if (args[0] === 'info') return fault === 'daemon-changed' ? 'different-daemon' : 'daemon-example';
    if (args[0] === 'ps') {
      const ids = phase === 'before' ? before : fault === 'old-present' ? [...before, ...after] : after;
      return ids.join('\n');
    }
    assert.equal(args[0], 'inspect');
    const id = args.at(-1); const service = (id[0] === '1' || id[0] === '3') ? 'portal' : 'sandbox';
    return JSON.stringify({ Id: id, State: { Running: fault !== 'stopped', StartedAt: phase === 'before'
      ? '2026-10-15T00:00:00.000Z' : '2026-10-16T01:01:00.000Z' }, Config: { Labels: {
      'com.docker.compose.project': fault === 'wrong-project' ? 'other' : 'dpf', 'com.docker.compose.service': service,
    } } });
  };
  return { runDocker, commands, advance: () => { phase = 'after'; }, fail: f => { fault = f; } };
}
const captureAt = new Date('2026-10-16T01:00:00.000Z');
const finishAt = new Date('2026-10-16T01:02:00.000Z');
describe('canonical promoter retirement observation', () => {
  it('places observations around the actual canonical replacement and skips incomplete refresh', async () => {
    const script = await readFile(new URL('./promote.sh', import.meta.url), 'utf8');
    assert(script.indexOf('--phase capture') < script.indexOf('emit_step docker-up'));
    assert(script.indexOf('--phase finish') > script.indexOf('up -d --no-deps --force-recreate sandbox'));
    assert.match(script, /\$\{_sandbox_ok:-0\} -eq 1[^\n]*-f[^\n]*promoter-epoch-evidence/);
    assert.match(script, /--phase finish \\\n\s*\|\| printf 'step=maintenance-epoch-retirement-unavailable/);
  });
  it('persists a signed checkpoint and final evidence without replacing a checkpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dpf-epoch-test-'));
    try {
      const h = harness();
      const env = { DPF_SELF_UPGRADE_RUN_ID: identity.runId, PROMOTE_TARGET_SHA: identity.targetSha,
        DPF_PROMOTER_DIGEST: identity.promoterDigest, DPF_MAINTENANCE_RECOVERY_POINT_DIGEST: identity.recoveryPointDigest,
        PROMOTE_COMPOSE_PROJECT: identity.project, DPF_PROMOTER_STATE_DIR: directory, PROMOTE_BACKUP_PATH: directory };
      await persistMaintenanceEpoch({ phase: 'capture', env, secret, runDocker: h.runDocker, now: captureAt });
      const checkpoint = await readFile(join(directory, 'maintenance-epoch-checkpoint.json'), 'utf8');
      h.advance();
      await persistMaintenanceEpoch({ phase: 'capture', env, secret, runDocker: h.runDocker, now: finishAt });
      assert.equal(await readFile(join(directory, 'maintenance-epoch-checkpoint.json'), 'utf8'), checkpoint);
      await persistMaintenanceEpoch({ phase: 'finish', env, secret, runDocker: h.runDocker, now: finishAt });
      const saved = JSON.parse(await readFile(join(directory, 'maintenance-epoch-retirement.json'), 'utf8'));
      assert.equal(JSON.parse(saved.payload).runId, identity.runId);
      assert.equal(saved.kind, 'maintenance-epoch-retirement');
      assert(!JSON.stringify(saved).includes('executionSettled'));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('observes both environments using only read-only Docker calls', async () => {
    const h = harness();
    const baseline = await captureMaintenanceEpoch({ ...identity, secret, runDocker: h.runDocker, now: captureAt });
    h.advance();
    const receipt = await finishMaintenanceEpoch({ baseline, secret, expected: identity, runDocker: h.runDocker, now: finishAt });
    const payload = JSON.parse(receipt.payload);
    assert.deepEqual(payload.retiredContainerIds, ['1'.repeat(64), '2'.repeat(64)]);
    assert.equal(payload.after.sandbox.id, '4'.repeat(64));
    assert(h.commands.every(args => ['info', 'ps', 'inspect'].includes(args[0])));
    assert(h.commands.filter(args => args[0] === 'ps').every(args => args.includes('--all') && args.includes('--no-trunc')));
  });
  for (const fault of ['transport', 'daemon-changed', 'old-present', 'wrong-project', 'stopped']) {
    it(`does not produce proof on ${fault}`, async () => {
      const h = harness();
      const baseline = await captureMaintenanceEpoch({ ...identity, secret, runDocker: h.runDocker, now: captureAt });
      h.advance(); h.fail(fault);
      await assert.rejects(finishMaintenanceEpoch({ baseline, secret, expected: identity, runDocker: h.runDocker, now: finishAt }));
    });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { EXIT_SOURCE_DRIFT } from './sandbox-freshness.mjs';

const pin = { worktree: resolve('/feature/worktree'), branch: 'feat/example', sha: 'a'.repeat(40),
  ownerProvider: 'codex', ownerSessionId: 'session', resumeLeaseId: 'NPEL-ABC123',
  taskRunId: 'TR-NONPROD-ABC123', claimKey: 'preview:immutable', mcpUrl: 'https://localhost/api/mcp/v1',
  waitDeadline: '2026-10-14T12:00:00Z' };
const now = () => Date.parse('2026-10-14T11:00:00Z');
const source = () => ({ sha: pin.sha, branch: pin.branch, dirty: false });

test('queued preview registers the existing durable consumer with frozen source and lease identity', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  let registration;
  const result = await resumePreviewQueue(pin, { now, readSource: source, observerDirectory: '/observers',
    env: { DPF_LOCAL_CI_TEST_WORKERS: '2' },
    spawnResumer: args => { registration = args; return { spawned: true, survivesSession: true, pid: 123 }; },
    runChild: () => assert.fail('queued registration must not start a runtime') });
  assert.equal(result.code, 75);
  assert.equal(result.spawned, true);
  assert.deepEqual(registration.pin, { branch: pin.branch, sha: pin.sha, worktree: pin.worktree,
    ownerProvider: pin.ownerProvider, ownerSessionId: pin.ownerSessionId, resumeLeaseId: pin.resumeLeaseId });
  assert.equal(registration.deadlineMs, 60 * 60_000);
  assert.equal(registration.env.DPF_LOCAL_CI_TEST_WORKERS, '2');
  assert.ok(registration.gateArgv.includes(pin.taskRunId));
  assert.ok(registration.gateArgv.includes(pin.claimKey));
});

test('the registered preview consumer reclaims the same lease without forking another consumer', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  let command;
  const result = await resumePreviewQueue(pin, { now, readSource: source, env: { DPF_DURABLE_RESUME: '1' },
    spawnResumer: () => assert.fail('recursive consumer'),
    runChild: args => { command = args; return Promise.resolve(75); } });
  assert.equal(result.code, 75);
  assert.ok(command.args.includes('refresh'));
  assert.equal(command.env.DPF_DEV_PORTAL_RESUME_LEASE_ID, pin.resumeLeaseId);
  assert.equal(command.env.DPF_DEV_PORTAL_TASK_RUN_ID, pin.taskRunId);
  assert.equal(command.env.DPF_DEV_PORTAL_CLAIM_KEY, pin.claimKey);
  assert.equal(command.env.DPF_DEV_PORTAL_EXPECTED_SOURCE_SHA, pin.sha);
  assert.equal(command.env.DPF_DEV_PORTAL_EXPECTED_BRANCH, pin.branch);
});

test('the actual shell refuses same-SHA branch drift and newly dirty source before claiming', async t => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  const worktree = mkdtempSync(join(tmpdir(), 'dpf-preview-queue-race-'));
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'feat/pinned']);
  writeFileSync(join(worktree, 'fixture.txt'), 'fixture');
  git(['add', 'fixture.txt']);
  git(['-c', 'user.name=Preview Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  const sha = git(['rev-parse', 'HEAD']);
  const cliPin = { ...pin, worktree, sha, branch: 'feat/pinned', waitDeadline: new Date(Date.now() + 120_000).toISOString() };
  const cliArgs = Object.entries(cliPin).flatMap(([key, value]) => [`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value]);
  const replay = spawnSync(process.execPath, [fileURLToPath(new URL('../dev-preview-queue-resume.mjs', import.meta.url)),
    ...cliArgs, '--sha', sha, '--branch', 'feat/pinned', '--resume-lease-id', pin.resumeLeaseId],
  { cwd: worktree, env: { ...process.env, DPF_DURABLE_RESUME: '', DPF_DURABLE_RESUMER: 'off' }, encoding: 'utf8' });
  assert.equal(replay.status, 75, replay.stderr);
  assert.equal(JSON.parse(replay.stderr.trim()).reason, 'disabled');
  const deps = { now, env: { ...process.env, DPF_DURABLE_RESUME: '1', DPF_DEV_PORTAL_CURL_BIN: 'missing-preview-test-transport' } };
  const branchDrift = await resumePreviewQueue({ ...pin, worktree, sha, branch: 'feat/original', mcpUrl: 'http://127.0.0.1:1/api/mcp/v1' },
    { ...deps, readSource: () => ({ sha, branch: 'feat/original', dirty: false }) });
  assert.equal(branchDrift.code, EXIT_SOURCE_DRIFT);
  writeFileSync(join(worktree, 'fixture.txt'), 'changed');
  const dirty = await resumePreviewQueue({ ...pin, worktree, sha, branch: 'feat/pinned', mcpUrl: 'http://127.0.0.1:1/api/mcp/v1' },
    { ...deps, readSource: () => ({ sha, branch: 'feat/pinned', dirty: false }) });
  assert.equal(dirty.code, EXIT_SOURCE_DRIFT);
});

test('the actual shell refuses source drift between consumer inspection and its claim', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  const worktree = fileURLToPath(new URL('../../', import.meta.url));
  const sha = '0'.repeat(40);
  const result = await resumePreviewQueue({ ...pin, worktree, sha, mcpUrl: 'http://127.0.0.1:1/api/mcp/v1' }, {
    now, readSource: () => ({ sha, branch: pin.branch, dirty: false }),
    env: { ...process.env, DPF_DURABLE_RESUME: '1', DPF_DEV_PORTAL_CURL_BIN: 'missing-preview-test-transport' },
  });
  assert.equal(result.code, EXIT_SOURCE_DRIFT);
});

test('moved or dirty source stops before reclaiming or starting anything', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  for (const actual of [{ ...source(), sha: 'b'.repeat(40) }, { ...source(), branch: 'feat/other' }, { ...source(), dirty: true }]) {
    const result = await resumePreviewQueue(pin, { now, readSource: () => actual,
      spawnResumer: () => assert.fail('drift must not register'), runChild: () => assert.fail('drift must not reclaim') });
    assert.equal(result.code, EXIT_SOURCE_DRIFT);
  }
});

test('expired waits and an explicitly disabled consumer do not mutate the queued claim', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  const deps = { now, readSource: source, spawnResumer: () => assert.fail('must not register'), runChild: () => assert.fail('must not reclaim') };
  const expired = await resumePreviewQueue({ ...pin, waitDeadline: '2026-10-14T10:59:00Z' }, deps);
  assert.equal(expired.reason, 'wait-deadline');
  const disabled = await resumePreviewQueue(pin, { ...deps, env: { DPF_DURABLE_RESUMER: 'off' } });
  assert.equal(disabled.reason, 'disabled');
});

test('admitted child outcomes are retained and untrusted launcher reasons never escape', async () => {
  const { resumePreviewQueue } = await import('../dev-preview-queue-resume.mjs');
  for (const code of [0, 1]) {
    assert.equal((await resumePreviewQueue(pin, { now, readSource: source, env: { DPF_DURABLE_RESUME: '1' }, runChild: () => code })).code, code);
  }
  const result = await resumePreviewQueue(pin, { now, readSource: source, observerDirectory: '/observers',
    spawnResumer: () => ({ spawned: false, reason: 'secret-must-not-escape' }) });
  assert.equal(result.reason, 'consumer-unavailable');
  assert.ok(!JSON.stringify(result).includes('secret-must-not-escape'));
});

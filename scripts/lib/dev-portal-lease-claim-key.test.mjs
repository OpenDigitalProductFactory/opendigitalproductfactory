// scripts/lib/dev-portal-lease-claim-key.test.mjs
// Node built-in test runner: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const script = readFileSync(
  fileURLToPath(new URL("../dev-portal-lease.sh", import.meta.url)),
  "utf8",
);

const baseClaimKeyLine = script
  .split("\n")
  .find((l) => l.trim().startsWith("base_claim_key="));

// BI-D45898C0. The claim key is the server's idempotency key: environment-lease.ts
// does findUnique({ where: { claimKey } }). Keying it on the PID meant every
// invocation minted a new claim for the same preview, so a restart loop enqueued
// an unbounded set — ~35 waiting, one every ~31s, starving three unrelated
// pre-PR gates behind them.

test("the contributor-preview claim key identifies the resource, not the process", () => {
  assert.ok(baseClaimKeyLine, "base_claim_key assignment must exist");
  assert.match(baseClaimKeyLine, /\$\{WORKTREE_PATH\}/);
  assert.match(baseClaimKeyLine, /\$\{BRANCH\}/);
});

test("the claim key never carries the owner session id — that is what made re-claims unrecognisable", () => {
  assert.doesNotMatch(baseClaimKeyLine, /OWNER_SESSION_ID/);
});

test("the owner session id still travels as ownership, just not as identity of the claim", () => {
  // Attribution is still recorded; it simply must not key the claim.
  assert.match(script, /ownerSessionId/);
  assert.match(script, /resolveAgentIdentity/);
  assert.doesNotMatch(script, /OWNER_SESSION_ID="dev-portal-\$\$"/);
});

test("terminal keys are stopped instead of scanned or replaced", () => {
  assert.doesNotMatch(script, /MAX_TERMINAL_CLAIM_ATTEMPTS|terminal_claim_attempt_sequence|:rerun-/);
  assert.match(script, /terminal lease claim; stop/);
});

import { protectedServiceIdentity, REQUIRED_PREVIEW_DELIVERY_TOOLS, assertToolReadiness, assertPreviewConfig, assertPreviewContainer, previewOverride, runPreviewLifecycle } from './dev-preview-runtime.mjs';
const identity = { worktree: '/feature/worktree', sha: 'a'.repeat(40), leaseId: 'NPEL-MINE' };
const config = () => {
  const result = previewOverride(identity);
  Object.assign(result.services['dev-init'].environment, { CONTRIBUTOR_PREVIEW_PASSWORD: 'only-in-memory',
    DATABASE_URL: 'postgresql://dpf:dpf_dev@dev-postgres:5432/dpf', PRODUCTION_DATABASE_URL: 'postgresql://source@postgres:5432/dpf' });
  result.services["dev-portal"].environment.DATABASE_URL = result.services["dev-init"].environment.DATABASE_URL;
  return result;
};
test('configuration rejects the original root checkout mount and missing prerequisites before mutations', () => {
  assertPreviewConfig(config(), identity);
  const wrong = config(); wrong.services['dev-init'].volumes[0].source = '/root';
  assert.throws(() => assertPreviewConfig(wrong, identity), /mount_mismatch/);
  const missing = config(); delete missing.services['dev-init'].environment.CONTRIBUTOR_PREVIEW_PASSWORD;
  assert.throws(() => assertPreviewConfig(missing, identity), /prerequisites/);
  const production = config(); production.services['dev-portal'].environment.DPF_ENVIRONMENT_CLASS = 'production';
  assert.throws(() => assertPreviewConfig(production, identity), /identity_mismatch/);
});
test('actual Docker mount and source/lease labels must match the admitted preview', () => {
  const actual = { Mounts: [{ Type: 'bind', Source: identity.worktree, Destination: '/workspace' }], Config: { Labels: previewOverride(identity).services['dev-portal'].labels, Env: ["DPF_ENVIRONMENT_CLASS=development", `DPF_PREVIEW_SOURCE_SHA=${identity.sha}`, `DPF_PREVIEW_LEASE_ID=${identity.leaseId}`] } };
  assertPreviewContainer(actual, identity);
  actual.Mounts[0].Source = '/root';
  assert.throws(() => assertPreviewContainer(actual, identity), /actual_mount_mismatch/);
});
test('startup isolates dependencies, waits for clone success, verifies actual binding, then permits serving', async () => {
  const calls = [];
  await runPreviewLifecycle({ compose: async args => calls.push(args), inspect: async () => calls.push('inspect'),
    verifySource: async () => calls.push('source'), stopOwned: async () => calls.push('cleanup'),
    ready: async () => calls.push('ready'), wait: async () => {}, active: { initName: 'unique-init' } });
  assert.deepEqual(calls, ['source', ['stop', 'dev-portal'],
    ['up', '-d', '--no-deps', '--no-recreate', '--no-build', '--wait', 'dev-postgres'],
    ['run', '--rm', '--no-deps', '--name', 'unique-init', 'dev-init'], 'source',
    ['up', '-d', '--no-deps', '--no-build', 'dev-portal'], 'inspect', 'ready', 'cleanup']);
});
test('failed clone never starts or serves a portal', async () => {
  const calls = [];
  await assert.rejects(runPreviewLifecycle({ compose: async args => { calls.push(args); if (args[0] === 'run') throw new Error('OOM'); },
    inspect: async () => assert.fail('must not inspect a served preview'), verifySource: async () => {},
    stopOwned: async () => calls.push('cleanup'), ready: async () => assert.fail('must not serve'),
    wait: async () => {}, active: { initName: 'failed-init' } }), /OOM/);
  assert.equal(calls.some(args => Array.isArray(args) && args[0] === 'up' && args.at(-1) === 'dev-portal'), false);
  assert.equal(calls.at(-1), 'cleanup');
});
test('changed worktree is refused before any runtime mutation', async () => {
  await assert.rejects(runPreviewLifecycle({ verifySource: async () => { throw new Error('source_changed'); },
    compose: async () => assert.fail('runtime mutation'), active: {} }), /source_changed/);
});

test('startup checks the whole shared delivery contract and both permission layers', () => {
  const granted = name => ({ name, serverHasTool: true, tokenGranted: true, agentGranted: true, callableByName: true });
  const rows = REQUIRED_PREVIEW_DELIVERY_TOOLS.map(granted);
  assertToolReadiness({ status: rows });
  assert.ok(REQUIRED_PREVIEW_DELIVERY_TOOLS.includes('review_semantic_change'));
  for (const bad of [{ ...rows[0], agentGranted: false }, { ...rows[0], tokenGranted: false }, { ...rows[0], agentGranted: null }]) {
    assert.throws(() => assertToolReadiness({ count: 100, status: [bad, ...rows.slice(1)] }), /permissions_incomplete/);
  }
  assert.throws(() => assertToolReadiness({ status: [...rows, rows[0]] }), /permissions_incomplete/);
  assert.throws(() => assertToolReadiness({ status: rows.filter(row => row.name !== 'review_semantic_change') }), /permissions_incomplete/);
  assert.throws(() => assertToolReadiness({ loadedToolNames: REQUIRED_PREVIEW_DELIVERY_TOOLS }), /permissions_incomplete/);
});

test('protected live-service identity detects recreation, restart or volume substitution', () => {
  const container = { Id: 'live-db', Config: { Labels: { 'com.docker.compose.service': 'postgres' } }, State: { Running: true, StartedAt: 'before' }, Mounts: [{ Type: 'volume', Name: 'live-data', Destination: '/var/lib/postgresql/data' }] };
  const before = protectedServiceIdentity([container]);
  assert.notDeepEqual(protectedServiceIdentity([{ ...container, Id: 'recreated-db' }]), before);
  assert.notDeepEqual(protectedServiceIdentity([{ ...container, State: { ...container.State, StartedAt: 'after' } }]), before);
  assert.notDeepEqual(protectedServiceIdentity([{ ...container, Mounts: [{ ...container.Mounts[0], Name: 'wrong-data' }] }]), before);
});

test('preserved feature initialization takes the bounded clone from the canonical image', () => {
  const cloneImage = `sha256:${'b'.repeat(64)}`;
  const override = previewOverride({ ...identity, cloneImage });
  assert.equal(override.services['dev-init'].image, cloneImage);
  assert.deepEqual(override.services['dev-init'].entrypoint, ['/bin/sh', '-c']);
  assert.match(override.services['dev-init'].command[0], /cd \/workspace.*migrate-deploy.*cd \/app.*sanitized-clone/);
  assert.equal(override.services['dev-init'].volumes[0].source, identity.worktree);
  assert.equal(override.services['dev-portal'].volumes[0].source, identity.worktree);
});

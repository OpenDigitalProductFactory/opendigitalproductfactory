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


describe('scope writer actuator observations', () => {
  it('keeps unknown or malformed probe failures distinct from positive legacy absence', async () => {
    const { classifyInitialScopeEpochFallback } = await import('./promoter-epoch-evidence.mjs');
    const image = 'sha256:' + 'a'.repeat(64);
    const runner = absent => async args => {
      if (args[0] === 'image') return image;
      if (args.includes('--eval')) { if (!absent) throw new Error('contract present or unavailable'); return 'legacy-scope-epoch-absent'; }
      if (args[0] === 'rm') return '';
      return '{}';
    };
    await assert.rejects(classifyInitialScopeEpochFallback({ image, runDocker: runner(false) }), /scope_writer_fallback_unproven/);
    assert.deepEqual(await classifyInitialScopeEpochFallback({ image, runDocker: runner(true) }), { kind: 'initial-legacy', image });
  });
});


import { inspectScopeEpochWriters } from "../apps/web/lib/work-capsules/scope-epoch-writer-probe.mjs";
import * as scopeWriterContract from "../apps/web/lib/work-capsules/scope-epoch-contract.ts";
const scopeProbeFixture = () => ({ root: "/packaged", loadContract: async () => scopeWriterContract,
  readFile: async path => Buffer.from(path.endsWith(".dpf-image-version") ? "a".repeat(40)
    : path.endsWith(".dpf-source-content-hash") ? "b".repeat(64) : `packaged source ${path}`) });
it("reports every declared writer's bytes independently of reassessment owners", async () => {
  const proof = await inspectScopeEpochWriters(scopeProbeFixture());
  assert.equal(proof.version, 1); assert.equal(proof.sourceSha, "a".repeat(40));
  assert.deepEqual(Object.keys(proof.writers), [...scopeWriterContract.SCOPE_EPOCH_WRITER_PATHS]);
  assert.ok(Object.values(proof.writers).every(hash => /^[a-f0-9]{64}$/.test(hash)));
  assert.equal(proof.owners, undefined);
});
it("a missing packaged writer is unknown, never a partial compatible report", async () => {
  const f = scopeProbeFixture(), read = f.readFile;
  f.readFile = async path => { if (path.endsWith("scope-release-preflight.ts")) throw new Error("missing"); return read(path); };
  await assert.rejects(inspectScopeEpochWriters(f), /scope_writer_probe_evidence_unavailable/);
});
it("rejects malformed source identity", async () => {
  const f = scopeProbeFixture(), read = f.readFile;
  f.readFile = async path => path.endsWith(".dpf-image-version") ? Buffer.from("unknown") : read(path);
  await assert.rejects(inspectScopeEpochWriters(f), /scope_writer_probe_identity_invalid/);
});

it("canonical shell candidate check refuses incompatible portal bytes independently", async () => {
  const { readFile } = await import("node:fs/promises"), { spawnSync } = await import("node:child_process");
  const source = await readFile(new URL("./promote.sh", import.meta.url), "utf8");
  const start = source.indexOf("# scope-writer-compatibility-begin"), end = source.indexOf("# scope-writer-compatibility-end");
  assert.ok(start >= 0 && end > start, "the actual promoter must contain its separate scope writer check");
  const block = source.slice(start, end);
  const proof = await inspectScopeEpochWriters(scopeProbeFixture());
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join, delimiter } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "dpf-scope-shell-"));
  await writeFile(join(dir, "docker"), `#!/bin/sh
case "$1" in image) printf '%s\\n' 'sha256:${"c".repeat(64)}';; run) printf '%s' "$SCOPE_REPORT";; rm) exit 0;; *) exit 77;; esac
`, { mode: 0o700 });
  const { fileURLToPath } = await import("node:url");
  const scripts = fileURLToPath(new URL(".", import.meta.url));
  const shell = `_promoter_dir='${scripts.replaceAll("'", "'\\''")}'\n${block}\n_assert_scope_writer_image 'sha256:${"c".repeat(64)}' '${proof.sourceSha}'`;
  try {
  for (const [label, report, expected] of [["compatible", proof, 0], ["old", { ...proof, version: 0 }, 78],
    ["wrong source", { ...proof, sourceSha: "d".repeat(40) }, 78]]) {
    const result = spawnSync("bash", ["-c", shell], { encoding: "utf8", timeout: 5000,
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, SCOPE_REPORT: JSON.stringify(report) } });
    assert.equal(result.status, expected, `${label}: ${result.stderr}`);
  }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

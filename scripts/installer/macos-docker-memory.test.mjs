import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convergeMemory, targetMemory } from './macos-docker-memory.mjs';

function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dpf-memory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, 'settings-store.json');
  writeFileSync(settingsPath, JSON.stringify({ MemoryMiB: 70144, unrelated: 'keep' }));
  const calls = [];
  let live = 70144;
  const options = {
    platform: 'darwin', hostMiB: 131072, settingsPath, adminPath: join(dir, 'admin.json'),
    env: {}, allowRestart: true, sleep: async () => {}, localSockets: ['unix:///Users/test/.docker/run/docker.sock'],
    run(args) {
      calls.push(args.join(' '));
      if (args[0] === 'context') return JSON.stringify([{ Endpoints: { docker: { Host: 'unix:///Users/test/.docker/run/docker.sock' } } }]);
      if (args[0] === 'info') return JSON.stringify({ OperatingSystem: 'Docker Desktop', MemTotal: live * 1048576 });
      if (args[0] === 'ps') return 'abc123\ndef456\n';
      if (args.join(' ') === 'desktop start') live = JSON.parse(readFileSync(settingsPath)).MemoryMiB * 0.98;
      return '';
    }, ...overrides,
  };
  return { options, calls, settingsPath, dir };
}

test('host policy leaves RAM for native applications and caps large Macs', () => {
  for (const [host, target] of [[16,8],[24,8],[32,8],[64,16],[128,32],[256,32]]) {
    assert.equal(targetMemory(host * 1024), target * 1024);
  }
  for (const host of [0, NaN, 8192]) assert.throws(() => targetMemory(host));
});

test('128GiB incident converges, preserves settings, restores all containers, then no-ops', async t => {
  const f = fixture(t);
  const result = await convergeMemory(f.options);
  assert.equal(result.state, 'changed');
  assert.equal(JSON.parse(readFileSync(f.settingsPath)).MemoryMiB, 32768);
  assert.equal(JSON.parse(readFileSync(f.settingsPath)).unrelated, 'keep');
  assert.equal(JSON.parse(readFileSync(result.backupPath)).MemoryMiB, 70144);
  assert.ok(f.calls.includes('start abc123 def456'));
  f.calls.length = 0;
  assert.equal((await convergeMemory(f.options)).state, 'converged');
  assert.ok(!f.calls.some(x => x.startsWith('desktop')));
});

test('running workloads require consent before any stop or write', async t => {
  const f = fixture(t, { allowRestart: false });
  await assert.rejects(convergeMemory(f.options), e => e.code === 'CONSENT_REQUIRED');
  assert.equal(JSON.parse(readFileSync(f.settingsPath)).MemoryMiB, 70144);
  assert.ok(!f.calls.some(x => x.startsWith('desktop')));
});

test('dry run does not mutate or restart', async t => {
  const f = fixture(t, { dryRun: true, allowRestart: false });
  assert.equal((await convergeMemory(f.options)).state, 'planned');
  assert.equal(JSON.parse(readFileSync(f.settingsPath)).MemoryMiB, 70144);
  assert.ok(!f.calls.some(x => x.startsWith('desktop')));
});

test('Linux and remote Docker endpoints do not touch settings or lifecycle', async t => {
  for (const overrides of [{ platform: 'linux' }, { env: { DOCKER_HOST: 'ssh://server' } }, { env: { DOCKER_CONTEXT: 'remote' }, run: () => JSON.stringify([{ Endpoints: { docker: { Host: 'tcp://server:2376' } } }]) }]) {
    const f = fixture(t, overrides);
    assert.equal((await convergeMemory(f.options)).state, 'skipped');
    assert.equal(JSON.parse(readFileSync(f.settingsPath)).MemoryMiB, 70144);
  }
});

test('invalid, missing, symlinked and managed settings fail before stop', async t => {
  for (const variant of ['invalid', 'missing', 'symlink', 'managed']) {
    const f = fixture(t);
    if (variant === 'invalid') writeFileSync(f.settingsPath, '{');
    if (variant === 'missing') rmSync(f.settingsPath);
    if (variant === 'symlink') { rmSync(f.settingsPath); symlinkSync(join(f.dir, 'other'), f.settingsPath); }
    if (variant === 'managed') writeFileSync(f.options.adminPath, '{}');
    await assert.rejects(convergeMemory(f.options));
    assert.ok(!f.calls.some(x => x.startsWith('desktop')));
  }
});

test('stop failure leaves settings intact', async t => {
  const f = fixture(t);
  const run = f.options.run;
  f.options.run = args => { if (args.join(' ') === 'desktop stop --timeout 45') throw new Error('stop failed'); return run(args); };
  await assert.rejects(convergeMemory(f.options), /stop failed/);
  assert.equal(JSON.parse(readFileSync(f.settingsPath)).MemoryMiB, 70144);
});

test('pending saved allocation still needs a restart; valid smaller setting is preserved', async t => {
  const f = fixture(t);
  writeFileSync(f.settingsPath, JSON.stringify({ MemoryMiB: 16384 }));
  assert.equal((await convergeMemory(f.options)).state, 'changed');
  assert.equal(JSON.parse(readFileSync(f.settingsPath)).MemoryMiB, 16384);
});

test('start/readback failure returns recovery evidence and never success', async t => {
  const f = fixture(t);
  const run = f.options.run;
  f.options.run = args => { if (args.join(' ') === 'desktop start') throw new Error('start failed'); return run(args); };
  await assert.rejects(convergeMemory(f.options), e => /start failed/.test(e.message) && e.message.includes('backup:'));
});

test('empty fresh setup converges automatically; enabled model work still requires consent', async t => {
  for (const enabled of [false, true]) {
    const f = fixture(t, { allowRestart: false });
    writeFileSync(f.settingsPath, JSON.stringify({ MemoryMiB: 2048, EnableDockerAI: enabled }));
    const run = f.options.run;
    f.options.run = args => args[0] === 'ps' ? '' : run(args);
    if (enabled) await assert.rejects(convergeMemory(f.options), e => e.code === 'CONSENT_REQUIRED');
    else assert.equal((await convergeMemory(f.options)).desired, 32768);
  }
});

test('non-Desktop and unrelated local engines are skipped', async t => {
  for (const variant of ['engine', 'socket']) {
    const f = fixture(t);
    const run = f.options.run;
    f.options.run = args => {
      if (variant === 'engine' && args[0] === 'info') return JSON.stringify({ OperatingSystem: 'Ubuntu' });
      if (variant === 'socket' && args[0] === 'context') return JSON.stringify([{ Endpoints: { docker: { Host: 'unix:///tmp/other.sock' } } }]);
      return run(args);
    };
    assert.equal((await convergeMemory(f.options)).state, 'skipped');
    assert.ok(!f.calls.some(x => x.startsWith('desktop')));
  }
});

test('bad memory values fail before shutdown', async t => {
  for (const memory of [null, '32768', -1, 0, 3.5]) {
    const f = fixture(t);
    writeFileSync(f.settingsPath, JSON.stringify({ MemoryMiB: memory }));
    await assert.rejects(convergeMemory(f.options));
    assert.ok(!f.calls.some(x => x.startsWith('desktop')));
  }
});

test('post-stop settings failure attempts recovery without claiming convergence', async t => {
  const f = fixture(t);
  const run = f.options.run;
  f.options.run = args => {
    if (args.join(' ') === 'desktop stop --timeout 45') writeFileSync(f.settingsPath, '{');
    if (args.join(' ') === 'desktop start') { f.calls.push('recovery start'); return ''; }
    return run(args);
  };
  await assert.rejects(convergeMemory(f.options), /Docker restart requested; backup: not created/);
  assert.ok(f.calls.includes('recovery start'));
});

test('live mismatch and missing restored containers fail with backup evidence', async t => {
  for (const variant of ['memory', 'containers']) {
    const f = fixture(t);
    const run = f.options.run;
    let started = false;
    f.options.run = args => {
      const output = run(args);
      if (args.join(' ') === 'desktop start') started = true;
      if (started && variant === 'memory' && args[0] === 'info') return JSON.stringify({ OperatingSystem: 'Docker Desktop', MemTotal: 70000 * 1048576 });
      if (started && variant === 'containers' && args[0] === 'ps') return '';
      return output;
    };
    await assert.rejects(convergeMemory(f.options), /backup:/);
  }
});

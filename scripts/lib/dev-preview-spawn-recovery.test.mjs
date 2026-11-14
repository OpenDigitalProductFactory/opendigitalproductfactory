import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { terminateOwnedPreview } from './dev-preview-runtime.mjs';

const runtimeUrl = new URL('./dev-preview-runtime.mjs', import.meta.url).href;

// Real Node children exercise EventEmitter's fatal unhandled-error behavior.
// Only spawn is replaced inside each child; no Docker or host limit is touched.
for (const fault of [
  { code: 'ENFILE', stdout: false, stderr: false },
  { code: 'EMFILE', stdout: false, stderr: true },
  { code: 'EAGAIN', stdout: true, stderr: false },
  { code: 'ENFILE', synchronous: true },
]) {
  test(`preview spawn ${fault.code} (${fault.synchronous ? 'throw' : 'missing stdio'}) is a controlled failure`, () => {
    const program = `
      import assert from 'node:assert/strict';
      import { createRequire, syncBuiltinESMExports } from 'node:module';
      import { EventEmitter } from 'node:events';
      import { PassThrough } from 'node:stream';
      const require = createRequire(import.meta.url);
      const cp = require('node:child_process');
      const fault = ${JSON.stringify(fault)};
      const privateText = 'fixture-private-spawn-detail';
      let calls = 0;
      cp.spawn = () => {
        calls += 1;
        const error = Object.assign(new Error(privateText), { code: fault.code });
        if (fault.synchronous) throw error;
        const child = new EventEmitter();
        child.stdout = fault.stdout ? new PassThrough() : null;
        child.stderr = fault.stderr ? new PassThrough() : null;
        child.kill = () => assert.fail('a child that never spawned is not a kill target');
        process.nextTick(() => {
          child.emit('error', error);
          child.emit('close', -1);
        });
        return child;
      };
      syncBuiltinESMExports();
      const { commandRunner } = await import(${JSON.stringify(runtimeUrl)});
      const runner = commandRunner();
      let failure;
      try { await runner.run(['info', '--format', privateText]); }
      catch (error) { failure = error; }
      assert.equal(calls, 1);
      assert.equal(failure?.message, 'preview_process_unavailable');
      assert.equal(failure?.code, fault.code);
      assert.ok(!String(failure).includes(privateText));
      runner.terminate();
      await new Promise(resolve => setImmediate(resolve));
      console.log('controlled-spawn-failure');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, `child must survive the injected failure:\n${result.stderr}`);
    assert.match(result.stdout, /controlled-spawn-failure/);
    assert.ok(!result.stderr.includes('fixture-private-spawn-detail'));
  });
}

for (const childOutcome of ['throw', 'unverified']) {
  test(`owned container cleanup is attempted when child termination is ${childOutcome}`, async () => {
    const calls = [];
    await assert.rejects(terminateOwnedPreview({
      runner: { terminate: async () => {
        calls.push('child');
        if (childOutcome === 'throw') throw new Error('fixture-private-error');
        return false;
      } },
      stopOwned: async () => { calls.push('containers'); },
      finish: () => { calls.push('finished'); },
    }), { message: 'preview_owned_fence_unverified' });
    assert.deepEqual(calls, ['child', 'containers', 'finished']);
  });
}

test('failed owned container cleanup remains unverified and releases the local waiter', async () => {
  let finished = false;
  await assert.rejects(terminateOwnedPreview({
    runner: { terminate: async () => true },
    stopOwned: async () => { throw new Error('fixture-private-container-error'); },
    finish: () => { finished = true; },
  }), { message: 'preview_owned_fence_unverified' });
  assert.equal(finished, true);
});

test('termination confirms close of the actual owned child handle', () => {
  const program = `
    import assert from 'node:assert/strict';
    import { createRequire, syncBuiltinESMExports } from 'node:module';
    import { once } from 'node:events';
    const cp = createRequire(import.meta.url)('node:child_process');
    const original = cp.spawn; let child;
    cp.spawn = (...args) => { child = original(...args); return child; };
    syncBuiltinESMExports();
    const { commandRunner } = await import(${JSON.stringify(runtimeUrl)});
    const runner = commandRunner();
    const outcome = runner.run(['-e', 'setInterval(() => {}, 1000)'], { bin: process.execPath })
      .then(() => 'unexpected-success', error => error.message);
    await once(child, 'spawn');
    assert.equal(await runner.terminate(), true);
    assert.equal(child.signalCode, 'SIGKILL');
    assert.equal(await outcome, 'preview_operation_failed:terminated');
    assert.equal(await runner.terminate(), true);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});

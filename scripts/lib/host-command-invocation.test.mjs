import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { resolveHostCommandInvocation } from './host-command-invocation.mjs';

function installation(t, entry = 'node_modules/pnpm/bin/pnpm.cjs') {
  const root = mkdtempSync(join(tmpdir(), 'dpf pnpm & literal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, entry);
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  writeFileSync(join(root, 'pnpm.cmd'), '@echo off\r\n');
  return { root, script, env: { Path: root } };
}

for (const entry of ['node_modules/pnpm/bin/pnpm.cjs', 'node_modules/corepack/dist/pnpm.js', 'pnpm.cjs']) {
  test(`Windows launches ${entry} with literal argv`, t => {
    const { script, env } = installation(t, entry);
    const args = ['exec', 'space here', '%PATH%', '!NAME!', 'a&b|c<>d^e', '" & echo injected', '', 'trailing\\'];
    const invocation = resolveHostCommandInvocation('pnpm', args, { platform: 'win32', env });
    assert.deepEqual(invocation, { command: process.execPath, args: [script, ...args] });
    const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', shell: false });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  });
}

test('Windows honors the resolved absolute host pnpm rather than searching PATH again', t => {
  const { root, script } = installation(t);
  assert.deepEqual(resolveHostCommandInvocation(join(root, 'pnpm.cmd'), ['--version'], {
    platform: 'win32', env: { PATH: 'unrelated' },
  }), { command: process.execPath, args: [script, '--version'] });
});

for (const [entry, shimDirectory] of [['node_modules/pnpm/bin/pnpm.cjs', 'bin'], ['dist/pnpm.js', 'shims']]) {
  test(`Windows resolves the managed ${shimDirectory} shim layout`, t => {
    const { root, script } = installation(t, entry);
    const bin = join(root, shimDirectory);
    mkdirSync(bin);
    writeFileSync(join(bin, 'pnpm.cmd'), 'fixture');
    assert.deepEqual(resolveHostCommandInvocation('pnpm', ['--version'], {
      platform: 'win32', env: { PATH: bin },
    }), { command: process.execPath, args: [script, '--version'] });
  });
}

test('missing or unsupported Windows pnpm installations never fall back to a shell', t => {
  const { root } = installation(t, 'unrelated.cjs');
  assert.throws(() => resolveHostCommandInvocation('pnpm', [], { platform: 'win32', env: { PATH: root } }), /pnpm.*entrypoint/i);
  assert.throws(() => resolveHostCommandInvocation('pnpm', [], { platform: 'win32', env: { PATH: '' } }), /pnpm.*PATH/i);
});

test('native Windows pnpm executables retain argument boundaries', t => {
  const { root } = installation(t);
  const executable = join(root, 'pnpm.exe');
  writeFileSync(executable, 'fixture');
  assert.deepEqual(resolveHostCommandInvocation('pnpm', ['%PATH%'], {
    platform: 'win32', env: { PATH: root },
  }), { command: executable, args: ['%PATH%'] });
});

test('Windows lookup inherits an absent PATH and preserves an explicitly empty PATH', t => {
  const { root, script } = installation(t);
  const originalPath = process.env.PATH;
  t.after(() => { process.env.PATH = originalPath; });
  process.env.PATH = root;
  assert.deepEqual(resolveHostCommandInvocation('pnpm', ['--version'], {
    platform: 'win32', env: {},
  }), { command: process.execPath, args: [script, '--version'] });
  assert.throws(() => resolveHostCommandInvocation('pnpm', [], {
    platform: 'win32', env: { Path: root, PATH: '' },
  }), /pnpm.*PATH/i);
});

test('POSIX and other Windows executables retain their executable and arguments', () => {
  for (const [platform, command] of [['linux', 'pnpm'], ['darwin', 'pnpm'], ['win32', 'git'], ['win32', process.execPath]]) {
    const args = ['space here', 'a&b', '%PATH%'];
    assert.deepEqual(resolveHostCommandInvocation(command, args, { platform, env: {} }), { command, args });
  }
});

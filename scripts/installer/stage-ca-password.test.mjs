import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm, open, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagingScript, stageCaPassword } from './stage-ca-password.mjs';

test('password validation and reading retain the opened file when its name is replaced', async () => {
  const { readCaPassword } = await import('./stage-ca-password.mjs');
  const root = await mkdtemp(join(tmpdir(), 'dpf-ca-race-'));
  try {
    const file = join(root, 'password');
    await writeFile(file, 'original-private-value', { mode: 0o600 });
    const reading = readCaPassword(file, async (...args) => {
      const handle = await open(...args);
      await rename(file, join(root, 'original'));
      await writeFile(file, 'replacement-value', { mode: 0o600 });
      return handle;
    });
    if (process.platform === 'win32') await assert.rejects(reading, /ca_password_file_changed/);
    else assert.equal(await reading, 'original-private-value');
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function inspectFile(path) {
  const handle = await open(path, 'r');
  try { return { content: await handle.readFile('utf8'), mode: (await handle.stat()).mode & 0o777 }; }
  finally { await handle.close(); }
}

test('password loader refuses symlinks and non-private files', { skip: process.platform === 'win32' }, async () => {
  const { readCaPassword } = await import('./stage-ca-password.mjs');
  const root = await mkdtemp(join(tmpdir(), 'dpf-ca-private-'));
  try {
    const file = join(root, 'password');
    await writeFile(file, 'private-value', { mode: 0o644 });
    await assert.rejects(readCaPassword(file), /ca_password_file_not_private/);
    await symlink(file, join(root, 'link'));
    await assert.rejects(readCaPassword(join(root, 'link')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CA custody is private, idempotent, refuses mismatch and hides upstream output', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dpf-ca-stage-'));
  try {
    const entry = join(root, 'entrypoint');
    await writeFile(entry, '#!/bin/sh\nmkdir -p "$STEPPATH/config"\necho initialized > "$STEPPATH/config/ca.json"\necho upstream-private-output\n', { mode: 0o700 });
    const run = input => spawnSync('sh', ['-c', stagingScript, 'dpf-stage', entry], { input, encoding: 'utf8', env: { ...process.env, STEPPATH: root } });
    const secret = 'a'.repeat(64) + '\n';
    const first = run(secret); assert.equal(first.status, 0, first.stderr); assert.equal(first.stdout, '');
    const target = join(root, 'secrets/password');
    assert.deepEqual(await inspectFile(target), { content: secret, mode: 0o600 });
    assert.equal(run(secret).status, 0);
    await writeFile(target, secret.trim()); // Windows previously wrote no newline.
    assert.equal(run(secret).status, 0);
    assert.equal((await inspectFile(target)).content, secret.trim());
    await writeFile(target, secret);
    assert.notEqual(run('b'.repeat(64) + '\n').status, 0);
    assert.equal((await inspectFile(target)).content, secret);
    await mkdir(join(root, 'secrets/.dpf-password-stage.lock'));
    assert.notEqual(run(secret).status, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('password travels only through stdin; failed Docker output is never disclosed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dpf-ca-input-'));
  try {
    const file = join(root, 'password'); const secret = ' operator-provisioned private value ';
    await writeFile(file, secret, { mode: 0o600 });
    const calls = [];
    await stageCaPassword(file, ['-f', 'compose.yml'], (command, args, options) => {
      calls.push({ command, args, options }); return { status: 0 };
    });
    assert.equal(calls[0].options.input.toString(), secret + '\n');
    assert.ok(!calls[0].args.join(' ').includes(secret));
    assert.equal(calls[0].command, 'docker');
    await assert.rejects(stageCaPassword(file, [], () => ({ status: 1, stderr: secret })), error => !error.message.includes(secret) && /ca_password_staging_failed/.test(error.message));
  } finally { await rm(root, { recursive: true, force: true }); }
});

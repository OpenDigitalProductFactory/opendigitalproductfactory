import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagingScript, stageCaPassword } from './stage-ca-password.mjs';

test('CA custody is private, idempotent, refuses mismatch and hides upstream output', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dpf-ca-stage-'));
  try {
    const entry = join(root, 'entrypoint');
    await writeFile(entry, '#!/bin/sh\nmkdir -p "$STEPPATH/config"\necho initialized > "$STEPPATH/config/ca.json"\necho upstream-private-output\n', { mode: 0o700 });
    const run = input => spawnSync('sh', ['-c', stagingScript, 'dpf-stage', entry], { input, encoding: 'utf8', env: { ...process.env, STEPPATH: root } });
    const secret = 'a'.repeat(64) + '\n';
    const first = run(secret); assert.equal(first.status, 0, first.stderr); assert.equal(first.stdout, '');
    const target = join(root, 'secrets/password');
    assert.equal(await readFile(target, 'utf8'), secret);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    assert.equal(run(secret).status, 0);
    await writeFile(target, secret.trim()); // Windows previously wrote no newline.
    assert.equal(run(secret).status, 0);
    assert.equal(await readFile(target, 'utf8'), secret.trim());
    await writeFile(target, secret);
    assert.notEqual(run('b'.repeat(64) + '\n').status, 0);
    assert.equal(await readFile(target, 'utf8'), secret);
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

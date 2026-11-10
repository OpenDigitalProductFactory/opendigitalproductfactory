import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareRuntimeState, runtimeMounts } from './prepare-runtime-state.mjs';

test('pre-existing wrong ownership is refused without changing the directory', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const before = await stat('/');
  await assert.rejects(prepareRuntimeState({ state: '/', federation: '/unused' }), /runtime_directory_wrong_owner/);
  const after = await stat('/');
  assert.equal(after.uid, before.uid); assert.equal(after.mode, before.mode);
});

test('failed Compose config stops the CLI without printing expanded secrets', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dpf-compose-refusal-'));
  try {
    await writeFile(join(root, 'docker'), '#!/bin/sh\necho private-expanded-value >&2\nexit 1\n', { mode: 0o700 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./prepare-runtime-state.mjs', import.meta.url))], { encoding: 'utf8', env: { ...process.env, PATH: root + ':/usr/bin:/bin' } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /runtime_compose_resolution_failed/);
    assert.ok(!result.stderr.includes('private-expanded-value'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('both installers prepare state before PKI and ship the canonical initializer', async () => {
  for (const file of ['install-dpf.sh', 'install-dpf.ps1']) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.ok(source.indexOf('prepare-runtime-state.mjs') < source.indexOf('bootstrap-organization-pki.'));
    assert.match(source, /prepare-runtime-state\.mjs/);
  }
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
  for (const file of ['prepare-runtime-state.mjs', 'stage-ca-password.mjs', 'rotate-runtime-transition-secret.mjs']) {
    assert.match(dockerfile, new RegExp(`COPY[^\\n]*${file.replaceAll('.', '\\.')}`));
    assert.match(dockerfile, new RegExp(`cp[^\\n]*${file.replaceAll('.', '\\.')}`));
  }
});

test('Compose mount resolution uses rendered custom paths and rejects missing mounts', () => {
  const config = { services: { portal: { volumes: [
    { type: 'bind', source: '/custom state', target: '/dpf-state' },
    { type: 'bind', source: '/custom federation', target: '/dpf-federation' },
  ] } } };
  assert.deepEqual(runtimeMounts(config), { state: '/custom state', federation: '/custom federation' });
  assert.throws(() => runtimeMounts({ services: {} }), /runtime_bind_missing/);
  config.services.portal.volumes[0].type = 'volume';
  assert.throws(() => runtimeMounts(config), /runtime_bind_missing/);
});

test('fresh custom state is private, host-owned, and reruns preserve key bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dpf-state-prep-'));
  try {
    const paths = { state: join(root, 'state with spaces'), federation: join(root, 'federation') };
    await prepareRuntimeState(paths);
    const key = await readFile(join(paths.state, 'runtime-transition.secret'), 'utf8');
    assert.match(key.trim(), /^[a-f0-9]{64}$/);
    await prepareRuntimeState(paths);
    assert.equal(await readFile(join(paths.state, 'runtime-transition.secret'), 'utf8'), key);
    if (process.platform !== 'win32') {
      for (const dir of [paths.state, paths.federation, join(paths.federation, 'pki')]) {
        const s = await stat(dir); assert.equal(s.uid, process.getuid()); assert.equal(s.mode & 0o777, 0o700);
      }
      assert.equal((await stat(join(paths.state, 'runtime-transition.secret'))).mode & 0o777, 0o600);
    }
    await writeFile(join(paths.state, 'runtime-transition-authority.json'), '{}');
    await assert.rejects(prepareRuntimeState(paths), /transition_in_progress/);
    assert.equal(await readFile(join(paths.state, 'runtime-transition.secret'), 'utf8'), key);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('malformed existing keys and symlinked state fail without changing material', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dpf-state-refusal-'));
  try {
    const paths = { state: join(root, 'state'), federation: join(root, 'federation') };
    await mkdir(paths.state);
    await writeFile(join(paths.state, 'runtime-transition.secret'), 'invalid-private-material');
    await assert.rejects(prepareRuntimeState(paths), /invalid_existing_transition_secret/);
    assert.equal(await readFile(join(paths.state, 'runtime-transition.secret'), 'utf8'), 'invalid-private-material');
    if (process.platform !== 'win32') {
      await symlink(paths.state, join(root, 'link'));
      await assert.rejects(prepareRuntimeState({ ...paths, state: join(root, 'link') }), /runtime_directory_unsafe/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

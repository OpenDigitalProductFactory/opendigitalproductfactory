import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyRuntimePackage } from './runtime-profile.mjs';
import { runtimeInstallationFixture as fixture } from './runtime-test-fixtures.mjs';
import * as installation from './runtime-installation.mjs';

test('managed staging publishes verified private versioned storage without selecting a live runtime', async t => {
  const f = await fixture(t); const result = await installation.stageRuntimeInstallation(f);
  assert.equal(result.status, 'staged'); assert.equal(result.activationAuthorized, false);
  assert.equal((await verifyRuntimePackage(result.packageRoot)).manifestSha256, f.binding.runtimeManifestSha256);
  assert.deepEqual(await readFile(join(result.releaseRoot, 'qualification.json')), f.reportBytes);
  assert.equal((await readdir(f.stateDirectory)).includes('active.json'), false);
  const again = await installation.stageRuntimeInstallation(f);
  assert.equal(again.releaseRoot, result.releaseRoot); assert.equal(again.reused, true);
});

test('a staged qualification is bound to the enrolled physical host, never silently adopted on another Mac', async t => {
  const f = await fixture(t);
  await assert.rejects(installation.stageRuntimeInstallation({ ...f, hostNodeId: undefined }), /host/);
  const staged = await installation.stageRuntimeInstallation(f);
  const record = JSON.parse(await readFile(join(staged.releaseRoot, 'release.json'), 'utf8'));
  assert.equal(record.hostNodeId, f.hostNodeId);
  assert.equal(record.physicalDevice, f.physicalDevice);
  await assert.rejects(installation.readStagedRuntimeDescriptor({ ...f, hostNodeId: 'another-Mac' }), /host/);
});

test('staging rejects changed evidence before publishing and never overwrites a damaged release', async t => {
  const f = await fixture(t);
  await assert.rejects(installation.stageRuntimeInstallation({ ...f, binding: { ...f.binding, profileSha256: '0'.repeat(64) } }), /profile/);
  await assert.rejects(installation.stageRuntimeInstallation({ ...f, reportBytes: Buffer.from('{}') }), /report/);
  await assert.rejects(installation.stageRuntimeInstallation({ ...f, binding: { ...f.binding, baselineEngineSha256: 'c'.repeat(64) } }), /baseline/);
  const staged = await installation.stageRuntimeInstallation(f);
  await writeFile(join(staged.packageRoot, 'bin/dmr'), 'corrupted');
  await assert.rejects(installation.stageRuntimeInstallation(f), /changed/);
  assert.equal(await readFile(join(staged.packageRoot, 'bin/dmr'), 'utf8'), 'corrupted');
});

test('staging refuses symlinked private storage and contended runtime ownership without reclaiming either', async t => {
  const f = await fixture(t); const foreign = join(f.root, 'foreign'); await mkdir(foreign, { mode: 0o700 });
  await symlink(foreign, join(f.stateDirectory, 'mac-inference'));
  await assert.rejects(installation.stageRuntimeInstallation(f), /directory|symlink/);
  assert.deepEqual(await readdir(foreign), []);
  await rm(join(f.stateDirectory, 'mac-inference'));
  await mkdir(join(f.stateDirectory, '.runtime-transition-apply.lock'), { mode: 0o700 });
  await assert.rejects(installation.stageRuntimeInstallation(f), /contended/);
  assert.ok((await readdir(f.stateDirectory)).includes('.runtime-transition-apply.lock'));
});

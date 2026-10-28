import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE_LOCK, enumerateFiles, fileRecord, sha256 } from './package.mjs';
import { RUNTIME_LOCK, verifyRuntimePackage } from './runtime-profile.mjs';
import * as installation from './runtime-installation.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-managed-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePackage = join(root, 'source');
  const engine = join(sourcePackage, 'engine');
  await mkdir(join(engine, 'bin'), { recursive: true });
  const payload = Buffer.from('cffaedfe0c00000166697874757265', 'hex');
  for (const path of ['bin/llama-server', 'bin/llama-bench', ...ENGINE_LOCK.requiredRuntimeLibraries]) {
    await writeFile(join(engine, path), payload, { mode: 0o700 });
  }
  await writeFile(join(engine, 'LICENSE'), 'fixture');
  const engineManifest = { schemaVersion: 1, packageName: 'dpf-llama-macos-arm64', version: ENGINE_LOCK.packageVersion,
    source: ENGINE_LOCK.source, patchSha256: ENGINE_LOCK.patchSha256, qualification: { status: 'unqualified' },
    build: { os: 'darwin', architecture: 'arm64', sdk: '15.4', minimumMacOS: '13.3', compiler: 'fixture', flags: ['-DGGML_NATIVE=OFF'] }, files: [] };
  for (const path of await enumerateFiles(engine)) engineManifest.files.push(await fileRecord(engine, path));
  const engineBytes = JSON.stringify(engineManifest);
  await writeFile(join(engine, 'manifest.json'), engineBytes);
  await mkdir(join(sourcePackage, 'bin')); await writeFile(join(sourcePackage, 'bin/dmr'), payload, { mode: 0o700 });
  await mkdir(join(sourcePackage, 'licenses/Go'), { recursive: true });
  await writeFile(join(sourcePackage, 'LICENSE'), 'fixture');
  await writeFile(join(sourcePackage, 'licenses/Go/LICENSE'), 'fixture');
  const manifest = { schemaVersion: 1, packageName: 'dpf-model-runner-macos-arm64', version: RUNTIME_LOCK.packageVersion,
    source: RUNTIME_LOCK.source, patchSha256: RUNTIME_LOCK.patchSha256, qualification: { status: 'unqualified' },
    build: { os: 'darwin', architecture: 'arm64', compiler: 'go1.26.5', cgo: false, flags: ['-mod=readonly', '-trimpath'] },
    engine: { manifestSha256: sha256(engineBytes) }, files: [] };
  for (const path of await enumerateFiles(sourcePackage)) manifest.files.push(await fileRecord(sourcePackage, path));
  await writeFile(join(sourcePackage, 'runtime-manifest.json'), JSON.stringify(manifest));
  const runtime = await verifyRuntimePackage(sourcePackage);
  const physicalDevice = RUNTIME_LOCK.initialQualifiedDevice;
  const models = ['chat:Q4', 'embed:latest'].map((model, i) => ({ model, digest: 'sha256:' + String(i + 1).repeat(64),
    modelMetadataSha256: String(i + 3).repeat(64), configuration: [{ model, mode: i ? 'embedding' : 'completion', 'context-size': 32768 }] }));
  const reportBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, status: 'runtime-api-qualified', activationAuthorized: false,
    providerConfigurationChanged: false, runtimeFilesChanged: false, failures: [], baselineEngineSha256: 'b'.repeat(64),
    startedAt: '2026-10-26T15:00:00Z', admittedAt: '2026-10-26T15:01:00Z', finishedAt: '2026-10-26T15:05:00Z',
    runtime: { version: runtime.version, manifestSha256: runtime.manifestSha256, device: physicalDevice }, runtimeVersion: runtime.version,
    baselineRestored: true, candidateShutdown: { stopped: true }, models: models.map(({ configuration, ...row }) => row),
    configurations: models.map(row => ({ model: row.model, digest: row.digest, original: row.configuration, candidate: row.configuration })),
    embedding: { correct: true, dimensions: 768, modelDigest: models[1].digest },
    results: ['docker-baseline', 'corrected-candidate'].flatMap(engine => ['arithmetic', 'tool-call-format', 'long-cold', 'long-warm']
      .map(kind => ({ engine, case: kind, correct: true, finishReason: kind === 'tool-call-format' ? 'tool_calls' : 'stop' }))),
  }));
  const stateDirectory = join(root, 'state'); await mkdir(stateDirectory, { mode: 0o700 });
  const binding = { sourceSha: 'a'.repeat(40), runtimeManifestSha256: runtime.manifestSha256,
    qualificationReportSha256: sha256(reportBytes), baselineEngineSha256: 'b'.repeat(64),
    profileSha256: installation.servingProfileDigest({ models, physicalDevice }) };
  return { root, sourcePackage, stateDirectory, binding, reportBytes, models, physicalDevice, nowMs: Date.parse('2026-10-28T15:05:00Z') };
}

test('managed staging publishes verified private versioned storage without selecting a live runtime', async t => {
  const f = await fixture(t); const result = await installation.stageRuntimeInstallation(f);
  assert.equal(result.status, 'staged'); assert.equal(result.activationAuthorized, false);
  assert.equal((await verifyRuntimePackage(result.packageRoot)).manifestSha256, f.binding.runtimeManifestSha256);
  assert.deepEqual(await readFile(join(result.releaseRoot, 'qualification.json')), f.reportBytes);
  assert.equal((await readdir(f.stateDirectory)).includes('active.json'), false);
  const again = await installation.stageRuntimeInstallation(f);
  assert.equal(again.releaseRoot, result.releaseRoot); assert.equal(again.reused, true);
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

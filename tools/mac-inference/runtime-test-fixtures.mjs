import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE_LOCK, enumerateFiles, fileRecord, sha256 } from './package.mjs';
import { RUNTIME_LOCK, verifyRuntimePackage } from './runtime-profile.mjs';
import { servingProfileDigest } from './runtime-installation.mjs';

export async function runtimeInstallationFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-managed-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePackage = join(root, 'source');
  const baselineEngine = join(root, 'baseline-engine');
  await writeFile(baselineEngine, 'baseline fixture executable');
  const baselineEngineSha256 = sha256('baseline fixture executable');
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
    providerConfigurationChanged: false, runtimeFilesChanged: false, failures: [], baselineEngineSha256,
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
    qualificationReportSha256: sha256(reportBytes), baselineEngineSha256,
    profileSha256: servingProfileDigest({ models, physicalDevice }) };
  return { root, sourcePackage, stateDirectory, binding, reportBytes, models, physicalDevice, baselineEngine, hostNodeId: 'edge-test',
    nowMs: Date.parse('2026-10-28T15:05:00Z') };
}

export async function runtimeAuthorityFixture(binding) {
  const { generateKeyPairSync } = await import('node:crypto');
  const { signEdgeActionEnvelope, canonicalizeEdgeActionEnvelope } = await import('../../packages/db/src/edge-action-envelope.ts');
  const { createTransitionAuthority } = await import('./runtime-authority.mjs');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const now = Date.now();
  const action = signEdgeActionEnvelope({ version: 'dpf.edge-action/1', actionType: 'inference.runtime.transition',
    actionKey: 'RA-TEST', nodeId: 'edge-test', signingKeyId: 'fixture', nonce: 'fixture-original',
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 240000).toISOString(),
    parameters: { version: 1, operation: 'activate', leaseId: 'NPEL-TEST', ...binding } }, privateKey);
  const admission = signEdgeActionEnvelope({ ...action, actionType: 'inference.runtime.admission', nonce: 'fixture-admission',
    expiresAt: new Date(now + 25000).toISOString(), parameters: { schemaVersion: 1, ready: true,
      requestDigest: sha256(canonicalizeEdgeActionEnvelope(action)), leaseId: 'NPEL-TEST', quiescenceRunId: 'QR-test',
      approvedChangeRequestId: 'CR-test', ownerSessionId: 'fixture-owner', branchName: 'codex/mac-inference-activation' } }, privateKey);
  return createTransitionAuthority({ envelope: action, publicKey, expectedNodeId: action.nodeId, readAdmission: async () => admission });
}

import { readFile, realpath, lstat, cp } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { verifyPackage, readPackageManifest, safePath, fileRecord, enumerateFiles,
  sha256, assertArm64MachO, contained, unusedOutput } from './package.mjs';
import { canonicalJson } from '../../scripts/lib/canonical-json.mjs';

export const RUNTIME_LOCK = JSON.parse(await readFile(new URL('./runtime.lock.json', import.meta.url), 'utf8'));
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function requireUnfenced(report) {
  const fenceEvents = new Set(['heartbeat-lost', 'authority-deadline', 'fence-termination-failed']);
  requireValue(report.authorityFenced !== true && report.backendEffectSettlement === undefined
    && (report.leaseEvents === undefined || (Array.isArray(report.leaseEvents)
      && !report.leaseEvents.some(event => fenceEvents.has(event?.type)))),
  'Qualification carries an authority fence; a qualified label cannot override it');
}
function requireModelControls(report) {
  const expected = ['docker-baseline', 'corrected-candidate'].flatMap(engine =>
    ['arithmetic', 'tool-call-format', 'long-cold', 'long-warm'].map(kind => engine + ':' + kind)).sort();
  requireValue(Array.isArray(report.results) && report.results.length === 8
    && report.results.every(row => row?.correct === true
      && row.finishReason === (row.case === 'tool-call-format' ? 'tool_calls' : 'stop'))
    && canonicalJson(report.results.map(row => row.engine + ':' + row.case).sort()) === canonicalJson(expected),
  'Qualification controls incomplete');
}

// This is artifact inspection, never activation admission or a model verdict.
export async function verifyRuntimePackage(root) {
  root = await realpath(root);
  const raw = await readPackageManifest(join(root, 'runtime-manifest.json'));
  const manifest = JSON.parse(raw);
  requireValue(manifest.schemaVersion === 1 && manifest.packageName === 'dpf-model-runner-macos-arm64'
    && manifest.version === RUNTIME_LOCK.packageVersion, 'Unsupported runtime identity');
  for (const [key, expected] of Object.entries(RUNTIME_LOCK.source)) {
    requireValue(manifest.source?.[key] === expected, 'Unaudited runtime source: ' + key);
  }
  requireValue(manifest.patchSha256 === RUNTIME_LOCK.patchSha256, 'Unaudited runtime patch');
  requireValue(manifest.build?.os === 'darwin' && manifest.build.architecture === 'arm64'
    && /^go1\.\d+\.\d+$/.test(manifest.build.compiler)
    && manifest.build.flags?.includes('-mod=readonly') && manifest.build.flags?.includes('-trimpath')
    && manifest.build.cgo === false, 'Unsupported runtime build provenance');
  requireValue(manifest.qualification?.status === 'unqualified', 'Runtime cannot qualify itself');
  requireValue(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 5000,
    'Invalid runtime file inventory');
  const seen = new Set();
  for (const record of manifest.files) {
    safePath(record.path);
    requireValue(record.path !== 'runtime-manifest.json' && !seen.has(record.path), 'Duplicate runtime file');
    seen.add(record.path);
    const actual = await fileRecord(root, record.path);
    requireValue(actual.type === record.type, 'Runtime file type changed: ' + record.path);
    if (actual.type === 'symlink') requireValue(actual.target === record.target, 'Runtime link changed');
    else requireValue(actual.sizeBytes === record.sizeBytes && actual.sha256 === record.sha256,
      'Runtime file bytes changed: ' + record.path);
  }
  for (const path of ['bin/dmr', 'LICENSE', 'licenses/Go/LICENSE', 'engine/manifest.json']) {
    requireValue(seen.has(path), 'Required runtime file missing: ' + path);
  }
  for (const path of await enumerateFiles(root)) {
    requireValue(path === 'runtime-manifest.json' || seen.has(path), 'Unlisted runtime file: ' + path);
  }
  const runner = await lstat(join(root, 'bin/dmr'));
  requireValue(runner.isFile() && (runner.mode & 0o111) !== 0, 'Runner must be an executable regular file');
  await assertArm64MachO(join(root, 'bin/dmr'));
  const engine = await verifyPackage(join(root, 'engine'));
  requireValue(engine.version === RUNTIME_LOCK.engineVersion
    && engine.manifestSha256 === manifest.engine?.manifestSha256, 'Embedded engine identity changed');
  return { manifest, version: manifest.version, manifestSha256: sha256(raw), engine, fileCount: seen.size,
    qualification: 'unqualified', activationAuthorized: false };
}

export function candidateEnvironment({ packageRoot, stateRoot, port }) {
  requireValue(isAbsolute(packageRoot) && isAbsolute(stateRoot), 'Absolute runtime paths required');
  packageRoot = resolve(packageRoot); stateRoot = resolve(stateRoot);
  requireValue(!contained(packageRoot, stateRoot) && !contained(stateRoot, packageRoot),
    'Mutable state and immutable runtime must not overlap');
  requireValue(Number.isSafeInteger(port) && port >= 1024 && port <= 65535, 'Invalid candidate port');
  return {
    LLAMA_SERVER_PATH: join(packageRoot, 'engine/bin'), DISABLE_SERVER_UPDATE: '1',
    MODEL_RUNNER_BIND_HOST: '127.0.0.1', MODEL_RUNNER_PORT: String(port),
    MODEL_RUNNER_TLS_ENABLED: '0', MODELS_PATH: join(stateRoot, 'models'),
    MODEL_RUNNER_LOG_DIR: join(stateRoot, 'logs'),
  };
}

// Reuse engine smoke evidence only for its exact payload/device/model. The new
// runner and DPF workflow still require their own admitted qualification.
export function verifyEngineQualification({ reportBytes, expectedReportSha256,
  engine, qualifiedManifestBytes, expectedModelDigest, physicalDevice }) {
  requireValue(/^[a-f0-9]{64}$/.test(expectedReportSha256) && sha256(reportBytes) === expectedReportSha256,
    'Qualification report identity changed');
  const report = JSON.parse(reportBytes.toString());
  const engineManifest = engine.manifest;
  requireUnfenced(report);
  requireValue(report.schemaVersion === 1 && report.status === 'model-smoke-qualified'
    && report.baselineRestored === true && Array.isArray(report.failures) && report.failures.length === 0,
    'Incomplete engine qualification');
  requireValue(report.package?.version === RUNTIME_LOCK.engineVersion
    && engineManifest.version === RUNTIME_LOCK.engineVersion, 'Qualification engine version changed');
  requireValue(physicalDevice === RUNTIME_LOCK.initialQualifiedDevice
    && report.tensorControls?.device === physicalDevice
    && report.packageBackendControl?.backendInitialized === true, 'Physical device is not qualified');
  requireValue(/^sha256:[a-f0-9]{64}$/.test(expectedModelDigest)
    && report.model?.ociDigest === expectedModelDigest
    && report.model?.binding?.manifestDigest === expectedModelDigest, 'Qualification model changed');
  requireModelControls(report);
  requireValue(Date.parse(report.startedAt) < Date.parse(report.finishedAt), 'Invalid qualification chronology');
  if (report.package.manifestSha256 !== engine.manifestSha256) {
    requireValue(qualifiedManifestBytes && sha256(qualifiedManifestBytes) === report.package.manifestSha256,
      'Original qualified manifest required for repackaging');
    const qualifiedManifest = JSON.parse(qualifiedManifestBytes.toString());
    requireValue(Array.isArray(qualifiedManifest.files), 'Invalid qualified manifest');
    const native = files => files.filter(row => row.path.startsWith('bin/')).map(row => row.type === 'symlink'
      ? [row.path, row.type, row.target] : [row.path, row.type, row.sizeBytes, row.sha256]).sort((a,b) => a[0].localeCompare(b[0]));
    requireValue(JSON.stringify(native(qualifiedManifest.files)) === JSON.stringify(native(engineManifest.files)),
      'Repackaging changed qualified native files');
  }
  return { engineEvidenceReusable: true, runtimeIntegration: 'unrun', activationAuthorized: false };
}

// runtime must come from verifyRuntimePackage; models/configuration come from
// the actual selected serving profile. This inspects immutable evidence only.
// A signed host procedure still needs its own authority, drain and current lease.
export function verifyRuntimeQualification({ reportBytes, expectedReportSha256, runtime,
  models, physicalDevice, nowMs = Date.now(), qualifiedAfterMs = 0 }) {
  requireValue(/^[a-f0-9]{64}$/.test(expectedReportSha256) && sha256(reportBytes) === expectedReportSha256,
    'Qualification report identity changed');
  const report = JSON.parse(reportBytes.toString()); requireUnfenced(report);
  requireValue(report.activationAuthorized === false, 'Qualification cannot self-authorize activation');
  requireValue(report.schemaVersion === 1 && report.status === 'runtime-api-qualified'
    && report.runtimeFilesChanged === false && report.providerConfigurationChanged === false
    && report.baselineRestored === true && report.candidateShutdown?.stopped === true
    && Array.isArray(report.failures) && report.failures.length === 0
    && (report.obstacles === undefined || (Array.isArray(report.obstacles) && report.obstacles.length === 0)),
  'Incomplete runtime qualification or restoration');
  requireValue(runtime.version === RUNTIME_LOCK.packageVersion && report.runtime?.version === runtime.version
    && report.runtime?.manifestSha256 === runtime.manifestSha256
    && report.runtimeVersion?.includes(runtime.version), 'Qualification runtime identity changed');
  requireValue(physicalDevice === RUNTIME_LOCK.initialQualifiedDevice && report.runtime.device === physicalDevice,
    'Physical device is not qualified');
  const start = Date.parse(report.startedAt), admitted = Date.parse(report.admittedAt), end = Date.parse(report.finishedAt);
  requireValue(Number.isSafeInteger(nowMs) && Number.isSafeInteger(qualifiedAfterMs)
    && qualifiedAfterMs >= 0 && qualifiedAfterMs <= nowMs
    && start <= admitted && admitted < end && end <= nowMs, 'Invalid qualification chronology or time bounds');
  // Age alone does not invalidate an unchanged package. An authoritative host
  // or serving-profile change can supply its explicit requalification boundary.
  requireValue(end >= qualifiedAfterMs, 'Qualification predates the required evidence bound');
  requireValue(Array.isArray(models) && models.length === 2 && models[0].model !== models[1].model
    && models[0].digest !== models[1].digest
    && Array.isArray(report.models) && report.models.length === 2
    && Array.isArray(report.configurations) && report.configurations.length === 2,
  'Qualification model/configuration binding changed');
  for (const model of models) {
    const matches = report.models.filter(row => row?.model === model.model);
    const configurations = report.configurations.filter(row => row?.model === model.model);
    requireValue(/^sha256:[a-f0-9]{64}$/.test(model.digest) && /^[a-f0-9]{64}$/.test(model.modelMetadataSha256)
      && matches.length === 1 && matches[0].digest === model.digest
      && matches[0].modelMetadataSha256 === model.modelMetadataSha256 && configurations.length === 1,
    'Qualification model/projector metadata binding changed');
    const entry = configurations[0];
    requireValue(entry.digest === model.digest && Array.isArray(model.configuration)
      && Array.isArray(entry.original) && Array.isArray(entry.candidate)
      && canonicalJson(model.configuration) === canonicalJson(entry.original)
      && canonicalJson(entry.original) === canonicalJson(entry.candidate), 'Qualification configuration binding changed');
  }
  requireModelControls(report);
  requireValue(report.embedding?.correct === true && report.embedding.dimensions === 768
    && report.embedding.modelDigest === models[1].digest, 'Qualification embedding controls incomplete');
  // In particular, a legacy `released` event is not a platform acknowledgement.
  return { runtimeEvidenceReusable: true, activationAuthorized: false,
    platformWorkflowIntegration: 'unrun', releaseVerified: false };
}

export async function stageVerifiedRuntime(source, destination) {
  const before = await verifyRuntimePackage(source);
  await unusedOutput(destination);
  await cp(source, destination, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  const after = await verifyRuntimePackage(destination);
  requireValue(after.manifestSha256 === before.manifestSha256, 'Staged runtime identity changed');
  return after;
}

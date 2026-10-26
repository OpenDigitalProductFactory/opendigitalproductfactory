import { readFile, realpath, lstat } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { verifyPackage, readPackageManifest, safePath, fileRecord, enumerateFiles,
  sha256, assertArm64MachO, contained } from './package.mjs';

export const RUNTIME_LOCK = JSON.parse(await readFile(new URL('./runtime.lock.json', import.meta.url), 'utf8'));
function requireValue(ok, message) { if (!ok) throw new Error(message); }

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
  return { manifest, manifestSha256: sha256(raw), engine, fileCount: seen.size,
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
  const expectedControls = ['docker-baseline', 'corrected-candidate'].flatMap(name =>
    ['arithmetic', 'tool-call-format', 'long-cold', 'long-warm'].map(kind => name + ':' + kind));
  requireValue(Array.isArray(report.results) && report.results.length === 8
    && report.results.every(row => row.correct === true
      && row.finishReason === (row.case === 'tool-call-format' ? 'tool_calls' : 'stop'))
    && JSON.stringify(report.results.map(row => row.engine + ':' + row.case).sort()) === JSON.stringify(expectedControls.sort()),
    'Qualification controls incomplete');
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

import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { lstat, readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { protectedDirectory, protectedRead } from '../../scripts/installer/recovery-filesystem.mjs';
import { isEntryModule } from '../../scripts/lib/entry-module.mjs';
import { hashFile, sha256 } from './package.mjs';
import { RUNTIME_LOCK, verifyRuntimePackage } from './runtime-profile.mjs';
import { captureRuntimeModels } from './runtime-model-store.mjs';
import { stageRuntimeInstallation, servingProfileDigest } from './runtime-installation.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const execute = promisify(execFile);
// Installer-owned staging. No inference, configuration write, launchd change,
// policy/grant change, provider selection or resident model is started here.
export async function stageQualifiedNativeRuntime({ stateDirectory, sourcePackage, sourceSha, reportFile,
  expectedRuntimeManifestSha256, expectedReportSha256, baselineEngine,
  platform = process.platform, architecture = process.arch, fetchImpl = fetch, run = execute }) {
  check(platform === 'darwin' && architecture === 'arm64', 'Native runtime staging is limited to Apple Silicon');
  check(/^[a-f0-9]{40}$/.test(sourceSha ?? '') && [expectedReportSha256, expectedRuntimeManifestSha256].every(x => /^[a-f0-9]{64}$/.test(x ?? '')),
    'Pinned source, runtime and qualification report required');
  for (const path of [stateDirectory, sourcePackage, reportFile, baselineEngine]) check(isAbsolute(path ?? ''), 'Absolute installer path required');
  const state = await protectedDirectory(stateDirectory);
  const node = JSON.parse((await protectedRead(join(state, 'edge-node', 'state.json'))).toString());
  check(node.trustState === 'trusted' && typeof node.nodeId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(node.nodeId), 'Trusted enrolled host identity required');
  const info = await lstat(reportFile);
  check(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size > 0 && info.size <= 65536, 'Invalid qualification report file');
  const reportBytes = await readFile(reportFile);
  check(sha256(reportBytes) === expectedReportSha256, 'Qualification report identity changed');
  const report = JSON.parse(reportBytes.toString());
  const runtime = await verifyRuntimePackage(sourcePackage);
  check(runtime.manifestSha256 === expectedRuntimeManifestSha256, 'Pinned runtime manifest changed');
  const hardware = JSON.parse((await run('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 15000 })).stdout);
  const physicalDevice = hardware.SPDisplaysDataType?.[0]?.sppci_model;
  check(physicalDevice === RUNTIME_LOCK.initialQualifiedDevice, 'Physical device is not qualified');
  const json = async (root, path) => {
    const response = await fetchImpl(root + path, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    check(response.ok, 'Existing Docker model metadata unavailable'); return response.json();
  };
  const models = await captureRuntimeModels({ expected: report.models, root: 'http://127.0.0.1:12434', json });
  const binding = { sourceSha, runtimeManifestSha256: runtime.manifestSha256, qualificationReportSha256: expectedReportSha256,
    baselineEngineSha256: await hashFile(baselineEngine), profileSha256: servingProfileDigest({ models, physicalDevice }) };
  return stageRuntimeInstallation({ stateDirectory: state, sourcePackage, reportBytes, binding, models, physicalDevice, hostNodeId: node.nodeId });
}

if (isEntryModule(import.meta.url)) {
  try {
    const { values } = parseArgs({ strict: true, allowPositionals: false, options: Object.fromEntries([
      'state-directory', 'runtime-package', 'source', 'report', 'runtime-manifest-sha256', 'report-sha256', 'baseline-engine',
    ].map(key => [key, { type: 'string' }])) });
    const result = await stageQualifiedNativeRuntime({ stateDirectory: values['state-directory'], sourcePackage: values['runtime-package'],
      sourceSha: values.source, reportFile: values.report, expectedRuntimeManifestSha256: values['runtime-manifest-sha256'],
      expectedReportSha256: values['report-sha256'], baselineEngine: values['baseline-engine'] });
    process.stdout.write(JSON.stringify({ schemaVersion: 1, status: result.status, binding: result.binding,
      hostNodeId: result.hostNodeId, physicalDevice: result.physicalDevice, reused: result.reused, activationAuthorized: false }) + '\n');
  } catch {
    process.stderr.write('Native runtime provisioning refused; no service or provider was selected.\n'); process.exitCode = 1;
  }
}

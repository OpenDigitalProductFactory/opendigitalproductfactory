import { lstat, mkdir, mkdtemp, open, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../scripts/lib/canonical-json.mjs';
import { protectedDirectory, protectedRead } from '../../scripts/installer/recovery-filesystem.mjs';
import { acquireRuntimeApplyLock } from '../../scripts/installer/runtime-apply-lock.mjs';
import { sha256 } from './package.mjs';
import { verifyRuntimePackage, verifyRuntimeQualification, stageVerifiedRuntime } from './runtime-profile.mjs';

export const servingProfileDigest = profile => sha256(canonicalJson(profile));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const digest = value => /^[a-f0-9]{64}$/.test(value ?? '');
function releaseBinding(binding) {
  check(binding && Object.keys(binding).sort().join(',') === [
    'sourceSha', 'runtimeManifestSha256', 'qualificationReportSha256', 'baselineEngineSha256', 'profileSha256',
  ].sort().join(',') && /^[a-f0-9]{40}$/.test(binding.sourceSha ?? '')
    && Object.entries(binding).every(([key, value]) => key === 'sourceSha' || digest(value)), 'Invalid release binding');
  return structuredClone(binding);
}
async function privateChild(parent, name) {
  const path = join(parent, name);
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return protectedDirectory(path);
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeDurable(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function syncPayload(path) {
  for (const child of await readdir(path, { withFileTypes: true })) {
    const target = join(path, child.name);
    if (child.isDirectory()) await syncPayload(target);
    else if (child.isFile()) {
      const handle = await open(target, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
    } else check(child.isSymbolicLink(), 'Unsupported staged payload');
  }
  await syncDirectory(path);
}
async function inspectRelease(releaseRoot, binding, facts) {
  await protectedDirectory(releaseRoot);
  const record = JSON.parse((await protectedRead(join(releaseRoot, 'release.json'))).toString());
  check(record.schemaVersion === 1 && record.status === 'staged' && record.activationAuthorized === false
    && canonicalJson(record.binding) === canonicalJson(binding), 'Staged release binding changed');
  const runtime = await verifyRuntimePackage(join(releaseRoot, 'runtime'));
  check(runtime.manifestSha256 === binding.runtimeManifestSha256, 'Staged runtime identity changed');
  const reportBytes = await protectedRead(join(releaseRoot, 'qualification.json'));
  verifyRuntimeQualification({ ...facts, reportBytes, expectedReportSha256: binding.qualificationReportSha256, runtime });
  check(JSON.parse(reportBytes.toString()).baselineEngineSha256 === binding.baselineEngineSha256, 'Qualification baseline identity changed');
  return { ...record, packageRoot: join(releaseRoot, 'runtime'), releaseRoot };
}

// Staging copies immutable artifacts only. It consumes neither a native action
// nor GPU admission and never installs a service, changes a provider or selects
// an active runtime. The later signed host procedure must read/verify it again.
export async function stageRuntimeInstallation({ stateDirectory, sourcePackage, reportBytes, binding,
  models, physicalDevice, nowMs = Date.now(), qualifiedAfterMs = 0 }) {
  binding = releaseBinding(binding);
  const facts = { models: structuredClone(models), physicalDevice, nowMs, qualifiedAfterMs };
  check(servingProfileDigest({ models: facts.models, physicalDevice }) === binding.profileSha256, 'Serving profile identity changed');
  check(Buffer.isBuffer(reportBytes) && reportBytes.length > 0 && reportBytes.length <= 65536, 'Invalid qualification report size');
  // Copy caller buffers before asynchronous checks so the same verified bytes
  // are persisted even if the caller later mutates its own buffer.
  reportBytes = Buffer.from(reportBytes);
  const runtime = await verifyRuntimePackage(sourcePackage);
  check(runtime.manifestSha256 === binding.runtimeManifestSha256, 'Runtime manifest identity changed');
  verifyRuntimeQualification({ ...facts, reportBytes, runtime, expectedReportSha256: binding.qualificationReportSha256 });
  check(JSON.parse(reportBytes.toString()).baselineEngineSha256 === binding.baselineEngineSha256, 'Qualification baseline identity changed');
  const lock = await acquireRuntimeApplyLock({ stateDirectory, runId: 'inference-stage-' + sha256(canonicalJson(binding)).slice(0, 32) });
  try {
    const state = await protectedDirectory(stateDirectory);
    const store = await privateChild(state, 'mac-inference');
    const releases = await privateChild(store, 'releases');
    const releaseId = sha256(canonicalJson(binding));
    const releaseRoot = join(releases, releaseId);
    const existing = await lstat(releaseRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing) return { ...await inspectRelease(releaseRoot, binding, facts), reused: true };
    const temporary = await mkdtemp(join(releases, '.staging-'));
    await protectedDirectory(temporary); await lock.assertOwned();
    const staged = await stageVerifiedRuntime(sourcePackage, join(temporary, 'runtime'));
    check(staged.manifestSha256 === binding.runtimeManifestSha256, 'Staged source identity changed');
    await writeDurable(join(temporary, 'qualification.json'), reportBytes);
    const record = { schemaVersion: 1, status: 'staged', activationAuthorized: false, binding };
    await writeDurable(join(temporary, 'release.json'), canonicalJson(record));
    await inspectRelease(temporary, binding, facts); await syncPayload(temporary);
    await lock.assertOwned();
    check(!await lstat(releaseRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), 'Release destination became occupied');
    await rename(temporary, releaseRoot); await syncDirectory(releases);
    return { ...await inspectRelease(releaseRoot, binding, facts), reused: false };
  } finally {
    // No native process or model effect can outlive this staging operation.
    // Failed partial staging directories remain evidence; never reclaim them
    // or an uncertain pre-existing operation lock through recursive deletion.
    check(await lock.release(), 'Staging operation lock ownership changed');
  }
}

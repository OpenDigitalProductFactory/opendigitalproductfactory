import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { mkdir, writeFile, open, realpath, lstat, mkdtemp, rename } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { canonicalJson } from '../../scripts/lib/canonical-json.mjs';
import { isEntryModule } from '../../scripts/lib/entry-module.mjs';
import { protectedDirectory, protectedRead } from '../../scripts/installer/recovery-filesystem.mjs';
import { sha256, hashFile, unusedOutput, enumerateFiles, fileRecord } from './package.mjs';

const execute = promisify(execFile);
const check = (ok, message) => { if (!ok) throw new Error(message); };

export const CONTROLLER_SOURCE_FILES = Object.freeze([
  'tools/mac-inference/runtime-controller.mjs', 'tools/mac-inference/runtime-native-adapter.mjs',
  'tools/mac-inference/runtime-authority.mjs', 'tools/mac-inference/runtime-installation.mjs',
  'tools/mac-inference/runtime-launchagent.mjs', 'tools/mac-inference/runtime-model-store.mjs',
  'tools/mac-inference/runtime-provision.mjs',
  'tools/mac-inference/runtime-profile.mjs', 'tools/mac-inference/package.mjs',
  'tools/mac-inference/engine.lock.json', 'tools/mac-inference/runtime.lock.json',
  'packages/db/src/edge-action-envelope.ts', 'packages/db/src/remote-action-dispatch.ts',
  'scripts/lib/canonical-json.mjs', 'scripts/lib/local-sandbox-fence.mjs', 'scripts/lib/entry-module.mjs',
  'scripts/installer/recovery-filesystem.mjs', 'scripts/installer/runtime-apply-lock.mjs',
  'scripts/installer/install-state-transaction.mjs', 'scripts/installer/install-state-lock-contract.json',
  'scripts/installer/validate-install-state.mjs', 'scripts/installer/install-state-schema-registry.mjs',
  'scripts/installer/install-state.v1.schema.json', 'scripts/installer/install-state.v2.schema.json',
]);
const entrypoint = 'tools/mac-inference/runtime-controller.mjs';
const expectedPaths = [...CONTROLLER_SOURCE_FILES, 'package.json'].sort();
const safeEnvironment = () => Object.fromEntries(['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL']
  .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]).concat([['PATH', '/usr/bin:/bin:/usr/sbin:/sbin']]));
function contractValid(contract) {
  return contract?.schemaVersion === 1 && contract.version === '1' && contract.actionType === 'inference.runtime.transition'
    && canonicalJson(contract.operations) === canonicalJson(['activate', 'rollback'])
    && contract.platform === 'darwin' && contract.architecture === 'arm64' && contract.minimumNode === '22.18.0';
}

// This builds source artifacts, never a daemon or a live install. Immutable Git
// objects are the input even if a sibling checkout advances during staging.
export async function buildNativeControllerPackage({ repoRoot, sourceSha, destination, nodePath = process.execPath, reuseVerified = false }) {
  check(/^[a-f0-9]{40}$/.test(sourceSha ?? ''), 'Exact controller source commit required');
  const existing = await lstat(resolve(destination)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) {
    check(reuseVerified, 'Output already exists');
    await unusedOutput(join(resolve(destination), '.dpf-unused-output-validation'));
  }
  const finalDestination = existing ? resolve(destination) : await unusedOutput(destination);
  repoRoot = await realpath(repoRoot); nodePath = await realpath(nodePath);
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };
  const commit = await execute('git', ['-C', repoRoot, 'rev-parse', '--verify', sourceSha + '^{commit}'], { env, timeout: 5000 });
  check(commit.stdout.trim() === sourceSha, 'Controller source commit identity changed');
  const nodeVersion = (await execute(nodePath, ['--version'], { env: safeEnvironment(), timeout: 5000 })).stdout.trim();
  const version = nodeVersion.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  check(version && (Number(version[1]) > 22 || Number(version[1]) === 22 && Number(version[2]) >= 18), 'Controller requires Node >=22.18');
  if (existing) return reuseCommittedController({ root: finalDestination, repoRoot, sourceSha, nodePath, nodeVersion, env });
  // A failed build leaves private staging evidence, never a partially
  // published source-version directory that blocks a supported retry.
  destination = await mkdtemp(join(dirname(finalDestination), '.native-controller-'));
  const files = [];
  for (const path of CONTROLLER_SOURCE_FILES) {
    const { stdout } = await execute('git', ['-C', repoRoot, 'cat-file', 'blob', sourceSha + ':' + path],
      { env, encoding: 'buffer', timeout: 5000, maxBuffer: 512 * 1024 });
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, stdout, { flag: 'wx', mode: 0o400 });
    files.push({ path, sizeBytes: stdout.length, sha256: sha256(stdout) });
  }
  const packageBytes = canonicalJson({ private: true, type: 'module' });
  await writeFile(join(destination, 'package.json'), packageBytes, { flag: 'wx', mode: 0o400 });
  files.push({ path: 'package.json', sizeBytes: Buffer.byteLength(packageBytes), sha256: sha256(packageBytes) });
  const inert = await execute(nodePath, [join(destination, entrypoint), '--print-controller-contract'],
    { cwd: destination, env: safeEnvironment(), timeout: 15000, maxBuffer: 65536 });
  const contract = JSON.parse(inert.stdout);
  check(contractValid(contract), 'Packaged controller contract incomplete');
  const manifest = { schemaVersion: 1, packageName: 'dpf-native-inference-controller', version: '1', sourceSha, entrypoint,
    node: { path: nodePath, version: nodeVersion, sha256: await hashFile(nodePath) }, contract,
    files: files.sort((a, b) => a.path.localeCompare(b.path)), activationAuthorized: false };
  const bytes = canonicalJson(manifest), manifestSha256 = sha256(bytes);
  await writeFile(join(destination, 'controller-manifest.json'), bytes, { flag: 'wx', mode: 0o600 });
  const directories = new Set([destination]);
  for (const path of [...files.map(row => row.path), 'controller-manifest.json']) {
    const target = join(destination, path), file = await open(target, 'r');
    try { await file.sync(); } finally { await file.close(); }
    for (let at = dirname(target); at !== destination; at = dirname(at)) directories.add(at);
  }
  for (const path of [...directories].sort((a, b) => b.length - a.length)) {
    const directory = await open(path, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  await verifyNativeControllerPackage({ root: destination, expectedManifestSha256: manifestSha256, sourceSha });
  check(!await lstat(finalDestination).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), 'Controller destination became occupied');
  await rename(destination, finalDestination);
  const parent = await open(dirname(finalDestination), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
  return { directory: await realpath(finalDestination), sourceSha, manifestSha256, nodePath, nodeSha256: manifest.node.sha256,
    entrypoint, activationAuthorized: false, reused: false };
}

async function reuseCommittedController({ root, repoRoot, sourceSha, nodePath, nodeVersion, env }) {
  const raw = await protectedRead(join(await protectedDirectory(root), 'controller-manifest.json'));
  const manifest = JSON.parse(raw.toString());
  const nodeSha256 = await hashFile(nodePath);
  check(manifest.node?.path === nodePath && manifest.node.version === nodeVersion && manifest.node.sha256 === nodeSha256,
    'Committed controller Node runtime changed; stage a new published source version');
  const files = [];
  for (const path of CONTROLLER_SOURCE_FILES) {
    const { stdout } = await execute('git', ['-C', repoRoot, 'cat-file', 'blob', sourceSha + ':' + path],
      { env, encoding: 'buffer', timeout: 5000, maxBuffer: 512 * 1024 });
    files.push({ path, sizeBytes: stdout.length, sha256: sha256(stdout) });
  }
  const bytes = canonicalJson({ private: true, type: 'module' });
  files.push({ path: 'package.json', sizeBytes: Buffer.byteLength(bytes), sha256: sha256(bytes) });
  files.sort((a, b) => a.path.localeCompare(b.path));
  check(canonicalJson(manifest.files) === canonicalJson(files), 'Controller bytes differ from committed source');
  const manifestSha256 = sha256(raw);
  await verifyNativeControllerPackage({ root, expectedManifestSha256: manifestSha256, sourceSha });
  const inert = await execute(nodePath, [join(root, entrypoint), '--print-controller-contract'],
    { cwd: root, env: safeEnvironment(), timeout: 15000, maxBuffer: 65536 });
  const contract = JSON.parse(inert.stdout);
  const expected = { schemaVersion: 1, packageName: 'dpf-native-inference-controller', version: '1', sourceSha, entrypoint,
    node: { path: nodePath, version: nodeVersion, sha256: nodeSha256 }, contract, files, activationAuthorized: false };
  check(contractValid(contract) && raw.toString() === canonicalJson(expected), 'Committed controller manifest changed');
  return { directory: await realpath(root), sourceSha, manifestSha256, nodePath, nodeSha256, entrypoint, activationAuthorized: false, reused: true };
}

export async function verifyNativeControllerPackage({ root, expectedManifestSha256, sourceSha }) {
  root = await protectedDirectory(root);
  const bytes = await protectedRead(join(root, 'controller-manifest.json'));
  check(/^[a-f0-9]{64}$/.test(expectedManifestSha256 ?? '') && sha256(bytes) === expectedManifestSha256, 'Controller manifest identity changed');
  const manifest = JSON.parse(bytes.toString());
  check(manifest.schemaVersion === 1 && manifest.packageName === 'dpf-native-inference-controller' && manifest.version === '1'
    && manifest.sourceSha === sourceSha && /^[a-f0-9]{40}$/.test(sourceSha ?? '') && manifest.entrypoint === entrypoint
    && manifest.activationAuthorized === false && contractValid(manifest.contract), 'Controller package identity changed');
  check(Array.isArray(manifest.files) && canonicalJson(manifest.files.map(row => row.path).sort()) === canonicalJson(expectedPaths), 'Controller file inventory changed');
  const actualPaths = (await enumerateFiles(root)).filter(path => path !== 'controller-manifest.json').sort();
  check(canonicalJson(actualPaths) === canonicalJson(expectedPaths), 'Unlisted controller payload');
  for (const row of manifest.files) {
    const actual = await fileRecord(root, row.path), stat = await lstat(join(root, row.path));
    check(actual.type === 'file' && actual.sha256 === row.sha256 && actual.sizeBytes === row.sizeBytes
      && (stat.mode & 0o077) === 0, 'Controller file identity changed: ' + row.path);
  }
  check(typeof manifest.node?.path === 'string' && await realpath(manifest.node.path) === manifest.node.path
    && await hashFile(manifest.node.path) === manifest.node.sha256, 'Controller Node executable identity changed');
  return { entrypoint, contract: manifest.contract, fileCount: manifest.files.length, sourceSha,
    nodePath: manifest.node.path, nodeSha256: manifest.node.sha256, activationAuthorized: false };
}

async function main() {
  const { values } = parseArgs({ strict: true, options: { ...Object.fromEntries(['repo', 'source', 'out'].map(name => [name, { type: 'string' }])), reuse: { type: 'boolean' } } });
  for (const name of ['repo', 'source', 'out']) check(values[name], 'Controller build arguments incomplete');
  process.stdout.write(JSON.stringify(await buildNativeControllerPackage({ repoRoot: values.repo, sourceSha: values.source, destination: values.out, reuseVerified: values.reuse === true })) + '\n');
}
if (isEntryModule(import.meta.url)) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });

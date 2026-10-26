#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, cp, rm, realpath, access, lstat } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryModule } from '../../scripts/lib/entry-module.mjs';
import { unusedOutput, hashFile, enumerateFiles, fileRecord, verifyPackage, contained,
  vendorNoticePaths, safePath } from './package.mjs';
import { RUNTIME_LOCK as lock, verifyRuntimePackage } from './runtime-profile.mjs';

export function parseRuntimeBuildOptions(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    archive: { type: 'string' }, engine: { type: 'string' }, out: { type: 'string' },
    go: { type: 'string' }, 'keep-build': { type: 'boolean', default: false },
  } });
  for (const key of ['archive', 'engine', 'out', 'go']) {
    if (!values[key]) throw new Error('--' + key + ' is required');
  }
  return values;
}
function run(command, args, cwd, capture = false) {
  return execFileSync(command, args, { cwd, timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
    encoding: capture ? 'utf8' : undefined, stdio: capture ? 'pipe' : 'inherit',
    env: { ...process.env, GOOS: 'darwin', GOARCH: 'arm64', CGO_ENABLED: '0', GOTOOLCHAIN: 'local' } });
}
export async function findGoLicense(goRoot) {
  goRoot = await realpath(goRoot);
  // Homebrew splits LICENSE into the formula root; official Go keeps it in GOROOT.
  for (const path of [join(goRoot, 'LICENSE'), join(dirname(goRoot), 'LICENSE')]) {
    try { if ((await lstat(path)).isFile()) return path; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('Compiler license unavailable in Go distribution');
}
async function moduleNotices(go, source, out) {
  const rows = run(go, ['list', '-mod=readonly', '-deps', '-f', '{{with .Module}}{{.Path}}|{{.Version}}|{{.Dir}}{{end}}', './cmd/dmr'], source, true);
  const modules = new Map();
  for (const line of rows.trim().split('\n').filter(Boolean)) {
    const [name, version, dir, extra] = line.split('|');
    if (!name || !dir || extra !== undefined) throw new Error('Invalid module provenance');
    modules.set(name, { version, dir });
  }
  const result = []; let index = 0;
  for (const [name, module] of [...modules].sort(([a], [b]) => a.localeCompare(b))) {
    const paths = await vendorNoticePaths(module.dir, { includeHeaders: false, includePatents: true });
    if (!paths.length) throw new Error('Module license notices unavailable: ' + name);
    const prefix = 'licenses/modules/' + String(index++).padStart(3, '0');
    for (const path of paths) {
      safePath(path); const destination = join(out, prefix, path);
      await mkdir(dirname(destination), { recursive: true }); await cp(join(module.dir, path), destination);
    }
    result.push({ module: name, version: module.version || lock.source.commit, noticePrefix: prefix });
  }
  const goRoot = run(go, ['env', 'GOROOT'], source, true).trim();
  await mkdir(join(out, 'licenses/Go'), { recursive: true });
  await cp(await findGoLicense(goRoot), join(out, 'licenses/Go/LICENSE'));
  for (const name of ['PATENTS']) {
    try { await access(join(goRoot, name)); await cp(join(goRoot, name), join(out, 'licenses/Go', name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const goVendor = join(goRoot, 'src/vendor');
  for (const path of await vendorNoticePaths(goVendor, { includeHeaders: false, includePatents: true })) {
    safePath(path); const destination = join(out, 'licenses/Go/vendor', path);
    await mkdir(dirname(destination), { recursive: true }); await cp(join(goVendor, path), destination);
  }
  return result;
}

export async function buildRuntime(options) {
  if (platform() !== 'darwin' || arch() !== 'arm64') throw new Error('Runtime build requires Apple Silicon macOS');
  const out = await unusedOutput(options.out);
  const archive = await realpath(options.archive); const engineRoot = await realpath(options.engine);
  if (contained(engineRoot, out) || contained(out, engineRoot)) throw new Error('Engine and output overlap');
  if (await hashFile(archive) !== lock.source.archiveSha256) throw new Error('Runtime source archive SHA256 mismatch');
  const patch = fileURLToPath(new URL('./dmr-custom-engine.patch', import.meta.url));
  if (await hashFile(patch) !== lock.patchSha256) throw new Error('Runtime patch SHA256 mismatch');
  const engine = await verifyPackage(engineRoot);
  if (engine.version !== lock.engineVersion) throw new Error('Unsupported embedded engine');
  const compiler = run(options.go, ['version'], undefined, true).match(/\bgo\d+\.\d+\.\d+\b/)?.[0];
  if (!compiler) throw new Error('Go compiler identity unavailable');
  const actual = compiler.slice(2).split('.').map(Number), minimum = lock.minimumGo.split('.').map(Number);
  const delta = actual.map((n, i) => n - minimum[i]).find(n => n !== 0) ?? 0;
  if (delta < 0) throw new Error('Go compiler is older than pinned module requirement');
  const sourceRoot = 'model-runner-' + lock.source.commit;
  for (const path of run('tar', ['-tzf', archive], undefined, true).trim().split('\n')) {
    const parts = path.replace(/\/$/, '').split('/');
    if (path.startsWith('/') || parts[0] !== sourceRoot || parts.includes('..')) throw new Error('Unsafe runtime archive path');
  }
  const workspace = await mkdtemp(join(tmpdir(), 'dpf-mac-runtime-'));
  let created = false;
  try {
    run('tar', ['-xzf', archive, '-C', workspace]); const source = join(workspace, sourceRoot);
    const dependenciesMatch = async () => {
      if (await hashFile(join(source, 'go.mod')) !== lock.source.goModSha256
        || await hashFile(join(source, 'go.sum')) !== lock.source.goSumSha256) throw new Error('Pinned Go dependencies changed');
    };
    await dependenciesMatch();
    run('git', ['apply', '--check', patch], source); run('git', ['apply', patch], source);
    // These are real upstream packages plus the reviewed regression patch. No weights are loaded.
    run(options.go, ['test', '-mod=readonly', '-count=1', './pkg/inference/backends/llamacpp', './pkg/server'], source);
    await mkdir(out, { mode: 0o700 }); created = true; await mkdir(join(out, 'bin'));
    const flags = ['-mod=readonly', '-trimpath', '-ldflags', '-X main.Version=' + lock.packageVersion];
    run(options.go, ['build', ...flags, '-o', join(out, 'bin/dmr'), './cmd/dmr'], source);
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', join(out, 'bin/dmr')]);
    await cp(engineRoot, join(out, 'engine'), { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true });
    const stagedEngine = await verifyPackage(join(out, 'engine'));
    if (stagedEngine.manifestSha256 !== engine.manifestSha256) throw new Error('Engine changed during staging');
    await cp(join(source, 'LICENSE'), join(out, 'LICENSE'));
    const moduleLicenses = await moduleNotices(options.go, source, out); await dependenciesMatch();
    const files = []; for (const path of await enumerateFiles(out)) files.push(await fileRecord(out, path));
    const manifest = { schemaVersion: 1, packageName: 'dpf-model-runner-macos-arm64', version: lock.packageVersion,
      source: lock.source, patchSha256: lock.patchSha256,
      build: { os: 'darwin', architecture: 'arm64', compiler, cgo: false, flags,
        builderSha256: await hashFile(fileURLToPath(import.meta.url)),
        signature: 'local-adhoc', artifactTrust: 'candidate-not-distribution-approved' },
      engine: { version: engine.version, manifestSha256: engine.manifestSha256 }, moduleLicenses,
      qualification: { status: 'unqualified', runtimeIntegration: 'unrun' }, files };
    await writeFile(join(out, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    const verification = await verifyRuntimePackage(out);
    const archivePath = out + '.tar.gz';
    try { await access(archivePath); throw new Error('Runtime archive already exists'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    run('tar', ['-czf', archivePath, '-C', dirname(out), basename(out)]);
    return { packagePath: out, archivePath, archiveSha256: await hashFile(archivePath),
      manifestSha256: verification.manifestSha256, fileCount: verification.fileCount,
      activationAuthorized: false, qualification: 'unqualified', retainedBuild: options['keep-build'] ? workspace : null };
  } catch (error) {
    if (created) await rm(out, { recursive: true, force: true });
    throw error;
  } finally { if (!options['keep-build']) await rm(workspace, { recursive: true, force: true }); }
}
if (isEntryModule(import.meta.url)) {
  buildRuntime(parseRuntimeBuildOptions()).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

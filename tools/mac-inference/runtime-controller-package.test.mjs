import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROLLER_SOURCE_FILES, buildNativeControllerPackage, verifyNativeControllerPackage } from './runtime-controller-package.mjs';

const execute = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-controller-package-')); t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = join(root, 'source'); await mkdir(repoRoot);
  const actualSource = fileURLToPath(new URL('../../', import.meta.url));
  for (const path of CONTROLLER_SOURCE_FILES) {
    const target = join(repoRoot, path); await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(actualSource, path)));
  }
  // A synthetic repository tests immutable Git-object reads; it is neither a
  // DPF worktree nor publication evidence and has no inherited project hooks.
  await execute('git', ['init', '-q', repoRoot]);
  await execute('git', ['-C', repoRoot, 'add', '.']);
  await execute('git', ['-C', repoRoot, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'fixture source']);
  const sourceSha = (await execute('git', ['-C', repoRoot, 'rev-parse', 'HEAD'])).stdout.trim();
  return { root, repoRoot, sourceSha, destination: join(root, 'package') };
}

test('controller package captures the exact committed dependency closure and runs only the inert contract command', async t => {
  const f = await fixture(t); const result = await buildNativeControllerPackage(f);
  assert.equal(result.sourceSha, f.sourceSha); assert.equal(result.activationAuthorized, false);
  const verified = await verifyNativeControllerPackage({ root: result.directory, expectedManifestSha256: result.manifestSha256, sourceSha: f.sourceSha });
  assert.equal(verified.entrypoint, 'tools/mac-inference/runtime-controller.mjs');
  assert.equal(verified.contract.actionType, 'inference.runtime.transition');
  assert.deepEqual(verified.contract.operations, ['activate', 'rollback']);
  assert.equal(verified.fileCount, CONTROLLER_SOURCE_FILES.length + 1);
  await writeFile(join(f.repoRoot, 'tools/mac-inference/runtime-authority.mjs'), 'changed working tree');
  const second = await buildNativeControllerPackage({ ...f, destination: join(f.root, 'second') });
  assert.equal(second.manifestSha256, result.manifestSha256);
});

test('controller verification rejects changed executable source and never replaces a staged package', async t => {
  const f = await fixture(t); const result = await buildNativeControllerPackage(f);
  const path = join(result.directory, 'tools/mac-inference/runtime-controller.mjs');
  await chmod(path, 0o600); await writeFile(path, 'changed controller');
  await assert.rejects(verifyNativeControllerPackage({ root: result.directory, expectedManifestSha256: result.manifestSha256, sourceSha: f.sourceSha }), /changed|identity/);
  await assert.rejects(buildNativeControllerPackage(f), /exists/);
  assert.equal(await readFile(path, 'utf8'), 'changed controller');
});

test('the supported installer CLI builds the same verified inert package', async t => {
  const f = await fixture(t);
  const script = fileURLToPath(new URL('./runtime-controller-package.mjs', import.meta.url));
  const result = await execute(process.execPath, [script, '--repo', f.repoRoot, '--source', f.sourceSha, '--out', f.destination]);
  const built = JSON.parse(result.stdout);
  assert.equal(built.sourceSha, f.sourceSha); assert.equal(built.activationAuthorized, false);
  assert.match(built.manifestSha256, /^[a-f0-9]{64}$/);
});

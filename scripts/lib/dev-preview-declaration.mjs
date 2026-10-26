import { lstat, realpath, mkdtemp, open, writeFile, unlink, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, isAbsolute, sep, posix, win32 } from 'node:path';
import { previewMountMatches } from '../../packages/integration-shared/src/preview-mount-identity.cjs';

export const PREVIEW_DECLARATION_TARGET = '/workspace/apps/web/next-env.d.ts';
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;
const regular = stat => stat.isFile() && !stat.isSymbolicLink();
const sameSeed = (stat, expected) => regular(stat) && sameFile(stat, expected)
  && ['size', 'mtimeNs', 'ctimeNs', 'mtimeMs', 'ctimeMs'].every(key => stat[key] === expected[key]);

async function readPreviewSeed(path) {
  const checked = await lstat(path, { bigint: true });
  if (!regular(checked)) throw new Error('preview_declaration_seed_invalid');
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat({ bigint: true });
    if (!sameSeed(opened, checked)) throw new Error('preview_declaration_seed_changed');
    const bytes = await handle.readFile();
    const [after, current] = await Promise.all([handle.stat({ bigint: true }), lstat(path, { bigint: true })]);
    if (!sameSeed(after, opened) || !sameSeed(current, opened) || BigInt(bytes.length) !== opened.size) {
      throw new Error('preview_declaration_seed_changed');
    }
    return bytes;
  } catch (error) {
    if (error.code === 'ELOOP') throw new Error('preview_declaration_seed_invalid');
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

export async function createPreviewDeclaration({ worktree, stateDirectory }) {
  const [source, parent] = await Promise.all([realpath(worktree), realpath(stateDirectory)]);
  const distance = relative(source, parent);
  const outside = isAbsolute(distance) || distance === '..' || distance.startsWith(`..${sep}`);
  if (!outside) throw new Error('preview_declaration_inside_source');
  const seedPath = join(source, 'apps/web/next-env.d.ts');
  const bytes = await readPreviewSeed(seedPath);
  const directory = await mkdtemp(join(parent, 'preview-declaration-'));
  const path = join(directory, 'next-env.d.ts');
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    return { directory, path, directoryIdentity: await lstat(directory), fileIdentity: await lstat(path) };
  } catch (error) {
    // No container can reference this unpublished path yet. Remove only our file.
    await unlink(path).catch(() => {});
    await rmdir(directory);
    throw error;
  }
}

export async function assertPreviewDeclarationFile(declaration) {
  const [directory, file] = await Promise.all([lstat(declaration.directory), lstat(declaration.path)]);
  if (!directory.isDirectory() || directory.isSymbolicLink() || !sameFile(directory, declaration.directoryIdentity)
      || !regular(file) || !sameFile(file, declaration.fileIdentity)) throw new Error('preview_declaration_file_changed');
}

export function previewDeclarationMount(path) {
  return { type: 'bind', source: path, target: PREVIEW_DECLARATION_TARGET, read_only: false, bind: { create_host_path: false } };
}

export function assertPreviewDeclarationMount(mounts, { declarationPath, dockerOperatingSystem }, actual = false) {
  if (!declarationPath) return; // Historical callers; every new controller supplies its owned file.
  const target = mount => actual ? mount.Destination : mount.target;
  const matches = (mounts || []).filter(mount => target(mount) === PREVIEW_DECLARATION_TARGET);
  const mount = matches[0];
  const source = actual ? mount?.Source : mount?.source;
  const type = actual ? mount?.Type : mount?.type;
  // Compose's canonical config omits read_only:false; both spellings mean rw.
  const writable = actual ? mount?.RW === true
    : (mount?.read_only === undefined || mount?.read_only === false) && mount?.bind?.create_host_path === false;
  const shadow = (mounts || []).some(item => {
    const path = target(item);
    return typeof path === 'string' && path !== '/workspace' && path !== PREVIEW_DECLARATION_TARGET
      && PREVIEW_DECLARATION_TARGET.startsWith(path.replace(/\/$/, '') + '/');
  });
  if (matches.length !== 1 || type !== 'bind' || !writable || shadow
      || !previewMountMatches(source, declarationPath, actual ? dockerOperatingSystem : undefined)) {
    throw new Error('preview_declaration_mount_mismatch');
  }
}

/** The caller must first positively establish that no container references remain. */
export async function removePreviewDeclaration(declaration) {
  await assertPreviewDeclarationFile(declaration);
  await unlink(declaration.path);
  await rmdir(declaration.directory); // Never recursively remove unexpected files.
}

/** Before runtime creation, local files are unpublished and grant no Docker cleanup authority. */
export async function reclaimPreviewDeclaration({ declaration, runtimeMayHaveWriters, stopOwned }) {
  if (runtimeMayHaveWriters) await stopOwned();
  await removePreviewDeclaration(declaration);
}

/** Inspect a complete global inventory; failed/partial reads never mean no refs. */
async function declarationContainers(runner) {
  const ids = (await runner.run(['ps', '-aq', '--no-trunc'])).split(/\s+/).filter(Boolean);
  if (!ids.length) return [];
  const containers = JSON.parse(await runner.run(['inspect', ...ids]));
  if (new Set(ids).size !== ids.length || !Array.isArray(containers) || containers.length !== ids.length
      || ids.some(id => !containers.some(container => container.Id === id))) throw new Error('preview_declaration_inventory_unverified');
  return containers;
}

export async function stopDeclarationWriters({ runner, declarationPath, leaseId, projectName, initName }) {
  const dockerOperatingSystem = await runner.run(['info', '--format', '{{.OperatingSystem}}'], { timeoutMs: 10000 });
  if (!dockerOperatingSystem) throw new Error('preview_declaration_inventory_unverified');
  const owns = container => {
    const labels = container.Config?.Labels || {};
    return labels['dpf.preview.lease'] === leaseId && labels['com.docker.compose.project'] === projectName
      && (labels['com.docker.compose.service'] === 'dev-portal'
        || (labels['com.docker.compose.service'] === 'dev-init' && container.Name === `/${initName}`));
  };
  const references = container => {
    if (!Array.isArray(container.Mounts)) throw new Error('preview_declaration_inventory_unverified');
    return container.Mounts.some(mount => {
      if (!mount || typeof mount.Type !== 'string' || !mount.Type) throw new Error('preview_declaration_inventory_unverified');
      if (mount.Type !== 'bind') return false;
      if (typeof mount.Source !== 'string' || !mount.Source) throw new Error('preview_declaration_inventory_unverified');
      // An exact file bind pins its inode even when readonly. Readonly directory
      // ancestors (including the canonical /dpf-state mount) neither pin the
      // child inode nor grant write access and need not be removed.
      if (previewMountMatches(mount.Source, declarationPath, dockerOperatingSystem)) return true;
      if (mount.RW === false) return false;
      const paths = /^[a-z]:[\\/]/i.test(declarationPath) ? win32 : posix;
      let parent = paths.dirname(declarationPath);
      for (;;) {
        if (previewMountMatches(mount.Source, parent, dockerOperatingSystem)) return true;
        const next = paths.dirname(parent);
        if (next === parent) return false;
        parent = next;
      }
    });
  };
  const containers = await declarationContainers(runner);
  if (containers.some(container => references(container) && !owns(container))) throw new Error('preview_declaration_foreign_reference');
  for (const container of containers.filter(owns)) {
    await runner.run(['stop', container.Id]);
    const [stopped] = JSON.parse(await runner.run(['inspect', container.Id]));
    if (!stopped || stopped.Id !== container.Id || !owns(stopped) || stopped.State?.Running !== false) throw new Error('preview_declaration_writer_unverified');
    await runner.run(['rm', container.Id]);
  }
  if ((await declarationContainers(runner)).some(references)) throw new Error('preview_declaration_reference_remains');
}

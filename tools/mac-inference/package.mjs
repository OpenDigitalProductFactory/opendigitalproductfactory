import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { readFile, readdir, lstat, realpath, readlink, open, access } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

export const ENGINE_LOCK = JSON.parse(await readFile(new URL('./engine.lock.json', import.meta.url), 'utf8'));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function safePath(path) {
  requireValue(typeof path === 'string' && path.length <= 512 && !isAbsolute(path)
    && path.split('/').every(x => /^[A-Za-z0-9_.+-]+$/.test(x) && x !== '.' && x !== '..'), 'Unsafe package path');
  return path;
}
export function contained(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
}
export async function enumerateFiles(root, prefix = '') {
  const result = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    safePath(path);
    if (entry.isDirectory()) result.push(...await enumerateFiles(root, path));
    else if (entry.isFile() || entry.isSymbolicLink()) result.push(path);
    else throw new Error('Unsupported package file type: ' + path);
  }
  return result;
}
export async function fileRecord(root, path) {
  safePath(path);
  const full = join(root, path);
  requireValue(contained(await realpath(root), await realpath(dirname(full))), 'Parent symlink escapes package');
  const stat = await lstat(full);
  if (stat.isSymbolicLink()) {
    const target = await readlink(full);
    requireValue(!isAbsolute(target) && contained(root, resolve(dirname(full), target)), 'Symlink escapes package');
    requireValue(contained(await realpath(root), await realpath(full)), 'Symlink escapes package');
    return { path, type: 'symlink', target };
  }
  requireValue(stat.isFile(), 'Unsupported package file type');
  requireValue(contained(await realpath(root), await realpath(full)), 'File escapes package');
  return { path, type: 'file', sizeBytes: stat.size, sha256: await hashFile(full) };
}
export async function assertArm64MachO(path) {
  const fd = await open(path, 'r');
  try {
    const header = Buffer.alloc(8); const read = await fd.read(header,0,8,0);
    requireValue(read.bytesRead === 8 && header.readUInt32LE(0) === 0xfeedfacf
      && header.readUInt32LE(4) === 0x0100000c, 'Required arm64 Mach-O binary: ' + path);
  } finally { await fd.close(); }
}
// Shared by native builders: never replace an install or emit into a checkout.
export async function unusedOutput(value) {
  if (!value) throw new Error('--out is required');
  const path = resolve(value); const parent = await realpath(dirname(path));
  const actual = join(parent, basename(path));
  for (const forbidden of [homedir(), '/Applications', '/System', '/usr', '/bin', '/sbin', '/Library', join(homedir(), '.docker')]) {
    if (actual === forbidden || (forbidden !== homedir() && contained(forbidden, actual))) throw new Error('Protected output path');
  }
  for (let p = parent; ; p = dirname(p)) {
    try { await access(join(p,'.git')); throw new Error('Output must be outside a Git checkout'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (p === dirname(p)) break;
  }
  try { await lstat(actual); throw new Error('Output already exists; no replacement is permitted'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return actual;
}
export async function readPackageManifest(path,openFile=open) {
  const limit=1024*1024;
  // Validate and read the same no-follow handle, even if the pathname changes.
  const handle=await openFile(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=await handle.stat();
    requireValue(stat.isFile() && stat.size<=limit,'Invalid manifest file');
    const bytes=Buffer.alloc(limit+1); let used=0;
    while(used<bytes.length) {
      const {bytesRead}=await handle.read(bytes,used,bytes.length-used,used);
      if(bytesRead===0) break;
      used+=bytesRead;
    }
    requireValue(used<=limit,'Manifest file too large');
    return bytes.subarray(0,used);
  } finally {await handle.close();}
}
export async function verifyPackage(root) {
  root = await realpath(root);
  const manifestPath = join(root, 'manifest.json');
  const raw = await readPackageManifest(manifestPath);
  const manifest = JSON.parse(raw);
  requireValue(manifest.schemaVersion === 1, 'Unsupported manifest schema');
  requireValue(manifest.packageName === 'dpf-llama-macos-arm64'
    && manifest.version === ENGINE_LOCK.packageVersion, 'Unsupported package identity');
  for (const [key, value] of Object.entries(ENGINE_LOCK.source)) {
    requireValue(manifest.source?.[key] === value, 'Unaudited source identity: ' + key);
  }
  requireValue(manifest.patchSha256 === ENGINE_LOCK.patchSha256, 'Unaudited patch identity');
  requireValue(manifest.build?.os === 'darwin' && manifest.build.architecture === 'arm64'
    && manifest.build.minimumMacOS === ENGINE_LOCK.minimumMacOS
    && /^\d+\.\d+(?:\.\d+)?$/.test(manifest.build.sdk)
    && typeof manifest.build.compiler === 'string' && manifest.build.compiler.length > 0
    && manifest.build.flags?.includes('-DGGML_NATIVE=OFF'), 'Unsupported build provenance');
  requireValue(manifest.qualification?.status === 'unqualified', 'Package cannot assert its own model qualification');
  requireValue(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 5000, 'Invalid file manifest');
  const seen = new Set();
  for (const record of manifest.files) {
    safePath(record.path);
    requireValue(record.path !== 'manifest.json' && !seen.has(record.path), 'Duplicate or recursive manifest path');
    seen.add(record.path);
    const actual = await fileRecord(root, record.path);
    requireValue(actual.type === record.type, 'Manifest file type mismatch');
    if (actual.type === 'symlink') requireValue(actual.target === record.target, 'Symlink target mismatch');
    else {
      requireValue(Number.isSafeInteger(record.sizeBytes) && record.sizeBytes === actual.sizeBytes, 'File size mismatch: ' + record.path);
      requireValue(/^[a-f0-9]{64}$/.test(record.sha256) && record.sha256 === actual.sha256, 'File hash mismatch: ' + record.path);
    }
  }
  for (const required of ['bin/llama-server', 'bin/llama-bench', 'LICENSE', ...ENGINE_LOCK.requiredRuntimeLibraries]) {
    requireValue(seen.has(required), 'Required package file missing: ' + required);
  }
  for (const path of await enumerateFiles(root)) requireValue(path === 'manifest.json' || seen.has(path), 'Unlisted package file: ' + path);
  for (const path of ['bin/llama-server', 'bin/llama-bench']) {
    requireValue((await lstat(join(root,path))).isFile(), 'Required binary must be a regular file');
    requireValue(((await lstat(join(root,path))).mode & 0o111) !== 0, 'Required binary is not executable');
    await assertArm64MachO(join(root,path));
  }
  for(const path of ENGINE_LOCK.requiredRuntimeLibraries) await assertArm64MachO(join(root,path));
  return { schemaVersion: 1, requiredRuntimeLibrariesVerified:ENGINE_LOCK.requiredRuntimeLibraries.length, packageName: manifest.packageName, version: manifest.version,
    manifestSha256: sha256(raw), fileCount: seen.size, qualification: manifest.qualification, manifest };
}

// Keep embedded third-party notices verbatim, including headers whose projects
// do not ship a standalone LICENSE file inside llama.cpp's vendor directory.
export async function vendorNoticePaths(root, { includeHeaders = true, includePatents = false } = {}) {
  const paths=await readdir(root,{recursive:true});
  const selected=[];
  for(const path of paths) {
    const name = path.split('/').at(-1);
    if(!/^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(name)
      && !(includePatents && /^PATENTS(\.|$)/i.test(name))
      && !(includeHeaders && /\.(h|hpp)$/i.test(name))) continue;
    if((await lstat(join(root,path))).isFile()) selected.push(path);
  }
  return selected.sort();
}
export function embeddedMitNotice(header,license) {
  const copyright=header.match(/^\/\/ SPDX-FileCopyrightText: (.+)$/m)?.[1];
  requireValue(copyright && /^\/\/ SPDX-License-Identifier: MIT$/m.test(header)
    && license.includes('Permission is hereby granted'), 'Embedded MIT notice unavailable');
  return 'JSON for Modern C++\n\nCopyright: '+copyright+'\nSPDX-License-Identifier: MIT\n\n'+license;
}

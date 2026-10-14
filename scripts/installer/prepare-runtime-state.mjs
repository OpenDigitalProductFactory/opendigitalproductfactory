#!/usr/bin/env node
// Resolve Compose's actual host mounts; never reimplement .env interpolation.
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function runtimeMounts(config) {
  const volumes = config.services?.portal?.volumes ?? [];
  const source = target => {
    const matches = volumes.filter(v => v.type === 'bind' && v.target === target);
    if (matches.length !== 1 || typeof matches[0].source !== 'string' || !isAbsolute(matches[0].source)) {
      throw new Error(`runtime_bind_missing:${target}`);
    }
    return matches[0].source;
  };
  return { state: source('/dpf-state'), federation: source('/dpf-federation') };
}

async function privateDirectory(path) {
  if (!isAbsolute(path)) throw new Error('runtime_directory_not_absolute');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`runtime_directory_unsafe:${path}`);
  if (process.platform !== 'win32') {
    if (info.uid !== process.getuid()) throw new Error(`runtime_directory_wrong_owner:${path}:restore operator ownership before retrying; no data was removed`);
    await chmod(path, 0o700);
  } else {
    if (!process.env.USERNAME) throw new Error('windows_identity_unavailable');
    const acl = spawnSync('icacls.exe', [path, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:(OI)(CI)F`], { encoding: 'utf8' });
    if (acl.status !== 0) throw new Error('runtime_directory_acl_failed');
  }
}

export async function prepareRuntimeState({ state, federation }) {
  await privateDirectory(state);
  // Refuse a symlink rather than allowing the canonical initializer to follow it.
  try {
    const key = await lstat(join(state, 'runtime-transition.secret'));
    if (!key.isFile() || key.isSymbolicLink()) throw new Error('runtime_secret_unsafe');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const initialized = spawnSync(process.execPath, [fileURLToPath(new URL('../rotate-runtime-transition-secret.mjs', import.meta.url)), '--state-dir', state, '--initialize'], { encoding: 'utf8' });
  if (initialized.status !== 0) {
    // Only forward known diagnostic codes, never arbitrary child output.
    const diagnostic = ['transition_in_progress', 'secret_rotation_in_progress', 'invalid_existing_transition_secret', 'windows_acl_failed'].find(code => initialized.stderr?.includes(code));
    throw new Error(diagnostic ?? 'runtime_secret_initialization_failed');
  }
  await privateDirectory(federation);
  await privateDirectory(join(federation, 'pki'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const rendered = spawnSync('docker', ['compose', ...process.argv.slice(2), 'config', '--format', 'json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (rendered.status !== 0) throw new Error('runtime_compose_resolution_failed');
    let config;
    try { config = JSON.parse(rendered.stdout); } catch { throw new Error('runtime_compose_config_invalid'); }
    await prepareRuntimeState(runtimeMounts(config));
    console.log('Runtime state and signing key ready.');
  } catch (error) { console.error(error.message); process.exitCode = 78; }
}

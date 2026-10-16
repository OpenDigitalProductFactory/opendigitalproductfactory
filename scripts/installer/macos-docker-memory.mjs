#!/usr/bin/env node
// Docker Desktop's settings remain the single source of VM allocation.
import { constants, lstatSync, openSync, fstatSync, readFileSync, closeSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { scriptArgv } from '../lib/script-argv.mjs';

export function targetMemory(hostMiB) {
  if (!Number.isFinite(hostMiB) || hostMiB < 16384) throw new Error('macOS installation requires at least 16 GiB of physical RAM.');
  return Math.min(32768, Math.max(8192, Math.floor(hostMiB / 4096) * 1024));
}

function readSettings(path, adminPath) {
  try { lstatSync(adminPath); throw new Error('Docker Desktop is administrator-managed; ask its administrator to configure memory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Check and read through one descriptor so the file cannot be swapped in between.
  let fd;
  try { fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW); }
  catch (error) {
    if (error.code === 'ELOOP') throw new Error('Docker settings must be a regular, non-symlink file.');
    throw error;
  }
  let stat;
  let raw;
  try {
    stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Docker settings must be a regular, non-symlink file.');
    raw = readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
  let settings;
  try { settings = JSON.parse(raw); } catch { throw new Error('Docker settings contain invalid JSON.'); }
  if (!settings || Array.isArray(settings) || typeof settings !== 'object' || !Number.isSafeInteger(settings.MemoryMiB) || settings.MemoryMiB <= 0) {
    throw new Error('Docker settings have no valid integer MemoryMiB allocation.');
  }
  return { settings, raw, mode: stat.mode & 0o777 };
}

function matches(liveBytes, desired) {
  const liveMiB = liveBytes / 1048576;
  return Number.isFinite(liveMiB) && liveMiB >= desired * 0.95 && liveMiB <= desired * 1.01;
}

export async function convergeMemory(options) {
  const { platform, hostMiB, settingsPath, adminPath, run, env = {}, allowRestart = false, dryRun = false } = options;
  if (platform !== 'darwin') return { state: 'skipped', reason: 'macOS only' };
  // Never modify local Desktop for a selected remote engine.
  if (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith('unix://')) return { state: 'skipped', reason: 'remote Docker host' };
  const contexts = JSON.parse(run(['context', 'inspect']));
  const endpoint = contexts?.[0]?.Endpoints?.docker?.Host;
  const localSockets = options.localSockets ?? [`unix://${join(homedir(), '.docker/run/docker.sock')}`, 'unix:///var/run/docker.sock'];
  if (!localSockets.includes(endpoint) || (env.DOCKER_HOST && !localSockets.includes(env.DOCKER_HOST))) {
    return { state: 'skipped', reason: 'Docker endpoint is not local Desktop' };
  }
  const info = () => JSON.parse(run(['info', '--format', '{{json .}}']));
  if (info().OperatingSystem !== 'Docker Desktop') return { state: 'skipped', reason: 'engine is not Docker Desktop' };
  const upper = targetMemory(hostMiB);
  const before = readSettings(settingsPath, adminPath);
  const desired = before.settings.MemoryMiB >= 8192 && before.settings.MemoryMiB <= upper ? before.settings.MemoryMiB : upper;
  if (before.settings.MemoryMiB === desired && matches(info().MemTotal, desired)) return { state: 'converged', desired };
  const running = run(['ps', '-q', '--no-trunc']).trim().split(/\s+/).filter(Boolean);
  if (running.some(id => !/^[a-f0-9]+$/.test(id))) throw new Error('Could not safely read the running container IDs.');
  const message = `Docker memory: ${before.settings.MemoryMiB} -> ${desired} MiB. Restart interrupts all Docker containers and host model runner work.`;
  options.log?.(message);
  if (dryRun) return { state: 'planned', desired, running };
  // AI-enabled Desktop can have native model work even without containers.
  const modelEnabled = before.settings.EnableDockerAI === true || before.settings.enableDockerAI === true;
  if ((running.length || modelEnabled) && !allowRestart) {
    const error = new Error(`${message} Restart permission is required; use --allow-docker-restart or accept the installer prompt.`);
    error.code = 'CONSENT_REQUIRED';
    throw error;
  }
  // Ensure the graceful lifecycle CLI exists before stopping anything.
  run(['desktop', 'stop', '--help']);
  run(['desktop', 'start', '--help']);
  // Recheck policy and source immediately before the disruptive operation.
  if (readSettings(settingsPath, adminPath).raw !== before.raw) throw new Error('Docker settings changed during inspection; rerun installation.');
  run(['desktop', 'stop', '--timeout', '45']);
  let backupPath;
  let temporary;
  try {
    const stopped = readSettings(settingsPath, adminPath);
    // Desktop may persist unrelated state while quitting; preserve that fresh state.
    if (stopped.settings.MemoryMiB !== before.settings.MemoryMiB) throw new Error('Docker memory changed during shutdown; rerun after inspecting it.');
    backupPath = `${settingsPath}.before-dpf-memory-${randomUUID()}`;
    writeFileSync(backupPath, stopped.raw, { flag: 'wx', mode: 0o600 });
    temporary = `${settingsPath}.dpf-memory-${randomUUID()}`;
    writeFileSync(temporary, `${JSON.stringify({ ...stopped.settings, MemoryMiB: desired }, null, 2)}\n`, { flag: 'wx', mode: stopped.mode });
    renameSync(temporary, settingsPath);
    temporary = undefined;
  } catch (error) {
    if (temporary) { try { unlinkSync(temporary); } catch {} }
    try { run(['desktop', 'start']); } catch { throw new Error(`${error.message}; Docker restart also failed; backup: ${backupPath ?? 'not created'}.`); }
    throw new Error(`${error.message}; Docker restart requested; backup: ${backupPath ?? 'not created'}.`);
  }
  try {
    run(['desktop', 'start']);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { info(); ready = true; break; } catch { await (options.sleep ?? sleep)(2000); }
    }
    if (!ready) throw new Error('Docker did not become reachable within the startup window');
    if (running.length) run(['start', ...running]);
    const active = new Set(run(['ps', '-q', '--no-trunc']).trim().split(/\s+/));
    if (running.some(id => !active.has(id))) throw new Error('Some previously running containers were not restored');
    if (readSettings(settingsPath, adminPath).settings.MemoryMiB !== desired || !matches(info().MemTotal, desired)) {
      throw new Error('Saved and live Docker memory do not agree after restart');
    }
    return { state: 'changed', desired, backupPath };
  } catch (error) {
    throw new Error(`${error.message}; settings saved at ${desired} MiB; Docker/container recovery requires attention; backup: ${backupPath}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ args: scriptArgv(), options: {
      apply: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'allow-docker-restart': { type: 'boolean' },
    } });
    if (process.platform !== 'darwin') {
      console.log('Docker memory sizing skipped: macOS only.');
    } else {
      const exec = args => execFileSync('docker', args, { encoding: 'utf8', timeout: args[0] === 'desktop' || args.includes('start') ? 65000 : 5000, stdio: ['ignore', 'pipe', 'pipe'] });
      const context = exec(['context', 'show']).trim();
      // Pin engine commands: Desktop startup can change the default context.
      const run = args => exec(args[0] === 'desktop' ? args : ['--context', context, ...args]);
      const result = await convergeMemory({
        platform: process.platform, hostMiB: Number(execFileSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8', timeout: 5000 })) / 1048576,
        settingsPath: join(homedir(), 'Library/Group Containers/group.com.docker/settings-store.json'),
        adminPath: '/Library/Application Support/com.docker.docker/admin-settings.json',
        env: process.env, run, allowRestart: values['allow-docker-restart'] === true,
        dryRun: !values.apply || values['dry-run'] === true, log: console.log,
      });
      console.log(`Docker memory ${result.state}${result.desired ? `: ${result.desired} MiB` : `: ${result.reason}`}${result.backupPath ? `; backup: ${result.backupPath}` : ''}.`);
    }
  } catch (error) {
    console.error(`Docker memory setup: ${error.message}`);
    process.exitCode = error.code === 'CONSENT_REQUIRED' ? 75 : 1;
  }
}

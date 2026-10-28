import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { candidateEnvironment } from './runtime-profile.mjs';

const execute = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
function identity({ label, uid = process.getuid() }) {
  if (!/^local\.dpf-inference\.[a-z0-9.-]{1,120}$/.test(label) || uid !== process.getuid()) {
    throw new Error('LaunchAgent identity must belong to this user and runtime');
  }
  return { domain: 'gui/' + uid, target: 'gui/' + uid + '/' + label };
}
export function renderRuntimeLaunchAgent({ label, packageRoot, stateRoot, port, leaseFile, hardDeadline }) {
  identity({ label });
  if (!isAbsolute(leaseFile) || !Number.isFinite(Date.parse(hardDeadline))) throw new Error('Bounded experiment lease required');
  const environment = { ...candidateEnvironment({ packageRoot, stateRoot, port }), LLAMA_ARGS: '',
    DPF_INFERENCE_LEASE_FILE: leaseFile, DPF_INFERENCE_EXPERIMENT_DEADLINE: hardDeadline };
  const envXml = Object.entries(environment).map(([key, value]) => '<key>' + xml(key) + '</key><string>' + xml(value) + '</string>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n'
    + '<key>Label</key><string>' + xml(label) + '</string>\n'
    + '<key>ProgramArguments</key><array><string>' + xml(join(packageRoot, 'bin/dmr')) + '</string><string>serve</string></array>\n'
    + '<key>EnvironmentVariables</key><dict>' + envXml + '</dict>\n'
    + '<key>WorkingDirectory</key><string>' + xml(stateRoot) + '</string>\n'
    + '<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>\n'
    + '<key>AbandonProcessGroup</key><false/><key>ExitTimeOut</key><integer>10</integer>\n'
    + '<key>StandardOutPath</key><string>' + xml(join(stateRoot, 'logs/daemon.out.log')) + '</string>\n'
    + '<key>StandardErrorPath</key><string>' + xml(join(stateRoot, 'logs/daemon.err.log')) + '</string>\n'
    + '</dict></plist>\n';
}
export async function launchctl(args) {
  try { const r = await execute('/bin/launchctl', args, { timeout: 15000, maxBuffer: 1024 * 1024 }); return { code: 0, ...r }; }
  catch (error) { return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; }
}
export function parseLaunchAgentStatus(result) {
  if (result.code === 113 && /could not find service/i.test(result.stderr)) return { exists: false };
  if (result.code !== 0) throw new Error('LaunchAgent observation unavailable');
  const program = result.stdout.match(/^\s*program = (.+)$/m)?.[1]?.trim().replace(/^"(.*)"$/, '$1');
  const pid = Number(result.stdout.match(/^\s*pid = (\d+)$/m)?.[1]);
  if (!program) throw new Error('LaunchAgent program identity unavailable');
  return { exists: true, program, pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null };
}
export async function ownedRuntimeProcesses(workspaceRoot) {
  // A failed snapshot stays unknown. Do not turn a failed ps into an empty set.
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,command='], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  return stdout.split('\n').flatMap(line => {
    const row = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return row && row[3].includes(workspaceRoot) ? [{ pid: Number(row[1]), parentPid: Number(row[2]) }] : [];
  });
}
export function createRuntimeLaunchAgent({ label, program, plistPath, stateRoot, workspaceRoot,
  readAuthority, run = launchctl, processes = ownedRuntimeProcesses, onEvent = async () => {}, delay = pause }) {
  const { domain, target } = identity({ label });
  let attempted = false;
  const inspect = async () => parseLaunchAgentStatus(await run(['print', target]));
  return {
    async prepare(contents) {
      await mkdir(join(stateRoot, 'models'), { recursive: true, mode: 0o700 });
      await mkdir(join(stateRoot, 'logs'), { recursive: true, mode: 0o700 });
      await writeFile(plistPath, contents, { flag: 'wx', mode: 0o600 });
    },
    async start() {
      await readAuthority();
      if ((await inspect()).exists) throw new Error('LaunchAgent label already occupied');
      await readAuthority(); attempted = true;
      await onEvent({ phase: 'bootstrap-attempted', label });
      const result = await run(['bootstrap', domain, plistPath]);
      if (result.code !== 0) throw new Error('LaunchAgent bootstrap acknowledgement unavailable');
      for (let n = 0; n < 50; n++) {
        const value = await inspect();
        if (value.exists && value.program !== program) throw new Error('LaunchAgent ownership changed');
        if (value.exists && value.pid) { await onEvent({ phase: 'running', label, pid: value.pid }); return value; }
        await delay(100);
      }
      throw new Error('LaunchAgent did not reach running state');
    },
    async stop() {
      if (!attempted) return { stopped: true, bootstrapAttempted: false };
      const current = await inspect();
      if (current.exists) {
        if (current.program !== program) throw new Error('Refusing to stop an unowned LaunchAgent');
        const result = await run(['bootout', target]);
        // Reconcile the actual job/process state even after a lost acknowledgement.
        await onEvent({ phase: 'bootout-attempted', acknowledged: result.code === 0, label });
      }
      for (let n = 0; n < 100; n++) {
        const remaining = await inspect();
        if (remaining.exists && remaining.program !== program) throw new Error('LaunchAgent ownership changed during cleanup');
        if (!remaining.exists && (await processes(workspaceRoot)).length === 0) return { stopped: true, bootstrapAttempted: true };
        await delay(100);
      }
      throw new Error('Owned native process cleanup unconfirmed');
    },
  };
}

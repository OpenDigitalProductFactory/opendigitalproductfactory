import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitText } from './lib/git.mjs';
import { isEntryModule } from './lib/entry-module.mjs';
import { spawnDurableWaitResumer, DEFAULT_RESUME_DEADLINE_MS, RESUME_MARKER_ENV, RESUMER_DISABLE_ENV } from './lib/durable-wait-resumer.mjs';
import { EXIT_SOURCE_DRIFT, EXIT_WAIT_CANCELLED, EXIT_RUNNER_PREREQUISITE_UNAVAILABLE } from './lib/sandbox-freshness.mjs';

const ownPath = fileURLToPath(import.meta.url);
const flags = { worktree: 'worktree', branch: 'branch', sha: 'sha', ownerProvider: 'owner-provider',
  ownerSessionId: 'owner-session-id', resumeLeaseId: 'resume-lease-id', taskRunId: 'task-run-id',
  claimKey: 'claim-key', mcpUrl: 'mcp-url', waitDeadline: 'wait-deadline' };

function readSource(worktree) {
  const git = args => gitText(args, { cwd: worktree, timeout: 5000 });
  return { sha: git(['rev-parse', 'HEAD']), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: Boolean(git(['status', '--porcelain'])) };
}

function runChild({ args, env, cwd }) {
  return new Promise(resolveExit => {
    const child = spawn('bash', args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', () => resolveExit(EXIT_RUNNER_PREREQUISITE_UNAVAILABLE));
    child.once('close', code => resolveExit(code ?? EXIT_RUNNER_PREREQUISITE_UNAVAILABLE));
  });
}

/** Reuse the registered CI consumer; it owns the wait, never a new queue row. */
export async function resumePreviewQueue(pin, deps = {}) {
  let endpoint;
  try { endpoint = new URL(pin.mcpUrl); } catch { return { code: 64, reason: 'invalid-pin' }; }
  if (Object.keys(flags).some(key => typeof pin[key] !== 'string' || !pin[key].trim() || /[\r\n\0]/.test(pin[key]))
      || !isAbsolute(pin.worktree) || !/^[a-f0-9]{40}$/.test(pin.sha) || pin.branch === 'HEAD'
      || !/^NPEL-[A-Z0-9]+$/.test(pin.resumeLeaseId) || !/^TR-[A-Z0-9-]+$/.test(pin.taskRunId)
      || !['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
      // DPF_MCP_URL is persisted as <PUBLIC_URL>/api/mcp/v1?tier=full; refuse any other query.
      || (endpoint.search && endpoint.search !== '?tier=full') || endpoint.hash) {
    return { code: 64, reason: 'invalid-pin' };
  }
  const remaining = Date.parse(pin.waitDeadline) - (deps.now ?? Date.now)();
  if (!Number.isFinite(remaining) || remaining <= 0) return { code: EXIT_WAIT_CANCELLED, reason: 'wait-deadline' };
  let actual;
  try { actual = await (deps.readSource ?? readSource)(pin.worktree); }
  catch { return { code: EXIT_RUNNER_PREREQUISITE_UNAVAILABLE, reason: 'source-unavailable' }; }
  if (actual.sha !== pin.sha || actual.branch !== pin.branch || actual.dirty) return { code: EXIT_SOURCE_DRIFT, reason: 'source-drift' };
  const env = deps.env ?? process.env;
  if (env[RESUME_MARKER_ENV] === '1') {
    const code = await (deps.runChild ?? runChild)({
      cwd: pin.worktree,
      args: [fileURLToPath(new URL('./dev-portal-lease.sh', import.meta.url)), 'refresh',
        '--worktree', pin.worktree, '--owner-provider', pin.ownerProvider, '--owner-session-id', pin.ownerSessionId,
        '--mcp-url', pin.mcpUrl],
      env: { ...env, DPF_DEV_PORTAL_CLAIM_KEY: pin.claimKey, DPF_DEV_PORTAL_EXPECTED_SOURCE_SHA: pin.sha,
        DPF_DEV_PORTAL_EXPECTED_BRANCH: pin.branch,
        DPF_DEV_PORTAL_RESUME_LEASE_ID: pin.resumeLeaseId, DPF_DEV_PORTAL_TASK_RUN_ID: pin.taskRunId },
    });
    return { code, reason: code === 75 ? 'still-queued' : 'child-completed' };
  }
  if (env[RESUMER_DISABLE_ENV] === 'off') return { code: 75, reason: 'disabled', spawned: false };
  const observerDirectory = deps.observerDirectory ?? resolve(pin.worktree,
    gitText(['rev-parse', '--git-common-dir'], { cwd: pin.worktree, timeout: 5000 }), 'dpf-local-ci-queue-observers');
  const resume = (deps.spawnResumer ?? spawnDurableWaitResumer)({
    runnerPath: fileURLToPath(new URL('./local-ci-durable-wait-resumer.mjs', import.meta.url)),
    gateArgv: [process.execPath, ownPath, ...Object.entries(flags).flatMap(([key, flag]) => [`--${flag}`, pin[key]])],
    observerDirectory, cwd: pin.worktree, env,
    pin: { branch: pin.branch, sha: pin.sha, worktree: pin.worktree, ownerProvider: pin.ownerProvider,
      ownerSessionId: pin.ownerSessionId, resumeLeaseId: pin.resumeLeaseId },
    deadlineMs: Math.min(remaining, DEFAULT_RESUME_DEADLINE_MS),
  });
  return { code: 75, spawned: resume.spawned === true && resume.survivesSession === true,
    pid: resume.pid ?? null, reason: resume.spawned && resume.survivesSession ? 'registered-consumer' : 'consumer-unavailable' };
}

if (isEntryModule(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(Object.values(flags).map(flag => [flag, { type: 'string' }])) });
    const pin = Object.fromEntries(Object.entries(flags).map(([key, flag]) => [key, values[flag]]));
    const result = await resumePreviewQueue(pin);
    console.error(JSON.stringify({ status: result.code === 75 ? 'queued' : 'completed', ...result }));
    process.exitCode = result.code;
  } catch { console.error('preview_resume_unavailable'); process.exitCode = EXIT_RUNNER_PREREQUISITE_UNAVAILABLE; }
}

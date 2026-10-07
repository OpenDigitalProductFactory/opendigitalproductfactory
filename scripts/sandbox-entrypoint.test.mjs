import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const failure of ['', 'install', 'prisma']) {
  test(`sandbox boot ${failure ? `stops on ${failure} failure` : 'repairs dependencies before serving'}`, { skip: process.platform === 'win32' }, () => {
    const root = mkdtempSync(join(tmpdir(), 'dpf-sandbox-boot-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      writeFileSync(join(root, '.dpf-version'), 'prior-source');
      writeFileSync(join(root, 'operator-source.txt'), 'preserve me');
      writeFileSync(join(bin, 'pnpm'), `#!/bin/sh
echo "$*" >> "$BOOT_LOG"
case "$*" in
  install*) [ "$BOOT_FAIL" != install ] || exit 12 ;;
  *prisma*) [ "$BOOT_FAIL" != prisma ] || exit 13 ;;
esac
exit 0
`, { mode: 0o755 });
      const result = spawnSync('sh', [fileURLToPath(new URL('./sandbox-entrypoint.sh', import.meta.url))], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DPF_SANDBOX_WORKSPACE_ROOT: root, BOOT_LOG: join(root, 'calls'), BOOT_FAIL: failure, DPF_SANDBOX_DEV_RESTART_LIMIT: '1' },
        encoding: 'utf8', timeout: 5000,
      });
      const calls = readFileSync(join(root, 'calls'), 'utf8').trim().split('\n');
      assert.match(calls[0], /^install .*--frozen-lockfile/);
      assert.equal(calls.includes('--filter web dev'), !failure);
      assert.equal(result.status, failure === 'install' ? 12 : failure === 'prisma' ? 13 : 0, result.stderr);
      if (!failure) assert.match(calls[1], /prisma generate/);
      assert.equal(readFileSync(join(root, 'operator-source.txt'), 'utf8'), 'preserve me');
      assert.equal(readFileSync(join(root, '.dpf-version'), 'utf8'), 'prior-source');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

// BI-B4F07CEB: the dev server crashed on a workspace refresh, and because it was
// the container's main process Docker restarted dpf-sandbox-1, killing every
// build's in-flight docker exec. The entrypoint now supervises it.
function bootFixture(devScript) {
  const root = mkdtempSync(join(tmpdir(), 'dpf-sandbox-supervise-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(root, '.dpf-version'), 'v');
  writeFileSync(join(bin, 'pnpm'), `#!/bin/sh
echo "$*" >> "$BOOT_LOG"
case "$*" in
  *"web dev"*) ${devScript} ;;
esac
exit 0
`, { mode: 0o755 });
  return { root, bin, log: join(root, 'calls') };
}
const entrypoint = fileURLToPath(new URL('./sandbox-entrypoint.sh', import.meta.url));
const devStarts = (log) => readFileSync(log, 'utf8').split('\n').filter((line) => line === '--filter web dev').length;

test('a crashed dev server is restarted inside the container instead of ending it', { skip: process.platform === 'win32' }, () => {
  const { root, bin, log } = bootFixture('exit 1');
  try {
    const result = spawnSync('sh', [entrypoint], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DPF_SANDBOX_WORKSPACE_ROOT: root, BOOT_LOG: log, DPF_SANDBOX_DEV_RESTART_LIMIT: '3', DPF_SANDBOX_DEV_RESTART_DELAY: '0' },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(devStarts(log), 3, result.stderr);
    assert.match(result.stderr, /dev server exited \(1\); restarting/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a container stop still ends the entrypoint and its dev server promptly', { skip: process.platform === 'win32' }, async () => {
  const { root, bin, log } = bootFixture('sleep 30');
  try {
    const { spawn } = await import('node:child_process');
    const child = spawn('sh', [entrypoint], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DPF_SANDBOX_WORKSPACE_ROOT: root, BOOT_LOG: log },
      stdio: 'ignore',
    });
    const started = Date.now();
    while (Date.now() - started < 8000) {
      try { if (devStarts(log) === 1) break; } catch { /* not yet written */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(devStarts(log), 1);
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    const stoppedAt = Date.now();
    child.kill('SIGTERM');
    const outcome = await exited;
    assert.ok(Date.now() - stoppedAt < 5000, 'the entrypoint must stop within the container stop grace');
    assert.ok(outcome.code === 143 || outcome.signal === 'SIGTERM', JSON.stringify(outcome));
    assert.equal(devStarts(log), 1, 'a stop must not restart the dev server');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('failed Postgres readiness removes the disposable container and its anonymous volume', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dpf-restore-cleanup-'));
  try {
    const log = join(dir, 'docker.log');
    writeFileSync(join(dir, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  run|rm) exit 0 ;;
  exec) if [ "$3" = pg_isready ]; then exit 42; fi ;;
esac
exit 99
`, { mode: 0o700 });
    // Keep the real readiness loop but skip its one-second delays.
    writeFileSync(join(dir, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const run = spawnSync('bash', [
      fileURLToPath(new URL('./build-synthetic-restore-artifact.sh', import.meta.url)),
      join(dir, 'out'),
    ], {
      encoding: 'utf8',
      timeout: 5000,
      env: { PATH: `${dir}:${process.env.PATH}`, DOCKER_LOG: log },
    });
    assert.ifError(run.error);
    assert.equal(run.status, 42, run.stderr);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    const container = calls[0].match(/^run -d --name (dpf-synthetic-restore-\d+) /)?.[1];
    assert.ok(container, calls[0]);
    assert.ok(calls.some((call) => call.startsWith(`exec ${container} pg_isready `)));
    const removals = calls.filter((call) => call.startsWith('rm '));
    assert.equal(removals.length, 1, removals.join('\n'));
    assert.ok(
      [`rm -fv ${container}`, `rm -f -v ${container}`].includes(removals[0]),
      `expected force and anonymous-volume cleanup, got: ${removals[0]}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

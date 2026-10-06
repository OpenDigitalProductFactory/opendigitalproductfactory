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
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DPF_SANDBOX_WORKSPACE_ROOT: root, BOOT_LOG: join(root, 'calls'), BOOT_FAIL: failure },
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

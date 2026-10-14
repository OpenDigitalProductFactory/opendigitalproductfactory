import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

for (const scenario of ['missing', 'matching', 'mismatch', 'npm-fails']) {
  test(`pnpm prerequisite: ${scenario}`, { skip: process.platform === 'win32' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dpf-pnpm-'));
    try {
      const bin = join(root, 'bin'); await mkdir(bin);
      await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2' }));
      await symlink(process.execPath, join(bin, 'node'));
      if (scenario === 'matching' || scenario === 'mismatch') {
        await writeFile(join(bin, 'pnpm'), `#!/bin/sh\necho ${scenario === 'matching' ? '10.33.2' : '9.0.0'}\n`, { mode: 0o700 });
      }
      await writeFile(join(bin, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$FIXTURE/calls"\n[ "$SCENARIO" != "npm-fails" ] || exit 1\nprintf "#!/bin/sh\\necho 10.33.2\\n" > "$FIXTURE/bin/pnpm"\nchmod 700 "$FIXTURE/bin/pnpm"\n', { mode: 0o700 });
      const result = spawnSync('/bin/bash', ['-c', '. "$1"; dpf_ensure_pnpm "$2"', 'test', fileURLToPath(new URL('./pnpm.sh', import.meta.url)), root], { encoding: 'utf8', env: { ...process.env, PATH: bin + ':/usr/bin:/bin', FIXTURE: root, SCENARIO: scenario } });
      assert.equal(result.status === 0, ['missing', 'matching'].includes(scenario), result.stderr);
      if (scenario === 'missing' || scenario === 'npm-fails') assert.equal(await readFile(join(root, 'calls'), 'utf8'), 'install\n-g\npnpm@10.33.2\n');
      else await assert.rejects(readFile(join(root, 'calls')), { code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('Ollama defaults to loopback while portal uses the Compose service', async () => {
  const compose = await readFile(new URL('../../../docker-compose.linux.yml', import.meta.url), 'utf8');
  assert.match(compose, /127\.0\.0\.1:11434:11434/);
  assert.match(compose, /http:\/\/ollama:11434/);
});

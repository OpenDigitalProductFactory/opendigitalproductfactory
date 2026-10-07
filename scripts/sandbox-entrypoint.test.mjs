import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, closeSync, fstatSync, mkdtempSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// BI-F1C680C7: the sandbox's own Auth.js secret. Compose no longer hands the
// container the portal's AUTH_SECRET; the entrypoint generates a sandbox-only
// one on the workspace volume and scopes it to the dev server's exec.
const SECRET_FILE = '.dpf-sandbox-auth-secret';
const HEX64 = /^[0-9a-f]{64}$/;
const entrypoint = fileURLToPath(new URL('./sandbox-entrypoint.sh', import.meta.url));

// A fake pnpm that records, per call, whether AUTH_SECRET reached it, and for
// the dev server also starts a grandchild the way any process it spawns would.
function bootFixture({ git = false, existingEnv = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dpf-sandbox-secret-'));
  const bin = join(root, 'bin');
  const workspace = join(root, 'ws');
  mkdirSync(bin);
  mkdirSync(workspace);
  if (git) mkdirSync(join(workspace, '.git'));
  writeFileSync(join(workspace, '.dpf-version'), 'prior-source');
  writeFileSync(join(bin, 'pnpm'), `#!/bin/sh
case "$*" in
  install*) tag=install ;;
  *prisma*) tag=prisma ;;
  *) tag=dev ;;
esac
printf '%s=%s\\n' "$tag" "\${AUTH_SECRET-<unset>}" >> "$BOOT_ENV_LOG"
exit 0
`, { mode: 0o755 });
  const run = (shellArgs = []) => {
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DPF_SANDBOX_WORKSPACE_ROOT: workspace, BOOT_ENV_LOG: join(root, 'env-log') };
    delete env.AUTH_SECRET;
    delete env.NEXTAUTH_SECRET;
    return spawnSync('sh', [...shellArgs, entrypoint], { env: { ...env, ...existingEnv }, encoding: 'utf8', timeout: 5000 });
  };
  const envLog = () => Object.fromEntries(readFileSync(join(root, 'env-log'), 'utf8').trim().split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
  const resetLog = () => writeFileSync(join(root, 'env-log'), '');
  return { root, workspace, run, envLog, resetLog, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('sandbox boot generates its own auth secret once, root-only, and reuses it on restart', { skip: process.platform === 'win32' }, () => {
  const fx = bootFixture();
  try {
    const first = fx.run();
    assert.equal(first.status, 0, first.stderr);
    const secretPath = join(fx.workspace, SECRET_FILE);
    // One open handle for both content and mode, so the check and the read
    // can never see two different files (CodeQL js/file-system-race).
    const fd = openSync(secretPath, 'r');
    let secret;
    let mode;
    try {
      secret = readFileSync(fd, 'utf8');
      mode = fstatSync(fd).mode;
    } finally { closeSync(fd); }
    assert.match(secret, HEX64, 'the secret is 32 random bytes, hex');
    assert.equal(mode & 0o777, 0o600, 'the secret file is mode 600');
    assert.deepEqual(readdirSync(fx.workspace).filter((name) => name.startsWith(`${SECRET_FILE}.`)), [], 'no temp file is left behind');

    fx.resetLog();
    const second = fx.run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(secretPath, 'utf8'), secret, 'a restart reuses the secret');
    assert.equal(fx.envLog().dev, secret, 'the dev server receives the persisted secret');
  } finally { fx.cleanup(); }
});

test('sandbox boot replaces a corrupt secret file atomically', { skip: process.platform === 'win32' }, () => {
  const fx = bootFixture();
  try {
    writeFileSync(join(fx.workspace, SECRET_FILE), 'not-a-secret\n');
    const result = fx.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(fx.workspace, SECRET_FILE), 'utf8'), HEX64);
  } finally { fx.cleanup(); }
});

test('the auth secret reaches only the dev server, never an earlier child, and is never printed, even under xtrace', { skip: process.platform === 'win32' }, () => {
  for (const shellArgs of [[], ['-x']]) {
    const fx = bootFixture();
    try {
      const result = fx.run(shellArgs);
      assert.equal(result.status, 0, result.stderr);
      const secret = readFileSync(join(fx.workspace, SECRET_FILE), 'utf8');
      const seen = fx.envLog();
      assert.equal(seen.dev, secret, 'the dev server gets the sandbox secret');
      assert.equal(seen.install, '<unset>', 'pnpm install must not inherit the secret: it is not exported');
      assert.equal(seen.prisma, '<unset>', 'prisma generate must not inherit the secret: it is not exported');
      const output = `${result.stdout}\n${result.stderr}`;
      assert.ok(!output.includes(secret), `the secret was printed (sh ${shellArgs.join(' ')})`);
    } finally { fx.cleanup(); }
  }
});

test('a stale inherited AUTH_SECRET never reaches the dev server', { skip: process.platform === 'win32' }, () => {
  // An install still on the old compose during the upgrade window: the dev
  // server must run on the sandbox's own secret, not the inherited value.
  const fx = bootFixture({ existingEnv: { AUTH_SECRET: 'stale-inherited-value' } });
  try {
    const result = fx.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fx.envLog().dev, readFileSync(join(fx.workspace, SECRET_FILE), 'utf8'));
  } finally { fx.cleanup(); }
});

test('a docker exec session, started from the container env, never sees the sandbox secret', { skip: process.platform === 'win32' }, () => {
  // `docker exec` starts a fresh process from the container's configured env,
  // not from PID 1's. Simulate it: after boot, a new shell started from the
  // same env the entrypoint was given must have no AUTH_SECRET at all.
  const fx = bootFixture();
  try {
    const containerEnv = { ...process.env };
    delete containerEnv.AUTH_SECRET;
    const boot = spawnSync('sh', [entrypoint], {
      env: { ...containerEnv, PATH: `${join(fx.root, 'bin')}:${process.env.PATH}`, DPF_SANDBOX_WORKSPACE_ROOT: fx.workspace, BOOT_ENV_LOG: join(fx.root, 'env-log') },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(boot.status, 0, boot.stderr);
    const execSession = spawnSync('sh', ['-c', 'printf %s "${AUTH_SECRET-<unset>}"'], { env: containerEnv, encoding: 'utf8' });
    assert.equal(execSession.stdout, '<unset>');
    // And the entrypoint itself declares no global export of it.
    const script = readFileSync(entrypoint, 'utf8');
    assert.doesNotMatch(script, /^\s*export\s+AUTH_SECRET\b/m);
    const assignments = script.split('\n').filter((line) => !/^\s*#/.test(line) && /\bAUTH_SECRET=/.test(line));
    assert.deepEqual(assignments, ['exec env AUTH_SECRET="$(cat "$secret_file")" pnpm --filter web dev'], 'AUTH_SECRET is only ever set by env(1) on the final exec');
  } finally { fx.cleanup(); }
});

test('sandbox boot keeps the secret out of git and fails clearly when the workspace is read-only', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const fx = bootFixture({ git: true });
  try {
    const ok = fx.run();
    assert.equal(ok.status, 0, ok.stderr);
    const exclude = readFileSync(join(fx.workspace, '.git/info/exclude'), 'utf8').split('\n');
    assert.equal(exclude.filter((line) => line === SECRET_FILE).length, 1, 'the secret is excluded from git exactly once');
    assert.equal(fx.run().status, 0);
    assert.equal(readFileSync(join(fx.workspace, '.git/info/exclude'), 'utf8').split('\n').filter((line) => line === SECRET_FILE).length, 1, 'a restart does not duplicate the exclude');

    rmSync(join(fx.workspace, SECRET_FILE));
    chmodSync(fx.workspace, 0o555);
    fx.resetLog();
    const denied = fx.run();
    chmodSync(fx.workspace, 0o755);
    assert.equal(denied.status, 14);
    assert.match(denied.stderr, /is not writable \(BI-F1C680C7\)/);
    assert.equal(readFileSync(join(fx.root, 'env-log'), 'utf8'), '', 'no pnpm step runs without a secret');
  } finally { chmodSync(fx.workspace, 0o755); fx.cleanup(); }
});

test('the repository .gitignore, copied into the sandbox workspace at bootstrap, ignores the secret', () => {
  const gitignore = readFileSync(fileURLToPath(new URL('../.gitignore', import.meta.url)), 'utf8').split(/\r?\n/);
  assert.ok(gitignore.includes(SECRET_FILE), `.gitignore must list ${SECRET_FILE}`);
});

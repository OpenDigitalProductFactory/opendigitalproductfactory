#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Executed as the pinned image's non-root user, inside its existing CA volume.
// The upstream first-init entrypoint prints a password; never send its output
// to a container log. A completed config means normal service startup skips it.
export const stagingScript = `set -eu
umask 077
test ! -L "$STEPPATH/secrets"
mkdir -p "$STEPPATH/secrets"
target="$STEPPATH/secrets/password"
lock="$STEPPATH/secrets/.dpf-password-stage.lock"
mkdir "$lock" || exit 75
trap 'rm -f "$lock/input"; rmdir "$lock"' EXIT
cat > "$lock/input"
test ! -L "$target"
if [ -e "$target" ]; then
  test -f "$target"
  test "$(cat "$target")" = "$(cat "$lock/input")" || exit 78
else
  # A configured CA with a missing password is recovery, never fresh init.
  test ! -f "$STEPPATH/config/ca.json" || exit 78
  mv "$lock/input" "$target"
fi
chmod 0600 "$target"
bash "$1" true >/dev/null 2>&1
test -f "$STEPPATH/config/ca.json"
`;

export async function stageCaPassword(passwordFile, composeArgs, run = spawnSync) {
  const info = await lstat(passwordFile);
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('ca_password_file_not_private');
  const password = (await readFile(passwordFile, 'utf8')).replace(/\r?\n$/, '');
  // Preserve operator-provisioned passwords, including meaningful spaces.
  if (!password || /[\r\n\0]/.test(password) || Buffer.byteLength(password) > 4096) throw new Error('ca_password_file_invalid');
  const result = run('docker', ['compose', ...composeArgs, 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', 'step-ca', '-c', stagingScript, 'dpf-stage', '/entrypoint.sh'], { input: Buffer.from(password + '\n'), encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error('ca_password_staging_failed:verify CA volume custody and matching host password; no rotation performed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [passwordFile, ...composeArgs] = process.argv.slice(2);
    if (!passwordFile) throw new Error('ca_password_file_required');
    await stageCaPassword(passwordFile, composeArgs);
  } catch (error) { console.error(error.message.startsWith('ca_') ? error.message : 'ca_password_staging_failed'); process.exitCode = 78; }
}

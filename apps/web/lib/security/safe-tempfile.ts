// apps/web/lib/security/safe-tempfile.ts
//
// Cryptographically-random temp file paths (closes CodeQL
// js/insecure-temporary-file). The unsafe pattern is constructing a
// path from a predictable value such as `Date.now()`, `process.pid`,
// or an incrementing counter:
//
//     const tmpFile = `/tmp/dpf-backup-${Date.now()}.patch`;
//     await writeFile(tmpFile, data);
//
// On a shared-tmp host (the default on Linux), an attacker who can
// write to /tmp can pre-create that path as a symlink to /etc/passwd
// (or any other target). The subsequent writeFile follows the symlink
// and clobbers the target.
//
// Two safe alternatives, both in this module:
//
//   1. `secureTempPath(prefix, ext)` — returns a /tmp/<prefix>-<uuid>.<ext>
//      string with 122 bits of entropy in the suffix. Use when you need
//      a path (e.g. to hand to `git apply` as a CLI arg).
//
//   2. `withSecureTempDir(prefix, fn)` — wraps `fs.mkdtemp()` which
//      creates a unique directory atomically with 0700 perms. Use when
//      you need to write multiple files or care about parent-dir perms.
//      Auto-cleans on completion (success or throw).
//
// Both use `crypto.randomUUID()` / `fs.mkdtemp()` which are CodeQL-
// recognised safe constructors for temp paths.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Build a temp-file path in the OS temp dir using a cryptographically
 * random UUID suffix. The returned path has not been touched on disk —
 * the caller is responsible for writing to it.
 *
 * @param prefix  Short label included in the filename for debuggability
 *                (e.g. "dpf-backup"). Must contain only safe filename
 *                chars; not validated here, the caller passes a constant.
 * @param ext     Optional extension WITHOUT the leading dot (e.g. "patch").
 * @returns       Absolute path under os.tmpdir().
 */
export function secureTempPath(prefix: string, ext?: string): string {
  const name = ext ? `${prefix}-${randomUUID()}.${ext}` : `${prefix}-${randomUUID()}`;
  return join(tmpdir(), name);
}

/**
 * Create a unique temp directory (0700 perms, atomic against races) and
 * run the callback with its path. Always cleans up the directory after
 * the callback returns or throws.
 *
 * @param prefix  Short label included in the dir name (e.g. "dpf-pr").
 * @param fn      Callback receiving the absolute dir path. Anything the
 *                callback wrote inside the dir is removed afterwards.
 */
export async function withSecureTempDir<T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  // mkdtemp atomically creates a unique 0700 dir. The trailing hyphen
  // ensures the random suffix is separated from `prefix` in the
  // resulting path.
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
const fail = code => { throw new Error(`offline_recovery_kit_${code}`); };
const trustedOwner = stat => stat.uid === 0 || stat.uid === process.getuid();
const MAX_BYTES = 65536;

export async function protectedDirectory(path) {
  if (typeof path !== "string" || !isAbsolute(path)) fail("directory");
  const original = await lstat(path).catch(() => null);
  if (!original?.isDirectory() || original.isSymbolicLink()) fail("directory");
  if (!trustedOwner(original) || (original.mode & 0o077) !== 0) fail("permissions");
  // Inspect the original traversal as well as its resolved destination. A
  // symlink must not erase an unsafe ancestor from the trust decision.
  const pending = path.split(sep).filter(Boolean);
  let at = sep; let hops = 0;
  while (pending.length) {
    const part = pending.shift();
    if (part === "..") fail("directory");
    if (part === ".") continue;
    const next = join(at, part);
    const stat = await lstat(next);
    if (!trustedOwner(stat)) fail("permissions");
    if (stat.isSymbolicLink()) {
      if (++hops > 40) fail("directory");
      const target = await readlink(next);
      pending.unshift(...target.split(sep).filter(Boolean));
      if (isAbsolute(target)) at = sep;
      continue;
    }
    if (!stat.isDirectory()
      || ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000)))) fail("permissions");
    at = next;
  }
  const canonical = await realpath(path);
  const current = await lstat(canonical);
  if (canonical !== at || current.dev !== original.dev || current.ino !== original.ino
    || !current.isDirectory() || !trustedOwner(current) || (current.mode & 0o077) !== 0) fail("changed");
  return canonical;
}

export async function protectedRead(path) {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { fail("file"); }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) fail("file");
    if (!trustedOwner(before) || (before.mode & 0o077) !== 0) fail("permissions");
    if (before.size < 1 || before.size > MAX_BYTES) fail("size");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count !== before.size || count > MAX_BYTES) fail("changed");
    const after = await handle.stat();
    const current = await lstat(path).catch(() => null);
    if (!current?.isFile() || current.isSymbolicLink()
      || [after, current].some(stat => stat.dev !== before.dev || stat.ino !== before.ino
        || stat.size !== before.size || stat.mtimeMs !== before.mtimeMs
        || stat.ctimeMs !== before.ctimeMs || stat.nlink !== 1)) fail("changed");
    return buffer.subarray(0, count);
  } finally { await handle.close(); }
}


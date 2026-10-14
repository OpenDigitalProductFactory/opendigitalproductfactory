import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { canonicalJson } from "../lib/canonical-json.mjs";
import { verifyOfflineRecoveryAuthority } from "./offline-recovery-authority.mjs";

const fail = code => { throw new Error(`offline_recovery_kit_${code}`); };
const trustedOwner = stat => stat.uid === 0 || stat.uid === process.getuid();
const MAX_BYTES = 65536;

async function protectedDirectory(path) {
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

async function protectedRead(path) {
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

function parse(bytes, code) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = JSON.parse(text);
    if (canonicalJson(value) !== text) fail(code);
    return value;
  } catch { fail(code); }
}

/**
 * Read-only POSIX adapter. trustFile is an administrator-configured enrollment
 * path outside the portable kit, not a path obtained from that kit. This loads
 * existing enrollment; it does not enroll keys, advance epochs or grant a lock.
 * The runtime adapter must provide observed identity and revalidate under its
 * exclusive apply lock. Windows requires a real ACL adapter, not mode-bit trust.
 */
export async function loadOfflineRecoveryKit({ kitDirectory, trustFile, observed, nowMs }) {
  if (process.platform === "win32" || typeof process.getuid !== "function"
    || !constants.O_NOFOLLOW) fail("permissions_unavailable");
  if (typeof trustFile !== "string" || !isAbsolute(trustFile)) fail("trust_location");
  const kit = await protectedDirectory(kitDirectory);
  const trustParent = await protectedDirectory(dirname(trustFile));
  const trustPath = join(trustParent, basename(trustFile));
  const kitIdentity = await lstat(kit);
  const trustIdentity = await lstat(trustParent);
  const fromKit = relative(kit, trustPath);
  if (fromKit === "" || (!fromKit.startsWith(`..${sep}`) && fromKit !== ".." && !isAbsolute(fromKit))) fail("trust_location");
  const enrollment = parse(await protectedRead(trustPath), "enrollment");
  const names = ["version", "installationId", "minimumTrustEpoch", "trustedKeyFingerprints"];
  if (!enrollment || Array.isArray(enrollment) || Object.keys(enrollment).length !== names.length
    || !names.every(name => Object.hasOwn(enrollment, name)) || enrollment.version !== 1
    || enrollment.installationId !== observed?.installationId
    || !Number.isSafeInteger(enrollment.minimumTrustEpoch) || enrollment.minimumTrustEpoch < 1) fail("enrollment");
  const inputs = {};
  for (const name of ["manifest.json", "manifest-signatures.json", "envelope.json", "envelope-signatures.json"]) {
    inputs[name] = await protectedRead(join(kit, name));
  }
  const result = verifyOfflineRecoveryAuthority({
    manifestBytes: inputs["manifest.json"], manifestSignatures: parse(inputs["manifest-signatures.json"], "signatures"),
    envelopeBytes: inputs["envelope.json"], envelopeSignatures: parse(inputs["envelope-signatures.json"], "signatures"),
    trustedKeyFingerprints: enrollment.trustedKeyFingerprints,
    minimumTrustEpoch: enrollment.minimumTrustEpoch, observed, nowMs,
  });
  // Refuse path replacement during the multi-file read. Runtime execution
  // separately revalidates all observations under exclusive ownership.
  for (const [originalPath, canonical, identity] of [[kitDirectory, kit, kitIdentity], [dirname(trustFile), trustParent, trustIdentity]]) {
    if (await protectedDirectory(originalPath) !== canonical) fail("changed");
    const current = await lstat(canonical);
    if (current.dev !== identity.dev || current.ino !== identity.ino) fail("changed");
  }
  return result;
}

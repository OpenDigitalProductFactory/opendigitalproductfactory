import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rmdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../lib/canonical-json.mjs";
import { readProcessIdentity } from "../lib/local-sandbox-fence.mjs";
import { protectedDirectory, protectedRead } from "./recovery-filesystem.mjs";

const fail = code => { throw new Error(`runtime_apply_lock_${code}`); };
const sameDirectory = (a, b) => a.dev === b.dev && a.ino === b.ino;

/**
 * Whole-operation exclusion using the existing apply-lock pathname. Never
 * reclaims an existing directory: expiry or owner death cannot prove that its
 * descendants and daemon-side effects settled. The execution supervisor must
 * settle those effects before releasing; crash reconciliation is separate.
 * Acquire this boundary before any install-state transaction lock.
 */
export async function acquireRuntimeApplyLock({ stateDirectory, runId }) {
  if (process.platform === "win32") fail("permissions_unavailable");
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(runId)) fail("run_id");
  const directory = await protectedDirectory(stateDirectory);
  const directoryIdentity = await lstat(directory);
  const processIdentity = readProcessIdentity(process.pid);
  if (!processIdentity) fail("identity_unavailable");
  const path = join(directory, ".runtime-transition-apply.lock");
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error.code === "EEXIST") fail("contended"); throw error; }
  // If owner persistence fails, retain the directory as an uncertain operation.
  // A competing caller must not erase an ownerless claim after a partial write.
  const identity = await lstat(path);
  const owner = Object.freeze({ protocolVersion: 2, token: randomUUID(), runId,
    pid: process.pid, processIdentity, host: hostname(), acquiredAt: new Date().toISOString() });
  const ownerPath = join(path, "owner.json");
  const file = await open(ownerPath, "wx", 0o600);
  try { await file.writeFile(canonicalJson(owner)); await file.sync(); }
  finally { await file.close(); }
  for (const target of [path, directory]) {
    const handle = await open(target, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  let released = false;
  const owned = async () => {
    if (readProcessIdentity(process.pid) !== owner.processIdentity) return false;
    try {
      if (await protectedDirectory(stateDirectory) !== directory
        || !sameDirectory(await lstat(directory), directoryIdentity)
        || await protectedDirectory(path) !== path
        || !sameDirectory(await lstat(path), identity)) return false;
      return (await protectedRead(ownerPath)).toString("utf8") === canonicalJson(owner);
    } catch { return false; }
  };
  if (!await owned()) fail("not_owned");
  return Object.freeze({ path, owner,
    async assertOwned() { if (released || !await owned()) fail("not_owned"); },
    async release() {
      if (released) return false;
      released = true;
      if (!await owned()) return false;
      // No recursive deletion: unexpected children keep the boundary closed.
      await unlink(ownerPath);
      await rmdir(path);
      return true;
    },
  });
}

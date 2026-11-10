import { lstat, mkdir, open } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { protectedDirectory } from "./recovery-filesystem.mjs";
import { readVerifiedOfflineRecoveryKit, loadOfflineRecoveryKit } from "./offline-recovery-kit.mjs";

const fail = code => { throw new Error(`offline_recovery_kit_prepare_${code}`); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;

/** Copy exact verified public authority files; never enroll or copy trust pins.
 * Existing and partial destinations are preserved, not replaced or cleaned up.
 * An incomplete directory is not executable: the loader requires every signed
 * file. Image assets, runtime observation and execution remain separate steps.
 */
export async function prepareOfflineRecoveryKit({ destination, ...source }) {
  if (typeof destination !== "string" || !isAbsolute(destination)
    || ["", ".", ".."].includes(basename(destination))) fail("destination");
  const parent = await protectedDirectory(dirname(destination));
  const parentIdentity = await lstat(parent);
  // Verify exact captured bytes before writing anything, including malformed
  // private material disguised as a public key. Do not re-read source files.
  const { result, files } = await readVerifiedOfflineRecoveryKit(source);
  const target = join(parent, basename(destination));
  if (await protectedDirectory(dirname(destination)) !== parent
    || !same(await lstat(parent), parentIdentity)) fail("changed");
  await mkdir(target, { mode: 0o700 }); // create-new: never replace an existing kit
  const identity = await lstat(target);
  const unchanged = async () => {
    if (await protectedDirectory(dirname(destination)) !== parent
      || !same(await lstat(parent), parentIdentity)
      || await protectedDirectory(target) !== target
      || !same(await lstat(target), identity)) fail("changed");
  };
  // Signatures last: incomplete artifacts are rejected by normal loading.
  // A late write/sync failure can leave a complete, valid kit. Preserve it;
  // preparation failure is not evidence that no usable artifact exists.
  for (const name of ["manifest.json", "envelope.json", "manifest-signatures.json", "envelope-signatures.json"]) {
    await unchanged();
    const file = await open(join(target, name), "wx", 0o600);
    try { await file.writeFile(files[name]); await file.sync(); }
    finally { await file.close(); }
  }
  await unchanged();
  for (const directory of [target, parent]) {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  const prepared = await loadOfflineRecoveryKit({ ...source, kitDirectory: target });
  await unchanged();
  if (prepared.envelopeDigest !== result.envelopeDigest || prepared.manifestDigest !== result.manifestDigest) fail("changed");
  return { ...prepared, kitDirectory: target };
}

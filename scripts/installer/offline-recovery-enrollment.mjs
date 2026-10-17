import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { canonicalJson } from "../lib/canonical-json.mjs";
import { protectedDirectory, protectedRead } from "./recovery-filesystem.mjs";
import { verifyOfflineRecoveryTrust } from "./offline-recovery-authority.mjs";

const fail = code => { throw new Error(`offline_recovery_enrollment_${code}`); };

/** Healthy-install bootstrap only. An administrator supplies separately witnessed
 * public fingerprints; this API neither derives pins from a kit nor handles
 * private keys. Existing/partial files are preserved. Rotation and epoch advance
 * need the shared-writer protocol and are deliberately not provided here.
 */
export async function enrollOfflineRecoveryAuthority({ destination, ...authority }) {
  if (process.platform === "win32" || typeof process.getuid !== "function"
    || !constants.O_NOFOLLOW) fail("permissions_unavailable");
  if (typeof destination !== "string" || !isAbsolute(destination)
    || ["", ".", ".."].includes(basename(destination))) fail("destination");
  const parent = await protectedDirectory(dirname(destination));
  const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const identity = await directory.stat();
    // Verify both signatures and exact key pins before the first write. Epoch 1
    // is the floor only for a create-new enrollment, never an update/downgrade.
    const trust = verifyOfflineRecoveryTrust({ ...authority, minimumTrustEpoch: 1 });
    const bytes = Buffer.from(canonicalJson({ version: 1,
      installationId: trust.manifest.installationId, minimumTrustEpoch: trust.trustEpoch,
      trustedKeyFingerprints: authority.trustedKeyFingerprints }));
    const unchanged = async () => {
      const current = await lstat(parent);
      if (await protectedDirectory(dirname(destination)) !== parent
        || current.dev !== identity.dev || current.ino !== identity.ino) fail("changed");
    };
    await unchanged();
    const target = join(parent, basename(destination));
    const file = await open(target, "wx", 0o600);
    let fileIdentity;
    try { await file.writeFile(bytes); fileIdentity = await file.stat(); await file.sync(); }
    finally { await file.close(); }
    const sameFile = async () => {
      const current = await lstat(target);
      if (!current.isFile() || current.dev !== fileIdentity.dev
        || current.ino !== fileIdentity.ino || current.nlink !== 1) fail("changed");
    };
    await unchanged();
    await sameFile();
    if (!(await protectedRead(target)).equals(bytes)) fail("changed");
    await directory.sync();
    await unchanged();
    await sameFile();
    return { trustFile: target, trustEpoch: trust.trustEpoch,
      manifestDigest: trust.manifestDigest };
  } finally { await directory.close(); }
}

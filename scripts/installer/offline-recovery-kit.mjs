import { constants } from "node:fs";
import { lstat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { protectedDirectory, protectedRead } from "./recovery-filesystem.mjs";
import { canonicalJson } from "../lib/canonical-json.mjs";
import { verifyOfflineRecoveryAuthority } from "./offline-recovery-authority.mjs";

const fail = code => { throw new Error(`offline_recovery_kit_${code}`); };

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
export async function readVerifiedOfflineRecoveryKit({ kitDirectory, trustFile, observed, nowMs }) {
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
  return { result, files: inputs };
}

export async function loadOfflineRecoveryKit(options) {
  return (await readVerifiedOfflineRecoveryKit(options)).result;
}

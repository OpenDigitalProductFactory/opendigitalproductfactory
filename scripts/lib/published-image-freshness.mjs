// Decide whether a PUBLISHED image is too stale to serve the consumer install path.
//
// Background: `dpf-portal:latest` sat 1851 commits behind `main` for roughly seven
// weeks. The "Ready to go" installer does
//   docker cp <container>:/dpf-release-assets/. <staging>
// and that directory is only present in images built after 1c157563a (2026-07-18).
// Every non-technical user's install failed with
// `consumer_release_asset_export_failed` for that whole period, and nothing noticed.
//
// Nothing noticed because nothing *looked*. The image already records the commit it
// was built from at /app/.dpf-image-version (the DPF_VERSION build-arg), and
// AGENTS.md section 12 already requires that identity — but no check compared the
// published stamp to the branch.
//
// This module is the pure decision half so it can be unit-tested without Docker, a
// network, or a registry credential. The IO half lives in
// scripts/check-published-image-freshness.mjs.

/**
 * Paths whose change makes an old published image *incompatible*, not merely old.
 * A change here alters the contract between the installer and the image it pulls.
 */
export const RELEASE_CONTRACT_PATHS = Object.freeze([
  "Dockerfile",
  "install-dpf.ps1",
  "install-dpf.sh",
  "docker-compose.yml",
  "docker-compose.release.yml",
]);

export const FRESHNESS_VERDICTS = Object.freeze({
  OK: "ok",
  UNKNOWN: "unknown",
  STALE: "stale",
  INCOMPATIBLE: "incompatible",
});

/**
 * @param {object} input
 * @param {string|null} input.publishedSha        commit the published image was built from
 * @param {string|null} input.headSha             current tip of the release branch
 * @param {boolean} input.publishedShaIsAncestor  is publishedSha reachable from headSha?
 * @param {string[]} input.contractPathsChangedSince
 *        release-contract paths modified between publishedSha and headSha
 * @param {number} input.commitsBehind
 * @param {number} [input.maxCommitsBehind=250]   advisory drift ceiling
 * @returns {{verdict: string, blocking: boolean, reason: string}}
 */
export function evaluatePublishedImageFreshness({
  publishedSha,
  headSha,
  publishedShaIsAncestor,
  contractPathsChangedSince,
  commitsBehind,
  maxCommitsBehind = 250,
}) {
  if (!publishedSha) {
    return {
      verdict: FRESHNESS_VERDICTS.UNKNOWN,
      blocking: true,
      reason:
        "the published image carries no source stamp at /app/.dpf-image-version, so its " +
        "identity cannot be established (AGENTS.md section 12: an image carries the identity " +
        "of its bytes)",
    };
  }

  if (!publishedShaIsAncestor) {
    return {
      verdict: FRESHNESS_VERDICTS.UNKNOWN,
      blocking: true,
      reason:
        `the published image was built from ${short(publishedSha)}, which is not an ancestor ` +
        `of ${short(headSha)} — it was built from a branch that is not in the release line`,
    };
  }

  const changed = [...new Set(contractPathsChangedSince ?? [])].sort();
  if (changed.length > 0) {
    return {
      verdict: FRESHNESS_VERDICTS.INCOMPATIBLE,
      blocking: true,
      reason:
        `release-contract path(s) changed since the published image was built ` +
        `(${short(publishedSha)}): ${changed.join(", ")}. The installer may now depend on an ` +
        `artifact the published image does not contain — this is exactly the shape of the ` +
        `consumer_release_asset_export_failed outage. Republish before shipping.`,
    };
  }

  if (commitsBehind > maxCommitsBehind) {
    return {
      verdict: FRESHNESS_VERDICTS.STALE,
      blocking: true,
      reason:
        `the published image is ${commitsBehind} commits behind (ceiling ${maxCommitsBehind}). ` +
        `No release-contract path changed, so it should still install, but this much drift ` +
        `means the release pipeline has not run successfully in a long time.`,
    };
  }

  return {
    verdict: FRESHNESS_VERDICTS.OK,
    blocking: false,
    reason: `published image is ${commitsBehind} commit(s) behind and no release-contract path changed`,
  };
}

function short(sha) {
  return typeof sha === "string" && sha.length >= 9 ? sha.slice(0, 9) : String(sha);
}

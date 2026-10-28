// Resolve the engine's id for a pulled release image from its frozen registry
// digests (BI-A9BA9583, BI-578131A3).
//
// Docker names a pulled image differently by image store: the classic store
// uses the image CONFIG digest, the containerd store (the Docker Desktop
// default) uses the INDEX (channel) digest it was pulled by. Anything that hands
// `docker run --pull never` a release digest must pass the id this returns,
// never the config digest directly. That assumption broke SUR-F2A0D477.
//
// Dependency-free on purpose: scripts/release-image-reference.docker.test.mjs
// imports it under plain Node against a real daemon on both image stores.

export type ImageInspectRunner = (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export type ReleaseImageDigests = { configDigest: string; channelDigest: string; platformManifestDigest: string };

/** `image` is null when no frozen reference resolved; `attempts` says why for each. */
export type ReleaseImageResolution = { image: { ref: string; id: string } | null; attempts: string[] };

/** Inspect only immutable references (never a tag) and accept an id only when
 * it is one of the frozen digests, the rule scripts/promote.sh applies. */
export async function resolvePulledReleaseImage(
  runDocker: ImageInspectRunner, repository: string, release: ReleaseImageDigests,
): Promise<ReleaseImageResolution> {
  const frozen = new Set([release.configDigest, release.channelDigest, release.platformManifestDigest]);
  const attempts: string[] = [];
  for (const ref of [release.configDigest, `${repository}@${release.channelDigest}`, `${repository}@${release.platformManifestDigest}`]) {
    const result = await runDocker(["image", "inspect", "--format", "{{.Id}}", ref]);
    const id = result.stdout.trim();
    if (result.exitCode === 0 && frozen.has(id)) return { image: { ref, id }, attempts };
    attempts.push(`${ref} -> ${result.exitCode === 0 ? `foreign id ${id || "(empty)"}` : (result.stderr.trim() || `exit ${result.exitCode}`).slice(0, 120)}`);
  }
  return { image: null, attempts };
}

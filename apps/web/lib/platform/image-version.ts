import { readFile } from "node:fs/promises";

const IMAGE_VERSION_PATH = "/app/.dpf-image-version";

export type ImageVersionSource = "git-sha" | "content-hash" | "unknown";

export type ImageVersion = {
  raw: string;
  source: ImageVersionSource;
};

/**
 * Read the image version that was baked into the running portal image at
 * build time by the Dockerfile (see /app/.dpf-image-version).
 *
 * When `DPF_VERSION` was passed as a build-arg, the file contains that exact
 * string — by convention a full 40-char git SHA when built via
 * scripts/build-images.{ps1,sh}. When `DPF_VERSION` was unset, the Dockerfile
 * falls back to a sha256 content hash of the bundled source so two builds
 * from divergent source trees are still distinguishable.
 *
 * Returns `null` if the file is absent — which happens in non-container
 * environments (next dev, vitest, etc.) and is the only correct signal that
 * "this isn't a built image."
 */
export async function readImageVersion(
  path: string = IMAGE_VERSION_PATH,
): Promise<ImageVersion | null> {
  try {
    const raw = (await readFile(path, "utf-8")).trim();
    if (!raw) return null;
    return { raw, source: classifyImageVersion(raw) };
  } catch {
    return null;
  }
}

const SOURCE_CONTENT_HASH_PATH = "/app/.dpf-source-content-hash";

/**
 * Read the source content hash baked into the running portal image by the
 * Dockerfile (see /app/.dpf-source-content-hash). This is a sha256 over the
 * bundled source bytes, computed ALWAYS — independent of the DPF_VERSION label.
 *
 * It is the honest fingerprint of what actually went into the image: the
 * self-upgrade promoter compares it between the freshly built image and the
 * recreated container, and surfacing it next to gitSha lets operators detect a
 * label/source divergence (the BI-C8E90A79 failure mode). Returns null when the
 * marker is absent — non-container environments (next dev, vitest) and images
 * built before this marker existed.
 */
export async function readSourceContentHash(
  path: string = SOURCE_CONTENT_HASH_PATH,
): Promise<string | null> {
  try {
    const raw = (await readFile(path, "utf-8")).trim();
    return raw || null;
  } catch {
    return null;
  }
}

const IMAGE_BUILT_AT_PATH = "/app/.dpf-image-built-at";

/**
 * Read the build timestamp baked into the running portal image by the
 * Dockerfile (see /app/.dpf-image-built-at). ISO-8601 UTC. Returns null when
 * the marker is absent — non-container environments (next dev, vitest) and
 * images built before this marker existed.
 */
export async function readImageBuiltAt(
  path: string = IMAGE_BUILT_AT_PATH,
): Promise<string | null> {
  try {
    const raw = (await readFile(path, "utf-8")).trim();
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * Classify the version string by shape. A 40-char hex string is treated as a
 * git SHA; a 64-char hex string is treated as a sha256 content hash. Anything
 * else (a release tag like `v0.4.2`, a CI run id) is reported as "unknown" so
 * callers can decide whether to display it verbatim or skip comparison.
 */
export function classifyImageVersion(raw: string): ImageVersionSource {
  if (/^[0-9a-f]{40}$/i.test(raw)) return "git-sha";
  if (/^[0-9a-f]{64}$/i.test(raw)) return "content-hash";
  return "unknown";
}

export type ImageVersionComparison = {
  match: boolean;
  reason: "match" | "drift" | "incomparable-source" | "missing";
};

/**
 * Compare a built image's version to an expected git SHA. Only git-sha sources
 * are comparable; a content-hash source returns `incomparable-source` because
 * there is no on-the-fly way to recompute the hash from a checkout.
 */
export function compareImageVersionToSha(
  image: ImageVersion | null,
  expectedSha: string,
): ImageVersionComparison {
  if (!image) return { match: false, reason: "missing" };
  if (image.source !== "git-sha") {
    return { match: false, reason: "incomparable-source" };
  }
  return image.raw.toLowerCase() === expectedSha.toLowerCase()
    ? { match: true, reason: "match" }
    : { match: false, reason: "drift" };
}

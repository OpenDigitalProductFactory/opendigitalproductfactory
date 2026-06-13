// On-demand responsive renditions for media assets.
//
// GET /api/media/:id?w=320 asks for a width-constrained copy. We resize once with
// sharp (if it's present in the runtime), cache the result on disk next to the
// content-addressed original, and serve the cache thereafter. sharp is imported
// lazily inside a try/catch so a runtime without it (or a resize failure) simply
// degrades to serving the original — no hard dependency, no 500s.

import { lazyFsPromises, lazyPath } from "../shared/lazy-node";
import { getMediaStorageDriver, getMediaStorageRoot } from "./media-storage";

// Allowed target widths — a small fixed ladder keeps the cache bounded and makes
// srcset predictable. Requests for other widths snap to the nearest larger rung.
export const RENDITION_WIDTHS = [160, 320, 640, 960, 1280] as const;

export function normalizeRenditionWidth(requested: number | null): number | null {
  if (!requested || !Number.isFinite(requested) || requested <= 0) return null;
  for (const w of RENDITION_WIDTHS) {
    if (requested <= w) return w;
  }
  return RENDITION_WIDTHS[RENDITION_WIDTHS.length - 1];
}

function renditionStorageKey(sha256: string, width: number): string {
  // Mirrors the original's sharded layout, under a renditions/ prefix.
  return `media/renditions/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}/w${width}.webp`;
}

export type Rendition = { bytes: Buffer; mimeType: string };

/**
 * Return a cached/resized webp rendition at `width`, or null to signal the caller
 * should serve the original (sharp missing, resize failed, or width invalid).
 */
export async function getRendition(input: {
  sha256: string;
  storageKey: string;
  storageDriver: string;
  width: number;
}): Promise<Rendition | null> {
  const width = normalizeRenditionWidth(input.width);
  if (!width) return null;

  const fs = lazyFsPromises();
  const path = lazyPath();
  let root: string;
  try {
    root = await getMediaStorageRoot();
  } catch {
    return null;
  }
  const key = renditionStorageKey(input.sha256, width);
  const absolute = path.join(root, key);

  // Serve from cache if present.
  try {
    const cached = await fs.readFile(absolute);
    return { bytes: cached, mimeType: "image/webp" };
  } catch {
    // not cached yet
  }

  // Resize with sharp, lazily. Any failure → null (serve original).
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    return null;
  }

  let original: Buffer;
  try {
    original = await getMediaStorageDriver(input.storageDriver).get(input.storageKey);
  } catch {
    return null;
  }

  let resized: Buffer;
  try {
    resized = await sharp(original)
      .rotate() // honour EXIF orientation
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }

  // Cache atomically; a write failure is non-fatal (we still return the bytes).
  try {
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const tmp = `${absolute}.${process.pid}.tmp`;
    await fs.writeFile(tmp, resized);
    await fs.rename(tmp, absolute);
  } catch {
    // ignore cache write failures
  }

  return { bytes: resized, mimeType: "image/webp" };
}

// Content-addressed media blob storage.
//
// Mirrors the proven document blob store (apps/web/lib/documents/blob-storage.ts)
// — SHA-256 content addressing, atomic temp-then-rename, dedup on existing hash —
// but under a `media/sha256/...` prefix and behind a pluggable driver interface so
// an S3/GCS backend can slot in later without touching callers (kernel:
// no-provider-pinning; the platform stays self-hostable on the filesystem default).

import { prisma } from "@dpf/db";
import { lazyCrypto, lazyFsPromises, lazyPath } from "../shared/lazy-node";

export const MEDIA_BLOB_PREFIX = "media/sha256";

export type MediaBlobContent = Buffer | Uint8Array;

export type MediaBlobWriteResult = {
  sha256: string;
  storageKey: string;
  sizeBytes: number;
};

function toBuffer(content: MediaBlobContent): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content);
}

export function hashMediaBlobContent(content: MediaBlobContent): string {
  return lazyCrypto().createHash("sha256").update(toBuffer(content)).digest("hex");
}

export function buildMediaBlobStorageKey(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("Media blob storage keys require a lowercase SHA-256 hash.");
  }
  return `${MEDIA_BLOB_PREFIX}/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

async function getMediaStorageRoot(): Promise<string> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "upload_storage_path" },
    select: { value: true },
  });
  const configured =
    config && typeof config.value === "string" && config.value.trim().length > 0
      ? config.value
      : undefined;
  const root = configured ?? process.env.UPLOAD_STORAGE_PATH ?? "./data/uploads";
  return lazyPath().resolve(process.cwd(), root);
}

/**
 * Storage backend. The filesystem driver is the default; an S3/GCS driver can
 * implement the same three methods and be selected by `MediaAsset.storageDriver`.
 */
export interface MediaStorageDriver {
  readonly name: string;
  put(content: MediaBlobContent): Promise<MediaBlobWriteResult>;
  get(storageKey: string): Promise<Buffer>;
}

class FilesystemMediaDriver implements MediaStorageDriver {
  readonly name = "filesystem";

  async put(content: MediaBlobContent): Promise<MediaBlobWriteResult> {
    const buffer = toBuffer(content);
    const sha256 = hashMediaBlobContent(buffer);
    const storageKey = buildMediaBlobStorageKey(sha256);
    const root = await getMediaStorageRoot();
    const fs = lazyFsPromises();
    const path = lazyPath();
    const absolutePath = path.join(root, storageKey);
    const directory = path.dirname(absolutePath);
    const result = { sha256, storageKey, sizeBytes: buffer.byteLength };

    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.access(absolutePath);
      return result; // already stored — content addressing means identical bytes
    } catch {
      // fall through to atomic write
    }

    const { randomUUID } = lazyCrypto();
    const temporaryPath = path.join(
      directory,
      `.${path.basename(absolutePath)}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await fs.writeFile(temporaryPath, buffer, { flag: "wx" });
      await fs.rename(temporaryPath, absolutePath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      try {
        await fs.access(absolutePath);
        return result; // lost a race but the content is there
      } catch {
        throw error;
      }
    }

    return result;
  }

  async get(storageKey: string): Promise<Buffer> {
    const root = await getMediaStorageRoot();
    const path = lazyPath();
    const absolutePath = path.join(root, storageKey);
    // Guard against path traversal: the resolved path must stay under the root.
    const resolved = path.resolve(absolutePath);
    if (!resolved.startsWith(path.resolve(root))) {
      throw new Error("Media storage key escapes the storage root.");
    }
    return lazyFsPromises().readFile(resolved);
  }
}

const FILESYSTEM_DRIVER = new FilesystemMediaDriver();

/** Resolve the storage driver for an asset. Only filesystem ships today. */
export function getMediaStorageDriver(driver = "filesystem"): MediaStorageDriver {
  if (driver === "filesystem") return FILESYSTEM_DRIVER;
  throw new Error(`Unsupported media storage driver: ${driver}`);
}

/** Write bytes to the default (filesystem) driver. */
export function writeMediaBlob(content: MediaBlobContent): Promise<MediaBlobWriteResult> {
  return FILESYSTEM_DRIVER.put(content);
}

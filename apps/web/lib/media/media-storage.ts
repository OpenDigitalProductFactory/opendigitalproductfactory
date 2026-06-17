// Content-addressed media blob storage.
//
// Mirrors the proven document blob store (apps/web/lib/documents/blob-storage.ts)
// — SHA-256 content addressing, atomic temp-then-rename, dedup on existing hash —
// but under a `media/sha256/...` prefix and behind a pluggable driver interface so
// an S3/GCS backend can slot in later without touching callers (kernel:
// no-provider-pinning; the platform stays self-hostable on the filesystem default).

import { prisma } from "@dpf/db";
import { lazyCrypto, lazyFsPromises, lazyPath } from "../shared/lazy-node";
import { probeImage } from "./image-probe";

export const MEDIA_BLOB_PREFIX = "media/sha256";
export const DEFAULT_MEDIA_BLOB_MAX_BYTES = 15 * 1024 * 1024;
export const DEFAULT_MEDIA_BLOB_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export type MediaBlobContent = Buffer | Uint8Array;
declare const validatedMediaBlobContentBrand: unique symbol;
export type ValidatedMediaBlobContent = Buffer & {
  readonly [validatedMediaBlobContentBrand]: true;
};

export type MediaBlobWriteResult = {
  sha256: string;
  storageKey: string;
  sizeBytes: number;
};

function toBuffer(content: MediaBlobContent): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content);
}

export function prepareMediaBlobContentForStorage(
  content: MediaBlobContent,
  options: {
    allowedMimeTypes?: ReadonlySet<string>;
    maxBytes?: number;
  } = {},
): ValidatedMediaBlobContent {
  const buffer = toBuffer(content);
  const maxBytes = options.maxBytes ?? DEFAULT_MEDIA_BLOB_MAX_BYTES;
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Media blob exceeds ${maxBytes} byte limit.`);
  }

  const allowedMimeTypes = options.allowedMimeTypes ?? DEFAULT_MEDIA_BLOB_MIME_TYPES;
  const mimeType = probeImage(buffer).mimeType;
  if (!mimeType || !allowedMimeTypes.has(mimeType)) {
    throw new Error("Unsupported or unrecognised media blob type.");
  }

  return buffer as ValidatedMediaBlobContent;
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

export function resolveMediaStoragePath(root: string, storageKey: string): string {
  if (!storageKey.startsWith(`${MEDIA_BLOB_PREFIX}/`)) {
    throw new Error("Media storage key must use the media blob prefix.");
  }

  const path = lazyPath();
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, storageKey);
  const relative = path.relative(resolvedRoot, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Media storage key escapes the storage root.");
  }

  return resolved;
}

export async function getMediaStorageRoot(): Promise<string> {
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
  put(content: ValidatedMediaBlobContent): Promise<MediaBlobWriteResult>;
  get(storageKey: string): Promise<Buffer>;
}

class FilesystemMediaDriver implements MediaStorageDriver {
  readonly name = "filesystem";

  async put(content: ValidatedMediaBlobContent): Promise<MediaBlobWriteResult> {
    const buffer = content;
    const sha256 = hashMediaBlobContent(buffer);
    const storageKey = buildMediaBlobStorageKey(sha256);
    const root = await getMediaStorageRoot();
    const fs = lazyFsPromises();
    const path = lazyPath();
    const absolutePath = resolveMediaStoragePath(root, storageKey);
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
      // Bytes reach this sink only after prepareMediaBlobContentForStorage has
      // probed type and size and re-typed them as ValidatedMediaBlobContent;
      // the path is content-addressed and root-confined. The validator is
      // registered as a CodeQL sanitiser in
      // .github/codeql/dpf-sanitizers/dpf-sanitizers.model.yml — alert #269.
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
    return lazyFsPromises().readFile(resolveMediaStoragePath(root, storageKey));
  }
}

const FILESYSTEM_DRIVER = new FilesystemMediaDriver();

/** Resolve the storage driver for an asset. Only filesystem ships today. */
export function getMediaStorageDriver(driver = "filesystem"): MediaStorageDriver {
  if (driver === "filesystem") return FILESYSTEM_DRIVER;
  throw new Error(`Unsupported media storage driver: ${driver}`);
}

/** Write bytes to the default (filesystem) driver. */
export function writeMediaBlob(content: ValidatedMediaBlobContent): Promise<MediaBlobWriteResult> {
  return FILESYSTEM_DRIVER.put(content);
}

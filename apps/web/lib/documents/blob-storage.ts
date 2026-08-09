import { prisma } from "@dpf/db";
import { lazyCrypto, lazyFsPromises, lazyPath } from "../shared/lazy-node";

export const DOCUMENT_TEXT_INLINE_LIMIT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_BLOB_PREFIX = "documents/sha256";

type DocumentBlobContent = Buffer | Uint8Array | string;

type ResolveDocumentBlobStorageRootOptions = {
  configuredPath?: string | null;
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type DocumentBlobWriteResult = {
  sha256: string;
  storageKey: string;
  sizeBytes: number;
};

type DocumentBlobRetentionDb = {
  $transaction: <T>(work: (tx: DocumentBlobRetentionTx) => Promise<T>) => Promise<T>;
};

type DocumentBlobRetentionTx = {
  $queryRaw: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  initiativeArtifactRetentionPin: {
    count: (args: { where: { documentBlobId: string } }) => Promise<number>;
  };
};

export class DocumentBlobRetentionError extends Error {
  readonly code = "INITIATIVE_GOVERNANCE_RETENTION";
}

function toBuffer(content: DocumentBlobContent): Buffer {
  if (Buffer.isBuffer(content)) return content;
  if (typeof content === "string") return Buffer.from(content, "utf-8");
  return Buffer.from(content);
}

export function hashDocumentBlobContent(content: DocumentBlobContent): string {
  const crypto = lazyCrypto();
  return crypto.createHash("sha256").update(toBuffer(content)).digest("hex");
}

export function buildDocumentBlobStorageKey(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("Document blob storage keys require a lowercase SHA-256 hash.");
  }

  return `${DOCUMENT_BLOB_PREFIX}/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

export function resolveDocumentBlobStorageRoot(options: ResolveDocumentBlobStorageRootOptions = {}): string {
  const path = lazyPath();
  const configuredPath = typeof options.configuredPath === "string" && options.configuredPath.trim().length > 0
    ? options.configuredPath
    : undefined;
  const root = configuredPath ?? options.env?.UPLOAD_STORAGE_PATH ?? "./data/uploads";
  return path.resolve(options.cwd ?? process.cwd(), root);
}

export async function getDocumentBlobStorageRoot(): Promise<string> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "upload_storage_path" },
    select: { value: true },
  });

  return resolveDocumentBlobStorageRoot({
    configuredPath: typeof config?.value === "string" ? config.value : null,
    env: process.env,
  });
}

export async function writeDocumentBlob(input: {
  content: DocumentBlobContent;
  storageRoot?: string;
}): Promise<DocumentBlobWriteResult> {
  const content = toBuffer(input.content);
  const sha256 = hashDocumentBlobContent(content);
  const storageKey = buildDocumentBlobStorageKey(sha256);
  const storageRoot = input.storageRoot ?? await getDocumentBlobStorageRoot();
  const fs = lazyFsPromises();
  const path = lazyPath();
  const absolutePath = path.join(storageRoot, storageKey);
  const directory = path.dirname(absolutePath);
  const result = { sha256, storageKey, sizeBytes: content.byteLength };

  await fs.mkdir(directory, { recursive: true });

  try {
    await fs.access(absolutePath);
    return result;
  } catch {
    // Missing content falls through to an atomic write below.
  }

  const { randomUUID } = lazyCrypto();
  const temporaryPath = path.join(directory, `.${path.basename(absolutePath)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await fs.writeFile(temporaryPath, content, { flag: "wx" });
    await fs.rename(temporaryPath, absolutePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});

    try {
      await fs.access(absolutePath);
      return result;
    } catch {
      throw error;
    }
  }

  return result;
}

export async function readDocumentBlob(input: {
  storageKey: string;
  expectedSha256: string;
  storageRoot?: string;
}): Promise<Buffer> {
  const expectedStorageKey = buildDocumentBlobStorageKey(input.expectedSha256);
  if (input.storageKey !== expectedStorageKey) {
    throw new Error("Document blob storage key does not match its content digest.");
  }

  const storageRoot = input.storageRoot ?? await getDocumentBlobStorageRoot();
  const path = lazyPath();
  const bytes = await lazyFsPromises().readFile(path.join(storageRoot, expectedStorageKey));
  if (hashDocumentBlobContent(bytes) !== input.expectedSha256) {
    throw new Error("Document blob bytes do not match their content digest.");
  }
  return bytes;
}

/** Canonical storage-GC door. Pinned initiative evidence is never removable. */
export async function deleteDocumentBlob(input: {
  documentBlobId: string;
  storageKey: string;
  expectedSha256: string;
  storageRoot?: string;
  db?: DocumentBlobRetentionDb;
}): Promise<void> {
  const expectedStorageKey = buildDocumentBlobStorageKey(input.expectedSha256);
  if (input.storageKey !== expectedStorageKey) {
    throw new Error("Document blob storage key does not match its content digest.");
  }
  const storageRoot = input.storageRoot ?? await getDocumentBlobStorageRoot();
  const db = input.db ?? (prisma as unknown as DocumentBlobRetentionDb);
  await db.$transaction(async (tx) => {
    // Hold the blob row through the filesystem unlink. A concurrent retention
    // pin needs a foreign-key key-share lock and therefore cannot commit in the
    // gap between the pin check and deletion.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "DocumentBlob" WHERE "id" = ${input.documentBlobId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("Document blob metadata was not found.");
    if (await tx.initiativeArtifactRetentionPin.count({ where: { documentBlobId: input.documentBlobId } }) > 0) {
      throw new DocumentBlobRetentionError("Pinned initiative document bytes are permanently retained.");
    }
    await lazyFsPromises().unlink(lazyPath().join(storageRoot, expectedStorageKey));
  });
}

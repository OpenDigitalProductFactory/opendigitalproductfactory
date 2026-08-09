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
  documentBlob: {
    delete: (args: { where: { id: string }; select: { id: true } }) => Promise<{ id: string }>;
  };
};

export class DocumentBlobRetentionError extends Error {
  readonly code = "INITIATIVE_GOVERNANCE_RETENTION";
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
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

  const verifyExistingBlob = async (): Promise<void> => {
    const existing = await fs.readFile(absolutePath);
    if (existing.byteLength !== content.byteLength || hashDocumentBlobContent(existing) !== sha256) {
      throw new Error("Existing document blob bytes do not match their content-addressed key.");
    }
  };

  try {
    await verifyExistingBlob();
    return result;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
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
      await verifyExistingBlob();
      return result;
    } catch (existingError) {
      if (!isMissingFileError(existingError)) throw existingError;
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
  const fs = lazyFsPromises();
  const path = lazyPath();
  const absolutePath = path.join(storageRoot, expectedStorageKey);
  const quarantinePath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${lazyCrypto().randomUUID()}.delete`,
  );
  let quarantined = false;
  try {
    await db.$transaction(async (tx) => {
      // The row lock serializes a concurrent pin. Renaming first preserves
      // recoverability, while deleting the row in this same transaction makes
      // every waiting FK insert fail after commit instead of pinning lost bytes.
      const rows = await tx.$queryRaw<Array<{ id: string; storageKey: string; sha256: string }>>`
        SELECT "id", "storageKey", "sha256"
        FROM "DocumentBlob"
        WHERE "id" = ${input.documentBlobId}
        FOR UPDATE
      `;
      if (rows.length !== 1) throw new Error("Document blob metadata was not found.");
      if (rows[0]!.storageKey !== input.storageKey || rows[0]!.sha256 !== input.expectedSha256) {
        throw new Error("Document blob metadata does not match the requested storage identity.");
      }
      if (await tx.initiativeArtifactRetentionPin.count({ where: { documentBlobId: input.documentBlobId } }) > 0) {
        throw new DocumentBlobRetentionError("Pinned initiative document bytes are permanently retained.");
      }
      await fs.rename(absolutePath, quarantinePath);
      quarantined = true;
      await tx.documentBlob.delete({ where: { id: input.documentBlobId }, select: { id: true } });
    });
  } catch (error) {
    if (quarantined) {
      try {
        await fs.rename(quarantinePath, absolutePath);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          `Document blob metadata deletion failed and bytes require recovery from ${quarantinePath}.`,
        );
      }
    }
    throw error;
  }
  await fs.unlink(quarantinePath);
}

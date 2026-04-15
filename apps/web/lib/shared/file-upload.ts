import { prisma, type Prisma } from "@dpf/db";
import { parseFileContent, capParsedContentSize } from "./file-parsers";
import { lazyFsPromises, lazyPath, lazyCrypto } from "./lazy-node";

const ALLOWED_EXTENSIONS = new Set(["csv", "xls", "xlsx", "pdf", "doc", "docx", "txt", "json", "md", "xml", "yaml", "yml", "tsv", "log", "ppt", "pptx", "rtf"]);
const DEFAULT_MAX_SIZE_MB = 10;
const MAX_ATTACHMENTS_PER_THREAD = 20;
const MAX_USER_STORAGE_BYTES = 200 * 1024 * 1024;

const MAGIC_BYTES: Record<string, number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46],
  xlsx: [0x50, 0x4b, 0x03, 0x04],
  docx: [0x50, 0x4b, 0x03, 0x04],
  pptx: [0x50, 0x4b, 0x03, 0x04],
  xls: [0xd0, 0xcf, 0x11, 0xe0],   // OLE compound document
  doc: [0xd0, 0xcf, 0x11, 0xe0],
  ppt: [0xd0, 0xcf, 0x11, 0xe0],
};

async function getUploadStoragePath(): Promise<string> {
  const config = await prisma.platformConfig.findUnique({ where: { key: "upload_storage_path" }, select: { value: true } });
  if (config && typeof config.value === "string" && config.value.length > 0) return config.value;
  return process.env.UPLOAD_STORAGE_PATH ?? "./data/uploads";
}

function validateMagicBytes(buffer: Buffer, ext: string): boolean {
  const expected = MAGIC_BYTES[ext];
  if (!expected) return true;
  if (buffer.length < expected.length) return false;
  return expected.every((byte, i) => buffer[i] === byte);
}

export type UploadResult = { attachmentId: string; fileName: string; parsedContent: unknown };
export type UploadError = { error: string; status: number };

export async function handleFileUpload(file: File, threadId: string, userId: string): Promise<UploadResult | UploadError> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) return { error: `Unsupported file type (.${ext}). Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`, status: 415 };
  if (file.size > DEFAULT_MAX_SIZE_MB * 1024 * 1024) return { error: `File exceeds ${DEFAULT_MAX_SIZE_MB}MB limit`, status: 413 };

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!validateMagicBytes(buffer, ext)) return { error: "File content does not match its extension", status: 422 };

  const attachmentCount = await prisma.agentAttachment.count({ where: { threadId } });
  if (attachmentCount >= MAX_ATTACHMENTS_PER_THREAD) return { error: `Thread attachment limit (${MAX_ATTACHMENTS_PER_THREAD}) reached`, status: 429 };

  const thread = await prisma.agentThread.findUnique({ where: { id: threadId }, select: { userId: true } });
  if (!thread || thread.userId !== userId) return { error: "Unauthorized", status: 401 };

  const userThreads = await prisma.agentThread.findMany({ where: { userId }, select: { id: true } });
  const totalStorage = await prisma.agentAttachment.aggregate({ where: { threadId: { in: userThreads.map((t) => t.id) } }, _sum: { sizeBytes: true } });
  if ((totalStorage._sum.sizeBytes ?? 0) + file.size > MAX_USER_STORAGE_BYTES) return { error: "Storage quota exceeded (200MB per user)", status: 507 };

  const fs = lazyFsPromises();
  const path = lazyPath();
  const storagePath = await getUploadStoragePath();
  const { randomUUID } = lazyCrypto();
  const storageKey = `${threadId}/${randomUUID()}.${ext}`;
  await fs.mkdir(path.join(storagePath, threadId), { recursive: true });
  await fs.writeFile(path.join(storagePath, storageKey), buffer);

  let parsedContent = await parseFileContent(buffer, file.type, file.name);
  if (parsedContent) parsedContent = capParsedContentSize(parsedContent);

  const attachment = await prisma.agentAttachment.create({
    data: {
      threadId, fileName: file.name, mimeType: file.type || `application/${ext}`,
      sizeBytes: file.size, storageKey,
      ...(parsedContent ? { parsedContent: parsedContent as Prisma.InputJsonValue, parsedAt: new Date() } : {}),
    },
    select: { id: true },
  });

  return { attachmentId: attachment.id, fileName: file.name, parsedContent };
}

export async function deleteAttachmentsForThread(threadId: string): Promise<void> {
  const attachments = await prisma.agentAttachment.findMany({ where: { threadId }, select: { storageKey: true } });
  const storagePath = await getUploadStoragePath();
  const fs = lazyFsPromises();
  const path = lazyPath();
  for (const att of attachments) { await fs.unlink(path.join(storagePath, att.storageKey)).catch(() => {}); }
  await prisma.agentAttachment.deleteMany({ where: { threadId } });
}

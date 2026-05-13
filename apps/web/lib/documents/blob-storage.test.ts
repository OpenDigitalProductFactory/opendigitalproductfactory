import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_TEXT_INLINE_LIMIT_BYTES,
  buildDocumentBlobStorageKey,
  hashDocumentBlobContent,
  resolveDocumentBlobStorageRoot,
  writeDocumentBlob,
} from "./blob-storage";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "document-blob-storage-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("document blob storage", () => {
  it("keeps the inline content threshold at 10MB", () => {
    expect(DOCUMENT_TEXT_INLINE_LIMIT_BYTES).toBe(10 * 1024 * 1024);
  });

  it("builds deterministic content-addressed keys", () => {
    const hash = hashDocumentBlobContent(Buffer.from("hello document"));

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildDocumentBlobStorageKey(hash)).toBe(
      `documents/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`,
    );
  });

  it("writes blobs idempotently under the content hash key", async () => {
    const content = Buffer.from("managed document payload");
    const first = await writeDocumentBlob({ content, storageRoot: tmpRoot });
    const second = await writeDocumentBlob({ content, storageRoot: tmpRoot });

    expect(second).toEqual(first);
    expect(first.sizeBytes).toBe(content.byteLength);
    await expect(fs.readFile(path.join(tmpRoot, first.storageKey), "utf-8")).resolves.toBe(content.toString("utf-8"));
  });

  it("resolves PlatformConfig upload roots before environment fallback", () => {
    const cwd = path.join(tmpRoot, "cwd");
    const envRoot = path.join(tmpRoot, "env");

    expect(resolveDocumentBlobStorageRoot({ configuredPath: "./configured", cwd, env: { UPLOAD_STORAGE_PATH: envRoot } })).toBe(
      path.resolve(cwd, "./configured"),
    );
    expect(resolveDocumentBlobStorageRoot({ configuredPath: "", cwd, env: { UPLOAD_STORAGE_PATH: envRoot } })).toBe(
      envRoot,
    );
    expect(resolveDocumentBlobStorageRoot({ configuredPath: null, cwd, env: {} })).toBe(
      path.resolve(cwd, "./data/uploads"),
    );
  });
});

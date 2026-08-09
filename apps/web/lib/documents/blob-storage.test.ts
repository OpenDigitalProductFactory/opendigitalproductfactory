import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_TEXT_INLINE_LIMIT_BYTES,
  buildDocumentBlobStorageKey,
  deleteDocumentBlob,
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

  it("refuses to reuse corrupt bytes found at a content-addressed key", async () => {
    const content = Buffer.from("expected managed document payload");
    const sha256 = hashDocumentBlobContent(content);
    const storageKey = buildDocumentBlobStorageKey(sha256);
    await fs.mkdir(path.dirname(path.join(tmpRoot, storageKey)), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, storageKey), "corrupt bytes");

    await expect(writeDocumentBlob({ content, storageRoot: tmpRoot })).rejects.toThrow(/existing document blob bytes/i);
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

  it("refuses storage GC for a blob retained by an initiative baseline", async () => {
    const written = await writeDocumentBlob({ content: "permanent design", storageRoot: tmpRoot });
    const events: string[] = [];
    await expect(deleteDocumentBlob({
      documentBlobId: "blob-1",
      storageKey: written.storageKey,
      expectedSha256: written.sha256,
      storageRoot: tmpRoot,
      db: {
        $transaction: async (work) => work({
          $queryRaw: async <T>() => { events.push("lock"); return [{ id: "blob-1" }] as unknown as T; },
          initiativeArtifactRetentionPin: { count: async () => { events.push("count"); return 1; } },
          documentBlob: { delete: async () => { events.push("delete"); return { id: "blob-1" }; } },
        }),
      },
    })).rejects.toMatchObject({ code: "INITIATIVE_GOVERNANCE_RETENTION" });
    expect(events).toEqual(["lock", "count"]);
    await expect(fs.readFile(path.join(tmpRoot, written.storageKey), "utf8")).resolves.toBe("permanent design");
  });

  it("allows the canonical GC door to delete an unpinned blob", async () => {
    const written = await writeDocumentBlob({ content: "disposable design", storageRoot: tmpRoot });
    const events: string[] = [];
    await deleteDocumentBlob({
      documentBlobId: "blob-2",
      storageKey: written.storageKey,
      expectedSha256: written.sha256,
      storageRoot: tmpRoot,
      db: {
        $transaction: async (work) => work({
          $queryRaw: async <T>() => { events.push("lock"); return [{ id: "blob-2" }] as unknown as T; },
          initiativeArtifactRetentionPin: { count: async () => { events.push("count"); return 0; } },
          documentBlob: { delete: async () => { events.push("delete"); return { id: "blob-2" }; } },
        }),
      },
    });
    expect(events).toEqual(["lock", "count", "delete"]);
    await expect(fs.access(path.join(tmpRoot, written.storageKey))).rejects.toBeDefined();
  });

  it("restores quarantined bytes when the metadata transaction cannot delete the blob", async () => {
    const written = await writeDocumentBlob({ content: "still referenced", storageRoot: tmpRoot });
    await expect(deleteDocumentBlob({
      documentBlobId: "blob-3",
      storageKey: written.storageKey,
      expectedSha256: written.sha256,
      storageRoot: tmpRoot,
      db: {
        $transaction: async (work) => work({
          $queryRaw: async <T>() => [{ id: "blob-3" }] as unknown as T,
          initiativeArtifactRetentionPin: { count: async () => 0 },
          documentBlob: { delete: async () => { throw new Error("foreign key restrict"); } },
        }),
      },
    })).rejects.toThrow("foreign key restrict");
    await expect(fs.readFile(path.join(tmpRoot, written.storageKey), "utf8")).resolves.toBe("still referenced");
  });
});

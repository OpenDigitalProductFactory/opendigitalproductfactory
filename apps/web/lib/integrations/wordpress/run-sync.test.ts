import { describe, expect, it, vi } from "vitest";

import { runWordPressContentSync } from "./run-sync";

describe("runWordPressContentSync", () => {
  it("reads the durable per-family cursor and commits staged records before returning it", async () => {
    const findUnique = vi.fn(async () => ({ status: "connected", fieldsEnc: "encrypted", tokenCacheEnc: null }));
    const findFirst = vi.fn(async () => null);
    const upsert = vi.fn(async () => ({}));
    const transaction = vi.fn(async (operation) => operation({ integrationImportBatch: { upsert } }));
    const list = vi.fn(async (kind: "post" | "page" | "media") => ({
      records: [{ id: kind === "post" ? 1 : kind === "page" ? 2 : 3, modified_gmt: "2026-08-22T05:00:00", title: { rendered: kind } }],
      totalPages: 1,
    }));
    const result = await runWordPressContentSync({
      db: { integrationCredential: { findUnique }, integrationImportBatch: { findFirst }, $transaction: transaction } as never,
      decrypt: () => ({ schemaVersion: 1, reconnectFields: { siteUrl: "https://wordpress.example", username: "publisher" }, secretFields: { applicationPassword: "secret" }, safeProjection: {} }),
      createClient: () => ({ list }),
      connectionId: "wordpress-self-hosted",
    });
    expect(result).toMatchObject({ resultCount: 3, truncated: false, checkpoints: { post: expect.any(Object), page: expect.any(Object), media: expect.any(Object) } });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("refuses disconnected credentials before network access", async () => {
    const list = vi.fn();
    await expect(runWordPressContentSync({
      db: { integrationCredential: { findUnique: vi.fn(async () => ({ status: "error", fieldsEnc: "x", tokenCacheEnc: null })) } } as never,
      decrypt: () => ({}), createClient: () => ({ list }), connectionId: "wordpress-self-hosted",
    })).rejects.toThrow(/not connected/i);
    expect(list).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

import { loadWordPressCheckpoint, persistWordPressSyncResult } from "./sync-store";

describe("WordPress sync persistence", () => {
  it("makes staged read models and the compound checkpoint durable in one transaction", async () => {
    const upsert = vi.fn(async (args) => args);
    const transaction = vi.fn(async (operation) => operation({ integrationImportBatch: { upsert } }));
    const db = { $transaction: transaction, integrationImportBatch: { findFirst: vi.fn() } };
    const checkpoints = { post: { modifiedGmt: "2026-08-22T02:00:00", id: 44 } };
    await persistWordPressSyncResult(db as never, {
      connectionId: "wordpress-self-hosted",
      checkpoints,
      records: [{
        entityFamily: "wordpress-post", externalId: "44", sourceProvider: "wordpress-self-hosted", sourceTimestamp: "2026-08-22T02:00:00Z", ownerSide: "external",
        proposedLocalLink: { entityType: "OutboundDraft", localId: null, status: "candidate", confidence: "low", reason: "review" },
        displayFields: [{ label: "Title", value: "Hello" }], readOnly: true,
      }],
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { batchRef: "wordpress-sync:wordpress-self-hosted:eyJwb3N0Ijp7Im1vZGlmaWVkR210IjoiMjAyNi0wOC0yMlQwMjowMDowMCIsImlkIjo0NH19" },
      create: expect.objectContaining({ sourceTimestamp: new Date("2026-08-22T02:00:00Z") }),
    }));
  });

  it("recovers the latest durable compound cursor", async () => {
    const db = { integrationImportBatch: { findFirst: vi.fn(async () => ({ batchRef: "wordpress-sync:wordpress-self-hosted:eyJwb3N0Ijp7Im1vZGlmaWVkR210IjoiMjAyNi0wOC0yMlQwMjowMDowMCIsImlkIjo0NH19" })) } };
    await expect(loadWordPressCheckpoint(db as never, "wordpress-self-hosted"))
      .resolves.toEqual({ post: { modifiedGmt: "2026-08-22T02:00:00", id: 44 } });
  });
});

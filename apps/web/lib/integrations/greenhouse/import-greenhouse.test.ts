import { describe, expect, it, vi } from "vitest";
import {
  importGreenhouseFromReaders,
  type GreenhouseReaders,
} from "./import-greenhouse";
import type { IntegrationImportReviewPersistenceClient } from "@/lib/integrations/import-review-store";

function fakeDb() {
  const upsert = vi.fn().mockResolvedValue({});
  const db: IntegrationImportReviewPersistenceClient = {
    integrationImportBatch: { upsert },
  };
  return { db, upsert };
}

const readers: GreenhouseReaders = {
  listJobs: async () => [{ id: 1, name: "Motor Engineer", status: "open" }],
  listCandidates: async () => [
    { id: 2, first_name: "Ana", last_name: "López" },
    { id: 3 },
  ],
  listApplications: async () => [{ id: 4, status: "active", current_stage: { name: "Onsite" } }],
  listOffers: async () => [],
  listScorecards: async () => [{ id: 5, overall_recommendation: "yes" }],
};

describe("importGreenhouseFromReaders", () => {
  it("pulls every family, maps, and saves one review batch", async () => {
    const { db, upsert } = fakeDb();

    const counts = await importGreenhouseFromReaders(db, {
      batchId: "GH-BATCH-1",
      apiToken: "test-key",
      readers,
    });

    expect(counts).toEqual({
      jobs: 1,
      candidates: 2,
      applications: 1,
      offers: 0,
      scorecards: 1,
      total: 5,
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0][0];
    expect(call.where.batchRef).toBe("GH-BATCH-1");
    expect(call.create.sourceProvider).toBe("greenhouse");
    expect(call.create.status).toBe("reviewing");
    expect(call.create.records.create).toHaveLength(5);
    // Every staged record is read-only and fingerprinted by the store.
    expect(call.create.records.create.every((r: { readOnly: boolean }) => r.readOnly === true)).toBe(
      true,
    );
  });

  it("re-running the same batchId upserts (no duplicate batch)", async () => {
    const { db, upsert } = fakeDb();
    await importGreenhouseFromReaders(db, { batchId: "GH-BATCH-2", apiToken: "k", readers });
    await importGreenhouseFromReaders(db, { batchId: "GH-BATCH-2", apiToken: "k", readers });
    expect(upsert).toHaveBeenCalledTimes(2);
    // Both calls key on the same batchRef → the store upserts + replaces records.
    expect(upsert.mock.calls[0][0].where.batchRef).toBe("GH-BATCH-2");
    expect(upsert.mock.calls[1][0].where.batchRef).toBe("GH-BATCH-2");
  });
});

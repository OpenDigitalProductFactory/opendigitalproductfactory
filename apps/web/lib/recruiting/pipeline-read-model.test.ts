import { describe, expect, it, vi } from "vitest";
import { getRecruitingPipeline, type RecruitingPipelineClient } from "./pipeline-read-model";

function fakeDb(opts: {
  nativeApps?: Array<{
    id: string;
    status: string | null;
    candidate: { displayName: string } | null;
    currentStage: { name: string } | null;
  }>;
  staged?: Array<{ externalId: string; displayFields: unknown }>;
  promoted?: Array<{ sourceEntityId: string }>;
}) {
  const appFindMany = vi.fn().mockResolvedValue(opts.nativeApps ?? []);
  const stagedFindMany = vi.fn().mockResolvedValue(opts.staged ?? []);
  const refFindMany = vi.fn().mockResolvedValue(opts.promoted ?? []);
  const db: RecruitingPipelineClient = {
    application: { findMany: appFindMany },
    integrationImportStagedRecord: { findMany: stagedFindMany },
    masterDataSourceRef: { findMany: refFindMany },
  };
  return { db, appFindMany };
}

describe("getRecruitingPipeline", () => {
  it("unions native applications and Greenhouse-staged records into one funnel", async () => {
    const { db } = fakeDb({
      nativeApps: [
        {
          id: "app-native-1",
          status: "active",
          candidate: { displayName: "Nadia Native" },
          currentStage: { name: "Onsite" },
        },
      ],
      staged: [
        {
          externalId: "gh-app-1",
          displayFields: [
            { label: "Name", value: "Greta Greenhouse" },
            { label: "Status", value: "active" },
            { label: "Stage", value: "Screen" },
          ],
        },
      ],
    });

    const result = await getRecruitingPipeline(db);

    expect(result.counts).toEqual({ native: 1, greenhouse: 1, total: 2 });
    expect(result.items[0]).toMatchObject({
      id: "app-native-1",
      source: "native",
      displayName: "Nadia Native",
      stage: "Onsite",
    });
    expect(result.items[1]).toMatchObject({
      id: "greenhouse:gh-app-1",
      source: "greenhouse",
      displayName: "Greta Greenhouse",
      status: "active",
      stage: "Screen",
      externalId: "gh-app-1",
    });
  });

  it("dedupes a staged record already crosswalked to a native row", async () => {
    const { db } = fakeDb({
      nativeApps: [
        { id: "app-native-1", status: "hired", candidate: { displayName: "Promoted Pat" }, currentStage: null },
      ],
      staged: [
        { externalId: "gh-app-1", displayFields: [{ label: "Name", value: "Promoted Pat" }] },
        { externalId: "gh-app-2", displayFields: [{ label: "Name", value: "Still Staged" }] },
      ],
      // gh-app-1 is already promoted → excluded from the Greenhouse side.
      promoted: [{ sourceEntityId: "gh-app-1" }],
    });

    const result = await getRecruitingPipeline(db);

    expect(result.counts).toEqual({ native: 1, greenhouse: 1, total: 2 });
    const ghItems = result.items.filter((i) => i.source === "greenhouse");
    expect(ghItems).toHaveLength(1);
    expect(ghItems[0].externalId).toBe("gh-app-2");
  });

  it("passes a requisitionId filter through to the native query", async () => {
    const { db, appFindMany } = fakeDb({});
    await getRecruitingPipeline(db, { requisitionId: "req-7" });
    expect(appFindMany.mock.calls[0][0].where).toEqual({ requisitionId: "req-7" });
  });

  it("falls back to a placeholder name when a staged row has no Name field", async () => {
    const { db } = fakeDb({ staged: [{ externalId: "gh-9", displayFields: [] }] });
    const result = await getRecruitingPipeline(db);
    expect(result.items[0].displayName).toBe("Greenhouse application gh-9");
  });
});

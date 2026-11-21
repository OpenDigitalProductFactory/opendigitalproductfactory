// BI-05AFEB9A: objective mapping maps a baseline's criteria to the item's own
// evidence recorded at or after that baseline. A Build Studio item had none:
// its delivery proof lived on the build and its room, so the acceptance
// coworker had nothing it could cite.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordBuildDeliveryEvidence } from "./build-delivery-evidence";

const baselineAt = new Date("2026-11-21T01:00:00Z");
let rows: Array<{ kind: string; recordedAt: Date; payload: unknown }>;
let client: ReturnType<typeof fakeClient>;

function fakeClient() {
  return {
    backlogItemActivity: {
      findMany: vi.fn(async ({ where }: { where: { kind: string } }) => rows.filter((row) => row.kind === where.kind)),
      create: vi.fn(async ({ data }: { data: { kind: string; payload: unknown } }) => {
        rows.push({ kind: data.kind, recordedAt: new Date("2026-11-21T02:00:00Z"), payload: data.payload });
        return data;
      }),
    },
    featurePack: { findFirst: vi.fn(async () => ({ prUrl: "https://github.com/owner/repo/pull/6983" })) },
  };
}

const args = { itemRowId: "row-1", buildRowId: "build-row-1", buildId: "FB-2F2D46D5", recordedById: "user-1", deployedSha: "89b09949eb0fb44d67e0070213364f2b29f1ad72" };

beforeEach(() => {
  rows = [{ kind: "initiative_scope_baseline", recordedAt: baselineAt, payload: { baselineId: "baseline-1" } }];
  client = fakeClient();
});

describe("recordBuildDeliveryEvidence", () => {
  it("records the build's delivery as passing evidence after the baseline", async () => {
    expect(await recordBuildDeliveryEvidence(client as never, args)).toBe(true);

    const data = client.backlogItemActivity.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      backlogItemId: "row-1", kind: "evidence", recordedById: "user-1", recordedByAgentId: null,
      payload: { evidenceKind: "build_pass", url: "https://github.com/owner/repo/pull/6983", deliveredBuildId: "FB-2F2D46D5", toolExecutionId: null },
    });
    expect((data.payload as { body: string }).body).toContain("89b09949eb0f");
  });

  it("records it once per baseline", async () => {
    await recordBuildDeliveryEvidence(client as never, args);
    expect(await recordBuildDeliveryEvidence(client as never, args)).toBe(false);
    expect(client.backlogItemActivity.create).toHaveBeenCalledTimes(1);
  });

  it("records nothing before a baseline exists", async () => {
    rows = [];
    expect(await recordBuildDeliveryEvidence(client as never, args)).toBe(false);
    expect(client.backlogItemActivity.create).not.toHaveBeenCalled();
  });
});

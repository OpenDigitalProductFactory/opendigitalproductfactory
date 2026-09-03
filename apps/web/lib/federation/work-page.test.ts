import { describe, expect, it, vi } from "vitest";

import { federatedWorkOriginMarker } from "@dpf/db/federated-work-contract";

import { buildFederatedWorkPage, type WorkPageDb, type WorkPageItemRow } from "./work-page";

const origin = `inst_${"c".repeat(32)}`;
const at = new Date("2026-09-02T04:00:00.000Z");

function row(itemId: string, overrides: Partial<WorkPageItemRow> = {}): WorkPageItemRow {
  return {
    itemId, title: `Item ${itemId}`, status: "open", type: "portfolio", body: "Body", priority: null,
    workType: "bug", triageOutcome: null, effortSize: null, proposedOutcome: null, resolution: null,
    sensitivity: "internal", source: "user-request", occurrenceCount: 1, scopeKind: null,
    archetypeCategories: [], archetypeIds: [], lifecycleTags: [], createdAt: at, updatedAt: at,
    completedAt: null, deferReason: null, deferTrigger: null, deferReviewAt: null, deferredAt: null,
    epic: { epicId: "EP-1" }, ...overrides,
  };
}

function db(items: WorkPageItemRow[]): WorkPageDb & { backlogItem: { findMany: ReturnType<typeof vi.fn> }; epic: { findMany: ReturnType<typeof vi.fn> } } {
  return {
    backlogItem: { findMany: vi.fn().mockResolvedValue(items) },
    epic: { findMany: vi.fn().mockResolvedValue([{
      epicId: "EP-1", title: "Epic", description: null, status: "open", priority: null,
      investmentBucket: null, createdAt: at, updatedAt: at, completedAt: null,
    }]) },
  };
}

describe("buildFederatedWorkPage", () => {
  it("serves owned rows with semantic epic ids and marks the page complete", async () => {
    const store = db([row("BI-A"), row("BI-B")]);
    const page = await buildFederatedWorkPage(store, { originInstallationId: origin, cursor: null, limit: 10, now: at });
    expect(page.complete).toBe(true);
    expect(page.cursor).toBeNull();
    expect(page.items.map((i) => i.itemId)).toEqual(["BI-A", "BI-B"]);
    expect(page.items[0]!.epicId).toBe("EP-1");
    expect(page.epics).toHaveLength(1);
    // Local-only sensitivities and mirrored rows are excluded at the SQL layer.
    const where = store.backlogItem.findMany.mock.calls[0]![0].where;
    expect(where.sensitivity.notIn).toEqual(["confidential", "restricted"]);
    // A row with no prose is owned: NOT-contains alone is NULL for a NULL column.
    expect(where.OR).toEqual([{ body: null }, { NOT: { body: { contains: "[origin:federatedWork:" } } }]);
    const epicWhere = store.epic.findMany.mock.calls[0]![0].where;
    expect(epicWhere.OR).toEqual([{ description: null }, { NOT: { description: { contains: "[origin:federatedWork:" } } }]);
  });

  it("never serves a mirror back, even when the SQL predicate let it through", async () => {
    const mirrored = row("BI-M", { body: `Copied\n\n${federatedWorkOriginMarker(origin, "BI-M")}` });
    const page = await buildFederatedWorkPage(db([row("BI-A"), mirrored]), { originInstallationId: origin, cursor: null, limit: 10, now: at });
    expect(page.items.map((i) => i.itemId)).toEqual(["BI-A"]);
  });

  it("pages with a cursor that never skips a row, and carries epics on the first page only", async () => {
    const store = db([row("BI-A"), row("BI-B"), row("BI-C")]);
    const first = await buildFederatedWorkPage(store, { originInstallationId: origin, cursor: null, limit: 2, now: at });
    expect(first.complete).toBe(false);
    expect(first.cursor).toBe("BI-B");
    expect(first.items).toHaveLength(2);

    const second = await buildFederatedWorkPage(db([row("BI-C")]), { originInstallationId: origin, cursor: "BI-B", limit: 2, now: at });
    expect(second.complete).toBe(true);
    expect(second.epics).toEqual([]);
    expect(store.backlogItem.findMany.mock.calls[0]![0].take).toBe(3);
  });
});

describe("buildFederatedWorkPage - deferral attribution (BI-9DA5F179)", () => {
  const reviewAt = new Date("2026-10-01T00:00:00.000Z");

  it("publishes an attributable deferral with the parked item", async () => {
    const store = db([row("BI-A", { status: "deferred", deferReason: "Vendor v2", deferTrigger: "v2 ships", deferReviewAt: reviewAt, deferredAt: at })]);
    const page = await buildFederatedWorkPage(store, { originInstallationId: origin, cursor: null, limit: 10 });
    expect(page.items[0]!.deferral).toEqual({ reason: "Vendor v2", trigger: "v2 ships", reviewAt: reviewAt.toISOString(), deferredAt: at.toISOString() });
  });

  it("ships null, never a half deferral, when the origin park is unattributed, and null for any non-deferred item", async () => {
    const store = db([
      row("BI-A", { status: "deferred", deferReason: "Vendor v2", deferTrigger: null, deferReviewAt: reviewAt }),
      row("BI-B", { status: "open", deferReason: "stale", deferTrigger: "stale", deferReviewAt: reviewAt }),
    ]);
    const page = await buildFederatedWorkPage(store, { originInstallationId: origin, cursor: null, limit: 10 });
    expect(page.items.map((i) => i.deferral)).toEqual([null, null]);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { federatedWorkOriginMarker, type FederatedWorkPageV1 } from "@dpf/db/federated-work-contract";

import { runWorkSync, type WorkSyncDb, type WorkSyncMirrorRow } from "./work-sync";

const origin = `inst_${"d".repeat(32)}`;
const now = new Date("2026-09-02T05:00:00.000Z");
const link = { linkId: "link_1", role: "same-org-peer", peerAuthorityUrl: "http://192.168.0.152:3000", peerTokenEnc: "enc" };

function item(itemId: string, updatedAt = "2026-09-01T00:00:00.000Z", epicId: string | null = "EP-1") {
  return {
    itemId, title: `Item ${itemId}`, status: "open", type: "portfolio", body: "Body", priority: null,
    workType: "bug", triageOutcome: "build", effortSize: null, proposedOutcome: null, resolution: null,
    sensitivity: "internal", epicId, source: "user-request", occurrenceCount: 1, scopeKind: null,
    archetypeCategories: [], archetypeIds: [], lifecycleTags: [], createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt, completedAt: null,
  };
}

function page(items: ReturnType<typeof item>[], overrides: Partial<FederatedWorkPageV1> = {}): FederatedWorkPageV1 {
  return {
    specVersion: "dpf.work-sync/1", originInstallationId: origin, generatedAt: now.toISOString(),
    items,
    epics: [{ epicId: "EP-1", title: "Epic", description: "About", status: "open", priority: null, investmentBucket: null,
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", completedAt: null }],
    cursor: null, complete: true, ...overrides,
  };
}

function store(options: {
  existingItems?: Record<string, { id: string; body: string | null; status: string }>;
  existingEpics?: Record<string, { id: string; description: string | null }>;
  mirrors?: WorkSyncMirrorRow[];
} = {}) {
  const existingItems = options.existingItems ?? {};
  const existingEpics = options.existingEpics ?? {};
  const db = {
    federationLink: {
      findMany: vi.fn().mockResolvedValue([link]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    backlogItem: {
      findUnique: vi.fn(async (args: { where: { itemId: string } }) => existingItems[args.where.itemId] ?? null),
      upsert: vi.fn().mockResolvedValue({ id: "row" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    epic: {
      findUnique: vi.fn(async (args: { where: { epicId: string } }) => existingEpics[args.where.epicId] ?? null),
      upsert: vi.fn().mockResolvedValue({ id: "epic-local-id" }),
    },
    federatedRecordMirror: {
      findMany: vi.fn().mockResolvedValue(options.mirrors ?? []),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return db as unknown as WorkSyncDb & typeof db;
}

const decryptToken = () => "dpflink_peer";

describe("runWorkSync", () => {
  it("materialises a peer's items and epics as marked local rows and records provenance", async () => {
    const db = store();
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, status: 200, body: page([item("BI-A")]) });

    const result = await runWorkSync(db, { fetchPage, decryptToken, now });

    expect(result.links[0]).toMatchObject({ outcome: "synced", itemsCreated: 1, epicsUpserted: 1, pages: 1 });
    expect(fetchPage.mock.calls[0]![0]).toMatchObject({ linkToken: "dpflink_peer", sameOrgLan: true });
    const epicUpsert = db.epic.upsert.mock.calls[0]![0];
    expect(epicUpsert.create.description).toBe(`About\n\n${federatedWorkOriginMarker(origin, "EP-1")}`);
    const itemUpsert = db.backlogItem.upsert.mock.calls[0]![0];
    expect(itemUpsert.where).toEqual({ itemId: "BI-A" });
    expect(itemUpsert.create.body).toBe(`Body\n\n${federatedWorkOriginMarker(origin, "BI-A")}`);
    // The semantic epic id is re-linked to the LOCAL epic row.
    expect(itemUpsert.create.epicId).toBe("epic-local-id");
    const mirror = db.federatedRecordMirror.upsert.mock.calls.find((c) => c[0].create.recordType === "backlog-item")![0];
    expect(mirror.create).toMatchObject({ canonicalSide: "peer", syncStatus: "synced", peerRecordRef: `${origin}:BI-A` });
    // The peer's installation identity is bound to the link.
    expect(db.federationLink.updateMany).toHaveBeenCalled();
  });

  it("skips an item the origin has not changed since the last pull", async () => {
    const version = BigInt(Date.parse("2026-09-01T00:00:00.000Z"));
    const db = store({
      existingItems: { "BI-A": { id: "x", body: `Body\n\n${federatedWorkOriginMarker(origin, "BI-A")}`, status: "open" } },
      mirrors: [{ mirrorId: "m1", localRecordRef: "BI-A", version, syncStatus: "synced" }],
    });
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, status: 200, body: page([item("BI-A")]) });

    const result = await runWorkSync(db, { fetchPage, decryptToken, now });

    expect(result.links[0]).toMatchObject({ itemsUnchanged: 1, itemsCreated: 0, itemsUpdated: 0 });
    expect(db.backlogItem.upsert).not.toHaveBeenCalled();
  });

  it("never overwrites a locally owned row that happens to share an id — it records a conflict", async () => {
    const db = store({ existingItems: { "BI-A": { id: "x", body: "Ours, no marker", status: "open" } } });
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, status: 200, body: page([item("BI-A")]) });

    const result = await runWorkSync(db, { fetchPage, decryptToken, now });

    expect(result.links[0]).toMatchObject({ itemsConflicted: 1 });
    expect(db.backlogItem.upsert).not.toHaveBeenCalled();
    const mirror = db.federatedRecordMirror.upsert.mock.calls.find((c) => c[0].create.recordType === "backlog-item")![0];
    expect(mirror.create).toMatchObject({ syncStatus: "conflict", conflictReason: "local-owned-id" });
  });

  it("retires a mirror whose record disappeared at the origin, only after a complete read", async () => {
    const stale = { mirrorId: "m-gone", localRecordRef: "BI-GONE", version: 1n, syncStatus: "synced" };
    const db = store({ mirrors: [stale] });
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, status: 200, body: page([item("BI-A")]) });

    const result = await runWorkSync(db, { fetchPage, decryptToken, now });

    expect(result.links[0]!.itemsRetired).toBe(1);
    const retire = db.backlogItem.updateMany.mock.calls[0]![0];
    expect(retire.where.itemId.in).toEqual(["BI-GONE"]);
    expect(retire.where.body.contains).toBe(`[origin:federatedWork:${origin}:`);
    expect(retire.data.status).toBe("retired");
  });

  it("follows the cursor across pages and reports a peer that does not serve work sync", async () => {
    const db = store();
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: page([item("BI-A")], { cursor: "BI-A", complete: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: page([item("BI-B")], { epics: [] }) });
    const result = await runWorkSync(db, { fetchPage, decryptToken, now });
    expect(result.links[0]).toMatchObject({ outcome: "synced", pages: 2, itemsCreated: 2 });
    expect(fetchPage.mock.calls[1]![1]).toMatchObject({ cursor: "BI-A" });

    const older = await runWorkSync(store(), { fetchPage: vi.fn().mockResolvedValue({ ok: false, status: 404 }), decryptToken, now });
    expect(older.links[0]).toMatchObject({ outcome: "fetch-failed" });
    expect(older.links[0]!.detail).toMatch(/upgrade the peer/);
    expect(older.failedLinks).toBe(1);
  });

  it("refuses a malformed page and a link without a token, and ignores cross-organization links", async () => {
    const bad = await runWorkSync(store(), { fetchPage: vi.fn().mockResolvedValue({ ok: true, status: 200, body: { nope: true } }), decryptToken, now });
    expect(bad.links[0]!.outcome).toBe("invalid-page");

    const noToken = await runWorkSync(store(), { fetchPage: vi.fn(), decryptToken: () => null, now });
    expect(noToken.links[0]!.outcome).toBe("no-token");

    const db = store();
    db.federationLink.findMany.mockResolvedValue([{ ...link, role: "managed-by" }]);
    const fetchPage = vi.fn();
    const crossOrg = await runWorkSync(db, { fetchPage, decryptToken, now });
    expect(crossOrg.linksChecked).toBe(0);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

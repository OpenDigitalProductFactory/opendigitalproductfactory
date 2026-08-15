import { describe, expect, it, vi } from "vitest";

import {
  hasFederatedDemandOriginMarker,
  relationshipPresetForRole,
  runDemandReconciliation,
  type DemandReconciliationDb,
} from "./demand-reconciliation";

describe("hasFederatedDemandOriginMarker", () => {
  it("matches only a canonical standalone origin-marker line", () => {
    expect(hasFederatedDemandOriginMarker("Context\n[origin:federatedDemand:peer-a:item-1]\nMore")).toBe(true);
    expect(hasFederatedDemandOriginMarker("The marker [origin:federatedDemand:peer-a:item-1] is documented here.")).toBe(false);
    expect(hasFederatedDemandOriginMarker(null)).toBe(false);
  });
});

const links = [{
  linkId: "link_internal",
  role: "same-org-peer",
  peerAuthorityUrl: "https://peer.example",
  peerTokenEnc: "encrypted",
  metadata: null,
}];

describe("relationshipPresetForRole", () => {
  it("derives the approved preset from the closed directional role", () => {
    expect(relationshipPresetForRole("same-org-peer")).toBe("same-organization");
    expect(relationshipPresetForRole("managed-by")).toBe("service-provider");
    expect(relationshipPresetForRole("channel-upstream")).toBe("channel");
    expect(relationshipPresetForRole("community-peer")).toBe("community-peer");
  });
});

describe("runDemandReconciliation", () => {
  it("fault-isolates a throwing item so every other item still projects (BI-8A7E3E56 follow-up)", async () => {
    const mkItem = (id: string) => ({
      itemId: id, title: `Need ${id}`, body: null, workType: "feature", occurrenceCount: 1,
      createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-01T00:00:00Z"), digitalProduct: null,
    });
    // Middle item throws (e.g. an envelope violation); the loop must skip it and
    // keep going — not abort and strand every item after it.
    const queueProjection = vi.fn()
      .mockResolvedValueOnce({ action: "queued" })
      .mockRejectedValueOnce(new Error("Demand projection refused: field:not-allowed:x"))
      .mockResolvedValueOnce({ action: "queued" });
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue(links) },
      backlogItem: { findMany: vi.fn().mockResolvedValue([mkItem("BI-A"), mkItem("BI-B"), mkItem("BI-C")]) },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as DemandReconciliationDb;

    const result = await runDemandReconciliation(db, {
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) }),
      queueProjection,
      queueWithdrawal: vi.fn(),
      reconcileDigests: vi.fn().mockResolvedValue({ linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 }),
      dispatch: vi.fn().mockResolvedValue({ attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 }),
    });

    expect(queueProjection).toHaveBeenCalledTimes(3); // BI-C attempted despite BI-B throwing
    expect(result.projected).toBe(2);
    expect(result.failed).toBe(1);
  });

  it("automatically queues only platform demand on a trusted same-organization link", async () => {
    const queueProjection = vi.fn().mockResolvedValue({ action: "queued" });
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue(links) },
      backlogItem: { findMany: vi.fn().mockResolvedValue([
        {
          itemId: "BI-PLATFORM", title: "Platform capability", body: "Reusable across installations",
          workType: "feature", occurrenceCount: 1,
          createdAt: new Date("2026-07-20T06:00:00Z"), updatedAt: new Date("2026-07-20T06:01:00Z"),
          digitalProduct: { productId: "dpf-portal" },
        },
      ]) },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as DemandReconciliationDb;

    const result = await runDemandReconciliation(db, {
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) }),
      queueProjection,
      queueWithdrawal: vi.fn(),
      reconcileDigests: vi.fn().mockResolvedValue({ linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 }),
      dispatch: vi.fn().mockResolvedValue({ attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 }),
    });

    expect(result.projected).toBe(1);
    expect(queueProjection).toHaveBeenCalledOnce();
    expect(queueProjection.mock.calls[0][1]).toMatchObject({
      link: { linkId: "link_internal" },
      source: { localRecordRef: "BI-PLATFORM", summary: "Reusable across installations", product: "dpf-portal" },
      audience: "internal",
      attribution: "organization",
    });
  });

  it("projects only open backlog items — closed work is excluded from the query", async () => {
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue(links) },
      backlogItem: { findMany: vi.fn().mockResolvedValue([]) },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as DemandReconciliationDb;

    await runDemandReconciliation(db, {
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) }),
      queueProjection: vi.fn(),
      queueWithdrawal: vi.fn(),
      reconcileDigests: vi.fn().mockResolvedValue({ linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 }),
      dispatch: vi.fn().mockResolvedValue({ attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 }),
    });

    expect(db.backlogItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["triaging", "open", "in-progress"] },
      }),
    }));
  });

  it("shares ALL non-sensitive same-org backlog, not just the dpf-portal-tagged subset (BI-8A7E3E56 follow-up)", async () => {
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue(links) },
      backlogItem: { findMany: vi.fn().mockResolvedValue([]) },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as DemandReconciliationDb;

    await runDemandReconciliation(db, {
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) }),
      queueProjection: vi.fn(),
      queueWithdrawal: vi.fn(),
      reconcileDigests: vi.fn().mockResolvedValue({ linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 }),
      dispatch: vi.fn().mockResolvedValue({ attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 }),
    });

    const where = (db.backlogItem.findMany as unknown as { mock: { calls: Array<[{ where: Record<string, unknown> }]> } }).mock.calls[0][0].where;
    // Same-org is trust-by-default: gate on sensitivity, NOT on the dpf-portal product tag.
    expect(where.sensitivity).toEqual({ notIn: ["confidential", "restricted"] });
    expect(where).not.toHaveProperty("digitalProduct");
  });

  it("never re-egresses an adopted peer envelope but keeps explanatory prose eligible", async () => {
    const queueProjection = vi.fn();
    const mkItem = (itemId: string, body: string) => ({
      itemId, title: itemId, body, workType: "bug", occurrenceCount: 1,
      createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-01T00:00:00Z"), digitalProduct: null,
    });
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue(links) },
      backlogItem: { findMany: vi.fn().mockResolvedValue([
        mkItem("BI-ADOPTED", "[origin:federatedDemand:peer-a:item-1]"),
        mkItem("BI-EXPLANATION", "This problem explains [origin:federatedDemand:peer-a:item-1] without adopting it."),
      ]) },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as DemandReconciliationDb;

    await runDemandReconciliation(db, {
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) }),
      queueProjection,
      queueWithdrawal: vi.fn(),
      reconcileDigests: vi.fn().mockResolvedValue({ linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 }),
      dispatch: vi.fn().mockResolvedValue({ attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 }),
    });

    expect(queueProjection).toHaveBeenCalledOnce();
    expect(queueProjection.mock.calls[0]?.[1]).toMatchObject({
      source: { localRecordRef: "BI-EXPLANATION" },
    });
  });

  it("keeps NULL-body items eligible — a bare NOT-contains would drop them (BI-8A7E3E56)", async () => {
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue(links) },
      backlogItem: { findMany: vi.fn().mockResolvedValue([]) },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as DemandReconciliationDb;

    await runDemandReconciliation(db, {
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) }),
      queueProjection: vi.fn(),
      queueWithdrawal: vi.fn(),
      reconcileDigests: vi.fn().mockResolvedValue({ linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 }),
      dispatch: vi.fn().mockResolvedValue({ attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 }),
    });

    const where = (db.backlogItem.findMany as unknown as { mock: { calls: Array<[{ where: Record<string, unknown> }]> } }).mock.calls[0][0].where;
    // Origin-marker eligibility is parsed structurally after retrieval, so the
    // database query must not use a broad body substring filter.
    expect(where).not.toHaveProperty("OR");
    expect(where).not.toHaveProperty("NOT");
  });

  it("queues withdrawal when a previously projected item is no longer policy-eligible", async () => {
    const queueWithdrawal = vi.fn().mockResolvedValue({ action: "queued" });
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue(links) },
      backlogItem: { findMany: vi.fn().mockResolvedValue([]) },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([{ localRecordRef: "BI-NO-LONGER-ELIGIBLE" }]) },
    } as unknown as DemandReconciliationDb;

    const result = await runDemandReconciliation(db, {
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) }),
      queueProjection: vi.fn(),
      queueWithdrawal,
      reconcileDigests: vi.fn().mockResolvedValue({ linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 }),
      dispatch: vi.fn().mockResolvedValue({ attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 }),
      now: new Date("2026-07-20T06:10:00Z"),
    });

    expect(result.withdrawn).toBe(1);
    expect(queueWithdrawal).toHaveBeenCalledWith(
      expect.anything(), "link_internal", "BI-NO-LONGER-ELIGIBLE", new Date("2026-07-20T06:10:00Z"),
    );
  });

  it("does not auto-project reseller, channel, or community links", async () => {
    const queueProjection = vi.fn();
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue([
        { ...links[0], linkId: "link_channel", role: "channel-upstream" },
      ]) },
      backlogItem: { findMany: vi.fn() },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as DemandReconciliationDb;

    const result = await runDemandReconciliation(db, {
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) }),
      queueProjection, queueWithdrawal: vi.fn(),
      reconcileDigests: vi.fn().mockResolvedValue({ linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 }),
      dispatch: vi.fn().mockResolvedValue({ attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 }),
    });

    expect(result.projected).toBe(0);
    expect(db.backlogItem.findMany).not.toHaveBeenCalled();
    expect(queueProjection).not.toHaveBeenCalled();
  });
});

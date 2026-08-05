import { describe, expect, it, vi } from "vitest";

import {
  relationshipPresetForRole,
  runDemandReconciliation,
  type DemandReconciliationDb,
} from "./demand-reconciliation";

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

  it("never re-egresses a locally adopted peer envelope", async () => {
    const queueProjection = vi.fn();
    const db = {
      federationLink: { findMany: vi.fn().mockResolvedValue(links) },
      backlogItem: { findMany: vi.fn().mockResolvedValue([]) },
      federatedRecordMirror: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as DemandReconciliationDb;

    await runDemandReconciliation(db, {
      resolveIdentity: vi.fn().mockResolvedValue({ installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) }),
      queueProjection,
      queueWithdrawal: vi.fn(),
      reconcileDigests: vi.fn().mockResolvedValue({ linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 }),
      dispatch: vi.fn().mockResolvedValue({ attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 }),
    });

    expect(db.backlogItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        NOT: { body: { contains: "[origin:federatedDemand:" } },
      }),
    }));
    expect(queueProjection).not.toHaveBeenCalled();
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

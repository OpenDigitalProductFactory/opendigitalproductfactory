import { describe, expect, it, vi } from "vitest";
import { getPromotionAudit } from "./promotion-audit";

describe("getPromotionAudit", () => {
  function mockDb() {
    const inventoryEntityCount = vi.fn();
    const qualityIssueCount = vi.fn();
    const qualityIssueFindMany = vi.fn();
    return {
      db: {
        inventoryEntity: { count: inventoryEntityCount },
        portfolioQualityIssue: { count: qualityIssueCount, findMany: qualityIssueFindMany },
      },
      inventoryEntityCount,
      qualityIssueCount,
      qualityIssueFindMany,
    };
  }

  it("returns zero counts and empty groups against an empty DB", async () => {
    const { db, inventoryEntityCount, qualityIssueCount, qualityIssueFindMany } = mockDb();
    inventoryEntityCount.mockResolvedValue(0);
    qualityIssueCount.mockResolvedValue(0);
    qualityIssueFindMany.mockResolvedValue([]);

    const result = await getPromotionAudit(db as never);
    expect(result.counts).toEqual({ discovered: 0, attributed: 0, promoted: 0, blocked: 0 });
    expect(result.blockedByReason.type_not_promotable.count).toBe(0);
    expect(result.blockedByReason.no_taxonomy.count).toBe(0);
    expect(result.blockedByReason.no_portfolio_root.count).toBe(0);
    expect(result.blockedByReason.low_confidence_promotion.count).toBe(0);
  });

  it("aggregates inventory counts correctly", async () => {
    const { db, inventoryEntityCount, qualityIssueCount, qualityIssueFindMany } = mockDb();
    inventoryEntityCount
      .mockResolvedValueOnce(218) // discovered
      .mockResolvedValueOnce(140) // attributed
      .mockResolvedValueOnce(100); // promoted
    qualityIssueCount.mockResolvedValue(78);
    qualityIssueFindMany.mockResolvedValue([]);

    const result = await getPromotionAudit(db as never);
    expect(result.counts).toEqual({ discovered: 218, attributed: 140, promoted: 100, blocked: 78 });
  });

  it("groups blocked entities by reason with sample summaries", async () => {
    const { db, inventoryEntityCount, qualityIssueCount, qualityIssueFindMany } = mockDb();
    inventoryEntityCount.mockResolvedValue(1);
    qualityIssueCount.mockResolvedValue(1);
    qualityIssueFindMany.mockImplementation(({ where }) => {
      if (where.issueType === "type_not_promotable") {
        return Promise.resolve([
          {
            id: "qi_1",
            issueType: "type_not_promotable",
            lastDetectedAt: new Date("2026-04-30"),
            inventoryEntity: {
              id: "ent_1",
              entityKey: "network_client:lan-host",
              entityType: "network_client",
              name: "LAN Host",
              attributionConfidence: 0.98,
              taxonomyNodeId: "tn_net",
              lastSeenAt: new Date("2026-04-30"),
              taxonomyNode: { nodeId: "foundational/network_management/network_connectivity" },
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await getPromotionAudit(db as never);
    expect(result.blockedByReason.type_not_promotable.sample).toHaveLength(1);
    expect(result.blockedByReason.type_not_promotable.sample[0]).toEqual({
      id: "ent_1",
      entityKey: "network_client:lan-host",
      entityType: "network_client",
      name: "LAN Host",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn_net",
      taxonomyNodePath: "foundational/network_management/network_connectivity",
      lastSeenAt: new Date("2026-04-30"),
    });
  });

  it("filters out blocked rows with null inventoryEntity (defensive)", async () => {
    const { db, inventoryEntityCount, qualityIssueCount, qualityIssueFindMany } = mockDb();
    inventoryEntityCount.mockResolvedValue(0);
    qualityIssueCount.mockResolvedValue(0);
    qualityIssueFindMany.mockImplementation(({ where }) => {
      if (where.issueType === "no_taxonomy") {
        return Promise.resolve([
          {
            id: "qi_orphan",
            issueType: "no_taxonomy",
            lastDetectedAt: new Date(),
            inventoryEntity: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await getPromotionAudit(db as never);
    expect(result.blockedByReason.no_taxonomy.sample).toEqual([]);
  });

  it("requests at most 10 samples per reason (orderBy lastDetectedAt desc)", async () => {
    const { db, inventoryEntityCount, qualityIssueCount, qualityIssueFindMany } = mockDb();
    inventoryEntityCount.mockResolvedValue(0);
    qualityIssueCount.mockResolvedValue(0);
    qualityIssueFindMany.mockResolvedValue([]);

    await getPromotionAudit(db as never);

    // Each of the 4 reasons should call findMany with take:10 + the right ordering.
    expect(qualityIssueFindMany).toHaveBeenCalledTimes(4);
    for (const call of qualityIssueFindMany.mock.calls) {
      expect(call[0].take).toBe(10);
      expect(call[0].orderBy).toEqual({ lastDetectedAt: "desc" });
      expect(call[0].where.status).toBe("open");
    }
  });

  it("uses promoted count = entities with non-null digitalProductId", async () => {
    const { db, inventoryEntityCount, qualityIssueCount, qualityIssueFindMany } = mockDb();
    inventoryEntityCount.mockResolvedValue(0);
    qualityIssueCount.mockResolvedValue(0);
    qualityIssueFindMany.mockResolvedValue([]);

    await getPromotionAudit(db as never);
    // Third inventoryEntity.count call should be the "promoted" filter.
    const promotedCall = inventoryEntityCount.mock.calls[2];
    expect(promotedCall[0]?.where).toEqual({ digitalProductId: { not: null } });
  });
});

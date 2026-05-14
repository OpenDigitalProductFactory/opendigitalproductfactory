import { describe, expect, it, vi } from "vitest";
import { computePortfolioCompleteness } from "./completeness";

describe("computePortfolioCompleteness", () => {
  function mockDb() {
    const findMany = vi.fn();
    const groupBy = vi.fn();
    return {
      db: {
        digitalProduct: { findMany },
        portfolioQualityIssue: { groupBy },
      },
      findMany,
      groupBy,
    };
  }

  it("returns null scores + zero count when portfolio has no products", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([]);
    groupBy.mockResolvedValue([]);

    const result = await computePortfolioCompleteness("p_1", db as never);
    expect(result.requiredFieldsScore).toBeNull();
    expect(result.enrichmentScore).toBeNull();
    expect(result.openIssuesByType).toEqual({});
    expect(result.productCount).toBe(0);
  });

  it("returns null required-fields score when no node defines requiredFields", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([
      {
        id: "dp_1",
        manufacturer: "Acme",
        taxonomyNode: { governance: null },
        observationConfig: null,
      },
      {
        id: "dp_2",
        manufacturer: null,
        taxonomyNode: { governance: { promotion: { mode: "auto" } } }, // no requiredFields
        observationConfig: null,
      },
    ]);
    groupBy.mockResolvedValue([]);

    const result = await computePortfolioCompleteness("p_1", db as never);
    expect(result.requiredFieldsScore).toBeNull();
    expect(result.productCount).toBe(2);
  });

  it("computes required-fields score across products with requiredFields", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([
      // Complete: both required fields populated.
      {
        id: "dp_1",
        manufacturer: "Acme",
        observedVersion: "1.0",
        taxonomyNode: { governance: { requiredFields: ["manufacturer", "observedVersion"] } },
        observationConfig: null,
      },
      // Incomplete: missing observedVersion.
      {
        id: "dp_2",
        manufacturer: "Acme",
        observedVersion: null,
        taxonomyNode: { governance: { requiredFields: ["manufacturer", "observedVersion"] } },
        observationConfig: null,
      },
      // Not gated: no requiredFields.
      {
        id: "dp_3",
        manufacturer: null,
        taxonomyNode: { governance: { promotion: { mode: "auto" } } },
        observationConfig: null,
      },
    ]);
    groupBy.mockResolvedValue([]);

    const result = await computePortfolioCompleteness("p_1", db as never);
    // 1 of 2 gated products is complete = 50%
    expect(result.requiredFieldsScore).toBe(50);
    expect(result.productCount).toBe(3);
  });

  it("supports dot-paths in requiredFields (e.g. observationConfig.classifyAs)", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([
      {
        id: "dp_1",
        observationConfig: { classifyAs: "infrastructure_endpoint" },
        taxonomyNode: { governance: { requiredFields: ["observationConfig.classifyAs"] } },
      },
      {
        id: "dp_2",
        observationConfig: null,
        taxonomyNode: { governance: { requiredFields: ["observationConfig.classifyAs"] } },
      },
    ]);
    groupBy.mockResolvedValue([]);

    const result = await computePortfolioCompleteness("p_1", db as never);
    expect(result.requiredFieldsScore).toBe(50);
  });

  it("treats malformed requiredFields shape as empty (defensive)", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([
      {
        id: "dp_1",
        manufacturer: null,
        taxonomyNode: { governance: { requiredFields: "not-an-array" } },
        observationConfig: null,
      },
    ]);
    groupBy.mockResolvedValue([]);

    const result = await computePortfolioCompleteness("p_1", db as never);
    expect(result.requiredFieldsScore).toBeNull();
  });

  it("returns null enrichmentScore when no product has the field", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([
      // No enrichmentStatus column populated (Chunk 4 hasn't shipped on this install)
      { id: "dp_1", taxonomyNode: { governance: null }, observationConfig: null },
      { id: "dp_2", taxonomyNode: { governance: null }, observationConfig: null },
    ]);
    groupBy.mockResolvedValue([]);

    const result = await computePortfolioCompleteness("p_1", db as never);
    expect(result.enrichmentScore).toBeNull();
  });

  it("computes enrichmentScore across products that DO have the field set", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([
      { id: "dp_1", enrichmentStatus: "enriched", taxonomyNode: { governance: null }, observationConfig: null },
      { id: "dp_2", enrichmentStatus: "pending", taxonomyNode: { governance: null }, observationConfig: null },
      { id: "dp_3", enrichmentStatus: "partial", taxonomyNode: { governance: null }, observationConfig: null },
      { id: "dp_4", enrichmentStatus: "enriched", taxonomyNode: { governance: null }, observationConfig: null },
    ]);
    groupBy.mockResolvedValue([]);

    const result = await computePortfolioCompleteness("p_1", db as never);
    // 2 of 4 enriched = 50%
    expect(result.enrichmentScore).toBe(50);
  });

  it("collects openIssuesByType from groupBy", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([]);
    groupBy.mockResolvedValue([
      { issueType: "type_not_promotable", _count: { _all: 5 } },
      { issueType: "incomplete_detail", _count: { _all: 3 } },
    ]);

    const result = await computePortfolioCompleteness("p_1", db as never);
    expect(result.openIssuesByType).toEqual({
      type_not_promotable: 5,
      incomplete_detail: 3,
    });
  });

  it("groupBy is filtered to status:'open' and the requested portfolioId", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([]);
    groupBy.mockResolvedValue([]);

    await computePortfolioCompleteness("p_42", db as never);

    expect(groupBy).toHaveBeenCalledTimes(1);
    const args = groupBy.mock.calls[0][0];
    expect(args.where).toEqual({ portfolioId: "p_42", status: "open" });
    expect(args.by).toEqual(["issueType"]);
  });

  it("selects schema-owned DigitalProduct fields and linked inventory metadata", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([]);
    groupBy.mockResolvedValue([]);

    await computePortfolioCompleteness("p_select", db as never);

    const select = findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({
      id: true,
      observationConfig: true,
      taxonomyNode: { select: { governance: true } },
      inventoryEntities: {
        select: {
          manufacturer: true,
          observedVersion: true,
        },
      },
    });
    expect(select).not.toHaveProperty("manufacturer");
    expect(select).not.toHaveProperty("observedVersion");
    expect(select).not.toHaveProperty("enrichmentStatus");
  });

  it("resolves required manufacturer/version fields from the primary inventory entity", async () => {
    const { db, findMany, groupBy } = mockDb();
    findMany.mockResolvedValue([
      {
        id: "dp_1",
        inventoryEntities: [{ manufacturer: "Acme", observedVersion: "1.0" }],
        taxonomyNode: { governance: { requiredFields: ["manufacturer", "observedVersion"] } },
        observationConfig: null,
      },
      {
        id: "dp_2",
        inventoryEntities: [{ manufacturer: "Acme", observedVersion: null }],
        taxonomyNode: { governance: { requiredFields: ["manufacturer", "observedVersion"] } },
        observationConfig: null,
      },
    ]);
    groupBy.mockResolvedValue([]);

    const result = await computePortfolioCompleteness("p_1", db as never);

    expect(result.requiredFieldsScore).toBe(50);
  });
});

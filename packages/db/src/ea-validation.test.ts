// packages/db/src/ea-validation.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the entire @dpf/db module so we control what prisma returns
vi.mock("./client.js", () => ({
  prisma: {
    eaElement:         { findUnique: vi.fn(), count: vi.fn() },
    eaRelationshipRule: { findFirst: vi.fn() },
    eaElementType:     { findUnique: vi.fn(), findFirst: vi.fn() },
    eaDqRule:          { findMany: vi.fn() },
    eaRelationship:    { count: vi.fn() },
    eaRelationshipType: { findFirst: vi.fn() },
  },
}));

import { prisma } from "./client.js";
import {
  validateEaRelationship,
  validateEaLifecycle,
  checkEaDqRules,
} from "./ea-validation.js";

const mockPrisma = prisma as unknown as {
  eaElement:           { findUnique: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  eaRelationshipRule:  { findFirst:  ReturnType<typeof vi.fn> };
  eaElementType:       { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  eaDqRule:            { findMany:   ReturnType<typeof vi.fn> };
  eaRelationship:      { count:      ReturnType<typeof vi.fn> };
  eaRelationshipType:  { findFirst:  ReturnType<typeof vi.fn> };
};

beforeEach(() => { vi.clearAllMocks(); });

// ─── validateEaRelationship ────────────────────────────────────────────────────

describe("validateEaRelationship", () => {
  it("returns valid:true when a matching rule exists", async () => {
    mockPrisma.eaElement.findUnique
      .mockResolvedValueOnce({ elementTypeId: "et-app" })
      .mockResolvedValueOnce({ elementTypeId: "et-biz" });
    mockPrisma.eaRelationshipRule.findFirst.mockResolvedValueOnce({ id: "rule-1" });

    const result = await validateEaRelationship("el-1", "el-2", "rt-1");
    expect(result).toEqual({ valid: true });
  });

  it("returns valid:false when no matching rule exists", async () => {
    mockPrisma.eaElement.findUnique
      .mockResolvedValueOnce({ elementTypeId: "et-app" })
      .mockResolvedValueOnce({ elementTypeId: "et-biz" });
    mockPrisma.eaRelationshipRule.findFirst.mockResolvedValueOnce(null);

    const result = await validateEaRelationship("el-1", "el-2", "rt-1");
    expect(result.valid).toBe(false);
  });

  it("returns valid:false when fromElement is not found", async () => {
    mockPrisma.eaElement.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ elementTypeId: "et-biz" });

    const result = await validateEaRelationship("el-missing", "el-2", "rt-1");
    expect(result.valid).toBe(false);
  });

  it("returns valid:false when toElement is not found", async () => {
    mockPrisma.eaElement.findUnique
      .mockResolvedValueOnce({ elementTypeId: "et-app" })
      .mockResolvedValueOnce(null);

    const result = await validateEaRelationship("el-1", "el-missing", "rt-1");
    expect(result.valid).toBe(false);
  });
});

// ─── validateEaLifecycle ──────────────────────────────────────────────────────

describe("validateEaLifecycle", () => {
  it("returns valid:true for a valid stage/status combination", async () => {
    mockPrisma.eaElementType.findUnique.mockResolvedValueOnce({
      validLifecycleStages:   ["plan", "design", "production"],
      validLifecycleStatuses: ["draft", "active"],
    });

    const result = await validateEaLifecycle("et-1", "plan", "draft");
    expect(result).toEqual({ valid: true });
  });

  it("returns valid:false for a stage not in validLifecycleStages", async () => {
    mockPrisma.eaElementType.findUnique.mockResolvedValueOnce({
      validLifecycleStages:   ["plan", "design"],
      validLifecycleStatuses: ["draft", "active"],
    });

    const result = await validateEaLifecycle("et-1", "retirement", "inactive");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("retirement");
  });

  it("returns valid:false for a status not in validLifecycleStatuses", async () => {
    mockPrisma.eaElementType.findUnique.mockResolvedValueOnce({
      validLifecycleStages:   ["plan", "design", "production"],
      validLifecycleStatuses: ["draft", "active"],
    });

    const result = await validateEaLifecycle("et-1", "plan", "inactive");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("inactive");
  });

  it("returns valid:false when element type is not found", async () => {
    mockPrisma.eaElementType.findUnique.mockResolvedValueOnce(null);
    const result = await validateEaLifecycle("et-missing", "plan", "draft");
    expect(result.valid).toBe(false);
  });
});

// ─── checkEaDqRules ───────────────────────────────────────────────────────────

describe("checkEaDqRules", () => {
  it("returns empty array when no DQ rules apply", async () => {
    mockPrisma.eaElement.findUnique.mockResolvedValueOnce({ elementTypeId: "et-1", digitalProductId: null, notationSlug: null, elementType: { notationId: "n-1" } });
    mockPrisma.eaDqRule.findMany.mockResolvedValueOnce([]);

    const violations = await checkEaDqRules("el-1", "design");
    expect(violations).toEqual([]);
  });

  it("returns a violation with severity:error when a required relationship is missing", async () => {
    mockPrisma.eaElement.findUnique.mockResolvedValueOnce({
      id: "el-1",
      elementTypeId: "et-app",
      digitalProductId: null,
      elementType: { notationId: "n-1" },
    });
    mockPrisma.eaDqRule.findMany.mockResolvedValueOnce([
      {
        id: "dq-1",
        name: "Must have TechnologyNode",
        description: null,
        severity: "error",
        rule: { requires: { relationshipType: "depends_on", toElementType: "technology_node", minCount: 1 } },
      },
    ]);
    // Relationship count = 0 (rule not satisfied)
    mockPrisma.eaRelationshipType.findFirst.mockResolvedValueOnce({ id: "rt-1" });
    mockPrisma.eaElementType.findFirst.mockResolvedValueOnce({ id: "et-tech" });
    mockPrisma.eaRelationship.count.mockResolvedValueOnce(0);

    const violations = await checkEaDqRules("el-1", "production");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("error");
    expect(violations[0]!.ruleId).toBe("dq-1");
  });

  it("returns no violation when the required relationship exists", async () => {
    mockPrisma.eaElement.findUnique.mockResolvedValueOnce({
      id: "el-1",
      elementTypeId: "et-app",
      digitalProductId: null,
      elementType: { notationId: "n-1" },
    });
    mockPrisma.eaDqRule.findMany.mockResolvedValueOnce([
      {
        id: "dq-1",
        name: "Must have TechnologyNode",
        description: null,
        severity: "error",
        rule: { requires: { relationshipType: "depends_on", toElementType: "technology_node", minCount: 1 } },
      },
    ]);
    // Relationship count = 1 (rule satisfied)
    mockPrisma.eaRelationshipType.findFirst.mockResolvedValueOnce({ id: "rt-1" });
    mockPrisma.eaElementType.findFirst.mockResolvedValueOnce({ id: "et-tech" });
    mockPrisma.eaRelationship.count.mockResolvedValueOnce(1);

    const violations = await checkEaDqRules("el-1", "production");
    expect(violations).toHaveLength(0);
  });

  it("returns a warn violation for duplicate bridge", async () => {
    mockPrisma.eaElement.findUnique.mockResolvedValueOnce({
      id: "el-1",
      elementTypeId: "et-app",
      digitalProductId: "dp-123",
      elementType: { notationId: "n-1" },
    });
    mockPrisma.eaDqRule.findMany.mockResolvedValueOnce([
      {
        id: "dq-2",
        name: "Collision: duplicate DigitalProduct bridge",
        description: "Change programme collision",
        severity: "warn",
        rule: { warns: { duplicateBridge: { lifecycleStage: "design", maxCount: 1 } } },
      },
    ]);
    // Another element with same digitalProductId in design stage exists — count = 2 means collision
    // (evaluateDqRule uses eaElement.count, not findUnique, for duplicateBridge checks)
    mockPrisma.eaElement.count.mockResolvedValueOnce(2);

    const violations = await checkEaDqRules("el-1", "build");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("warn");
  });
});

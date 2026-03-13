// apps/web/lib/actions/ea.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth and permissions
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    eaElement: {
      create:     vi.fn(),
      update:     vi.fn(),
      delete:     vi.fn(),
      findUnique: vi.fn(),
    },
    eaRelationship: {
      create:     vi.fn(),
      delete:     vi.fn(),
      findUnique: vi.fn(),
    },
    eaView:    { create: vi.fn(), update: vi.fn() },
    eaElementType: { findUnique: vi.fn() },
    eaRelationshipType: { findUnique: vi.fn() },
  },
}));

// Mock validation
vi.mock("@dpf/db/ea-validation", () => ({
  validateEaLifecycle:    vi.fn(),
  validateEaRelationship: vi.fn(),
  checkEaDqRules:         vi.fn(),
}));

// Mock neo4j sync
vi.mock("@dpf/db/neo4j-sync", () => ({
  syncEaElement:        vi.fn(),
  syncEaRelationship:   vi.fn(),
  deleteEaElement:      vi.fn(),
  deleteEaRelationship: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { can }  from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { validateEaLifecycle, validateEaRelationship, checkEaDqRules } from "@dpf/db/ea-validation";
import {
  createEaElement,
  createEaRelationship,
  advanceEaLifecycle,
  deleteEaElement,
} from "./ea";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan  = can  as ReturnType<typeof vi.fn>;
const mockValidateLifecycle    = validateEaLifecycle    as ReturnType<typeof vi.fn>;
const mockValidateRelationship = validateEaRelationship as ReturnType<typeof vi.fn>;
const mockCheckDqRules         = checkEaDqRules         as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as any;

const authorizedSession = { user: { platformRole: "HR-300", isSuperuser: false } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authorizedSession);
  mockCan.mockReturnValue(true);
});

// ─── createEaElement ──────────────────────────────────────────────────────────

describe("createEaElement", () => {
  it("creates element when lifecycle is valid", async () => {
    mockValidateLifecycle.mockResolvedValue({ valid: true });
    mockPrisma.eaElement.create.mockResolvedValue({ id: "el-1" });
    mockPrisma.eaElementType.findUnique.mockResolvedValue({
      id: "et-1", neoLabel: "ArchiMate__ApplicationComponent", slug: "application_component",
      notation: { slug: "archimate4" },
    });

    await createEaElement({ elementTypeId: "et-1", name: "Order API", lifecycleStage: "plan", lifecycleStatus: "draft" });

    expect(mockPrisma.eaElement.create).toHaveBeenCalledOnce();
  });

  it("throws when lifecycle validation fails", async () => {
    mockValidateLifecycle.mockResolvedValue({ valid: false, reason: "Stage not valid" });

    await expect(
      createEaElement({ elementTypeId: "et-1", name: "Order API", lifecycleStage: "retirement", lifecycleStatus: "inactive" })
    ).rejects.toThrow("Stage not valid");
  });

  it("throws Unauthorized when user lacks manage_ea_model", async () => {
    mockCan.mockReturnValue(false);

    await expect(
      createEaElement({ elementTypeId: "et-1", name: "Order API", lifecycleStage: "plan", lifecycleStatus: "draft" })
    ).rejects.toThrow("Unauthorized");
  });
});

// ─── createEaRelationship ─────────────────────────────────────────────────────

describe("createEaRelationship", () => {
  it("creates relationship when rule exists", async () => {
    mockValidateRelationship.mockResolvedValue({ valid: true });
    mockPrisma.eaRelationshipType.findUnique.mockResolvedValue({
      id: "rt-1", neoType: "REALIZES", slug: "realizes", notation: { slug: "archimate4" },
    });
    mockPrisma.eaRelationship.create.mockResolvedValue({ id: "rel-1" });

    await createEaRelationship({ fromElementId: "el-1", toElementId: "el-2", relationshipTypeId: "rt-1" });

    expect(mockPrisma.eaRelationship.create).toHaveBeenCalledOnce();
  });

  it("throws when no matching rule", async () => {
    mockValidateRelationship.mockResolvedValue({ valid: false, reason: "Relationship not permitted" });

    await expect(
      createEaRelationship({ fromElementId: "el-1", toElementId: "el-2", relationshipTypeId: "rt-1" })
    ).rejects.toThrow("Relationship not permitted");
  });
});

// ─── advanceEaLifecycle ────────────────────────────────────────────────────────

describe("advanceEaLifecycle", () => {
  const element = {
    id: "el-1", elementTypeId: "et-1", lifecycleStage: "design", lifecycleStatus: "active",
    elementType: {
      slug: "application_component", neoLabel: "ArchiMate__ApplicationComponent",
      validLifecycleStatuses: ["draft", "active"],
      notation: { slug: "archimate4" },
    },
    digitalProductId: "dp-1", infraCiKey: null, portfolioId: null, portfolio: null, taxonomyNodeId: null,
  };

  it("advances stage when no error violations", async () => {
    // First findUnique: preliminary fetch for validateEaLifecycle
    mockPrisma.eaElement.findUnique.mockResolvedValueOnce({ elementTypeId: "et-1", lifecycleStatus: "active" });
    // Second findUnique: full element fetch for update
    mockPrisma.eaElement.findUnique.mockResolvedValueOnce(element);
    mockCheckDqRules.mockResolvedValue([]); // no violations
    mockValidateLifecycle.mockResolvedValue({ valid: true });
    mockPrisma.eaElement.update.mockResolvedValue({ ...element, lifecycleStage: "build" });
    mockPrisma.eaElementType.findUnique.mockResolvedValue(element.elementType);

    const result = await advanceEaLifecycle("el-1", "build");
    expect(result.advanced).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("blocks advance when error violations exist", async () => {
    mockPrisma.eaElement.findUnique.mockResolvedValue(element);
    mockCheckDqRules.mockResolvedValue([
      { ruleId: "dq-1", name: "Must bridge DigitalProduct", description: null, severity: "error" },
    ]);

    const result = await advanceEaLifecycle("el-1", "build");
    expect(result.advanced).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(mockPrisma.eaElement.update).not.toHaveBeenCalled();
  });

  it("advances with warnings when only warn violations exist", async () => {
    // First findUnique: preliminary fetch for validateEaLifecycle
    mockPrisma.eaElement.findUnique.mockResolvedValueOnce({ elementTypeId: "et-1", lifecycleStatus: "active" });
    // Second findUnique: full element fetch for update
    mockPrisma.eaElement.findUnique.mockResolvedValueOnce(element);
    mockCheckDqRules.mockResolvedValue([
      { ruleId: "dq-2", name: "Collision warning", description: null, severity: "warn" },
    ]);
    mockValidateLifecycle.mockResolvedValue({ valid: true });
    mockPrisma.eaElement.update.mockResolvedValue({ ...element, lifecycleStage: "build" });
    mockPrisma.eaElementType.findUnique.mockResolvedValue(element.elementType);

    const result = await advanceEaLifecycle("el-1", "build");
    expect(result.advanced).toBe(true);
    expect(result.canProceed).toBe(true);
    expect(result.violations[0]!.severity).toBe("warn");
  });
});

// ─── deleteEaElement ──────────────────────────────────────────────────────────

describe("deleteEaElement", () => {
  it("deletes element from Postgres and fires Neo4j sync", async () => {
    mockPrisma.eaElement.delete.mockResolvedValue({ id: "el-1" });
    const { deleteEaElement: neoDeleteSpy } = await import("@dpf/db/neo4j-sync");

    await deleteEaElement("el-1");

    expect(mockPrisma.eaElement.delete).toHaveBeenCalledWith({ where: { id: "el-1" } });
    // Neo4j delete is fire-and-forget; assert it was called (the mock returns void)
    expect(neoDeleteSpy).toHaveBeenCalledWith("el-1");
  });
});

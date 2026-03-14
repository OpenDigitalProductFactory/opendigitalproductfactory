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
    eaReferenceAssessment: {
      update: vi.fn(),
    },
    eaReferenceProposal: {
      update: vi.fn(),
    },
    eaView:    { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    eaElementType: { findUnique: vi.fn() },
    eaRelationshipType: { findUnique: vi.fn() },
    eaViewElement: {
      create:     vi.fn(),
      delete:     vi.fn(),
      findUnique: vi.fn(),
      findMany:   vi.fn(),
      update:     vi.fn(),
      updateMany: vi.fn(),
    },
    eaConformanceIssue: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    viewpointDefinition: { findUnique: vi.fn() },
    $transaction: vi.fn(),
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
  addElementToView,
  moveStructuredViewElement,
  removeElementFromView,
  updateProposedProperties,
  saveCanvasState,
  updateReferenceAssessment,
  reviewReferenceProposal,
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
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)
  );
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

describe("updateReferenceAssessment", () => {
  it("updates an assessment coverage status", async () => {
    mockPrisma.eaReferenceAssessment.update.mockResolvedValue({
      id: "asmt-1",
      coverageStatus: "partial",
      rationale: "workflow exists but is incomplete",
      mvpIncluded: true,
    });

    const result = await updateReferenceAssessment({
      assessmentId: "asmt-1",
      coverageStatus: "partial",
      rationale: "workflow exists but is incomplete",
    });

    expect(result.coverageStatus).toBe("partial");
    expect(mockPrisma.eaReferenceAssessment.update).toHaveBeenCalledOnce();
  });

  it("rejects unsupported coverage statuses", async () => {
    await expect(
      updateReferenceAssessment({
        assessmentId: "asmt-1",
        coverageStatus: "unknown" as "implemented",
      })
    ).rejects.toThrow("Invalid coverage status");
  });
});

describe("reviewReferenceProposal", () => {
  it("updates proposal review status", async () => {
    mockPrisma.eaReferenceProposal.update.mockResolvedValue({
      id: "prop-1",
      status: "approved",
      reviewNotes: "looks correct",
    });

    const result = await reviewReferenceProposal({
      proposalId: "prop-1",
      status: "approved",
      reviewNotes: "looks correct",
    });

    expect(result.status).toBe("approved");
    expect(mockPrisma.eaReferenceProposal.update).toHaveBeenCalledOnce();
  });
});

describe("addElementToView", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { platformRole: "HR-000", isSuperuser: false, id: "u1" } });
    mockCan.mockReturnValue(true);
  });

  it("mode=new — valid type — creates element and view element", async () => {
    const mockElementType = { id: "et1", slug: "app_component", neoLabel: "AppComponent" };
    const mockView = {
      id: "v1",
      viewpoint: { allowedElementTypeSlugs: ["app_component"], allowedRelTypeSlugs: [] },
      canvasState: null,
    };
    const mockElement = { id: "e1", name: "Order API", elementTypeId: "et1", portfolioId: null, infraCiKey: null };
    const mockViewElement = { id: "ve1", mode: "new", elementId: "e1" };

    (prisma.eaView.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockView);
    (prisma.eaElementType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockElementType);
    mockValidateLifecycle.mockResolvedValue({ valid: true });
    (prisma.eaElement.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockElement);
    (prisma.eaViewElement.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockViewElement);
    (prisma.eaView.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await addElementToView({
      viewId: "v1",
      mode: "new",
      elementTypeId: "et1",
      name: "Order API",
      initialX: 100,
      initialY: 200,
    });

    expect(result).toEqual({ viewElement: { id: "ve1", mode: "new", elementId: "e1" } });
    expect(prisma.eaElement.create).toHaveBeenCalledOnce();
    expect(prisma.eaViewElement.create).toHaveBeenCalledOnce();
    expect(prisma.eaView.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v1" } })
    );
  });

  it("type not allowed by viewpoint — returns error", async () => {
    const mockView = {
      id: "v1",
      viewpoint: { allowedElementTypeSlugs: ["business_capability"], allowedRelTypeSlugs: [] },
      canvasState: null,
    };
    (prisma.eaView.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockView);
    (prisma.eaElementType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ slug: "app_component" });

    const result = await addElementToView({
      viewId: "v1",
      mode: "new",
      elementTypeId: "et1",
      name: "Order API",
      initialX: 0,
      initialY: 0,
    });

    expect(result).toEqual({ error: "ElementTypeNotAllowedByViewpoint" });
  });

  it("mode=reference — duplicate — returns ElementAlreadyOnView", async () => {
    const mockView = {
      id: "v1",
      viewpoint: { allowedElementTypeSlugs: ["app_component"], allowedRelTypeSlugs: [] },
      canvasState: null,
    };
    const mockElement = { id: "e1", elementType: { slug: "app_component" } };
    (prisma.eaView.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockView);
    (prisma.eaElement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockElement);
    const prismaUniqueError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    (prisma.eaViewElement.create as ReturnType<typeof vi.fn>).mockRejectedValue(prismaUniqueError);

    const result = await addElementToView({
      viewId: "v1",
      mode: "reference",
      elementId: "e1",
      initialX: 0,
      initialY: 0,
    });

    expect(result).toEqual({ error: "ElementAlreadyOnView" });
  });

  it("mode=propose — creates viewElement with mode=propose", async () => {
    const mockView = {
      id: "v1",
      viewpoint: { allowedElementTypeSlugs: ["application_component"], allowedRelTypeSlugs: [] },
      canvasState: null,
    };
    const mockElement = { id: "e1", elementType: { slug: "application_component" } };
    const mockViewElement = { id: "ve1", mode: "propose", elementId: "e1" };
    (prisma.eaView.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockView);
    (prisma.eaElement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockElement);
    (prisma.eaViewElement.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockViewElement);
    (prisma.eaView.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const result = await addElementToView({
      viewId: "v1",
      mode: "propose",
      elementId: "e1",
      initialX: 50,
      initialY: 75,
    });
    expect(result).toEqual({ viewElement: { id: "ve1", mode: "propose", elementId: "e1" } });
    expect(prisma.eaViewElement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mode: "propose" }) })
    );
  });

  it("mode=new — initial position written into canvasState", async () => {
    const mockElementType = { id: "et1", slug: "application_component", neoLabel: "ArchiMate__ApplicationComponent", notation: { slug: "archimate4" } };
    const mockView = {
      id: "v1",
      viewpoint: { allowedElementTypeSlugs: ["application_component"], allowedRelTypeSlugs: [] },
      canvasState: null,
    };
    const mockElement = { id: "e1", name: "Order API", elementTypeId: "et1", portfolioId: null, infraCiKey: null };
    const mockViewElement = { id: "ve1", mode: "new", elementId: "e1" };
    (prisma.eaView.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockView);
    (prisma.eaElementType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockElementType);
    mockValidateLifecycle.mockResolvedValue({ valid: true });
    (prisma.eaElement.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockElement);
    (prisma.eaViewElement.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockViewElement);
    (prisma.eaView.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await addElementToView({
      viewId: "v1",
      mode: "new",
      elementTypeId: "et1",
      name: "Order API",
      initialX: 120,
      initialY: 300,
    });
    expect(prisma.eaView.update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: expect.objectContaining({
        canvasState: expect.objectContaining({
          nodes: { ve1: { x: 120, y: 300 } },
        }),
      }),
    });
  });
});

describe("removeElementFromView", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { platformRole: "HR-000", isSuperuser: false, id: "u1" } });
    mockCan.mockReturnValue(true);
  });

  it("existing id — deletes and returns no error", async () => {
    (prisma.eaViewElement.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const result = await removeElementFromView({ viewElementId: "ve1" });
    expect(result).toEqual({});
    expect(prisma.eaViewElement.delete).toHaveBeenCalledWith({ where: { id: "ve1" } });
  });

  it("unknown id — returns ViewElementNotFound", async () => {
    const notFoundError = Object.assign(new Error("Record not found"), { code: "P2025" });
    (prisma.eaViewElement.delete as ReturnType<typeof vi.fn>).mockRejectedValue(notFoundError);
    const result = await removeElementFromView({ viewElementId: "nope" });
    expect(result).toEqual({ error: "ViewElementNotFound" });
  });
});

describe("updateProposedProperties", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { platformRole: "HR-000", isSuperuser: false, id: "u1" } });
    mockCan.mockReturnValue(true);
  });

  it("mode=reference — returns CannotEditReference", async () => {
    (prisma.eaViewElement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ve1", mode: "reference",
    });
    const result = await updateProposedProperties({
      viewElementId: "ve1",
      properties: { name: "new name" },
    });
    expect(result).toEqual({ error: "CannotEditReference" });
  });
});

describe("saveCanvasState", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { platformRole: "HR-000", isSuperuser: false, id: "u1" } });
    mockCan.mockReturnValue(true);
  });

  it("persists canvasState JSON to EaView", async () => {
    (prisma.eaView.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const canvasState = { viewport: { x: 0, y: 0, zoom: 1 }, nodes: { ve1: { x: 100, y: 200 } } };
    await saveCanvasState({ viewId: "v1", canvasState });
    expect(prisma.eaView.update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { canvasState: canvasState as unknown as import("@dpf/db").Prisma.InputJsonValue },
    });
  });
});

describe("createEaRelationship — viewpoint check", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { platformRole: "HR-000", isSuperuser: false, id: "u1" } });
    mockCan.mockReturnValue(true);
  });

  it("viewId + rel type not allowed by viewpoint → returns error", async () => {
    const mockRelType = { id: "rt1", slug: "depends_on" };
    const mockView = {
      viewpoint: { allowedRelTypeSlugs: ["realizes", "associated_with"] },
    };
    (prisma.eaRelationshipType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockRelType);
    (prisma.eaView.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockView);
    const result = await createEaRelationship({
      fromElementId: "e1",
      toElementId: "e2",
      relationshipTypeId: "rt1",
      viewId: "v1",
    });
    expect(result).toEqual({ error: "RelationshipTypeNotAllowedByViewpoint" });
  });
});
describe("moveStructuredViewElement", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { platformRole: "HR-000", isSuperuser: false, id: "u1" } });
    mockCan.mockReturnValue(true);
  });

  it("resequences sibling stages under a value stream parent", async () => {
    (prisma.eaViewElement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "stage-ve-2",
      viewId: "view-1",
      elementId: "stage-el-2",
      parentViewElementId: "stream-ve-1",
      orderIndex: 1,
      element: { id: "stage-el-2" },
    });
    (prisma.eaViewElement.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "stage-ve-1", elementId: "stage-el-1", parentViewElementId: "stream-ve-1", orderIndex: 0 },
      { id: "stage-ve-2", elementId: "stage-el-2", parentViewElementId: "stream-ve-1", orderIndex: 1 },
    ]);

    await moveStructuredViewElement({
      viewElementId: "stage-ve-2",
      targetParentViewElementId: "stream-ve-1",
      targetOrderIndex: 0,
    });

    expect(prisma.eaViewElement.updateMany).toHaveBeenCalled();
    expect(prisma.eaConformanceIssue.deleteMany).toHaveBeenCalled();
  });

  it("creates a conformance warning when a stage is detached", async () => {
    (prisma.eaViewElement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "stage-ve-1",
      viewId: "view-1",
      elementId: "stage-el-1",
      parentViewElementId: "stream-ve-1",
      orderIndex: 0,
      element: { id: "stage-el-1" },
    });
    (prisma.eaViewElement.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await moveStructuredViewElement({
      viewElementId: "stage-ve-1",
      targetParentViewElementId: null,
      targetOrderIndex: null,
    });

    expect(prisma.eaConformanceIssue.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            issueType: "detached_child",
            severity: "warn",
          }),
        ]),
      })
    );
  });
});

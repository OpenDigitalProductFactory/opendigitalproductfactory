import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({
  prisma: {
    eaReferenceModel: { findUnique: vi.fn() },
    eaReferenceModelElement: { findMany: vi.fn() },
    eaNotation: { findUnique: vi.fn() },
    viewpointDefinition: { findUnique: vi.fn() },
    eaElementType: { findUnique: vi.fn() },
    eaRelationshipType: { findUnique: vi.fn() },
    eaView: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    eaElement: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    eaViewElement: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    eaRelationship: { findFirst: vi.fn(), create: vi.fn() },
    eaConformanceIssue: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
}));

import { prisma } from "./client.js";
import { projectReferenceModel } from "./reference-model-projection.js";

const mockPrisma = prisma as unknown as {
  eaReferenceModel: { findUnique: ReturnType<typeof vi.fn> };
  eaReferenceModelElement: { findMany: ReturnType<typeof vi.fn> };
  eaNotation: { findUnique: ReturnType<typeof vi.fn> };
  viewpointDefinition: { findUnique: ReturnType<typeof vi.fn> };
  eaElementType: { findUnique: ReturnType<typeof vi.fn> };
  eaRelationshipType: { findUnique: ReturnType<typeof vi.fn> };
  eaView: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  eaElement: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  eaViewElement: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  eaRelationship: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  eaConformanceIssue: {
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.eaReferenceModel.findUnique.mockResolvedValue({
    id: "model-1",
    slug: "it4it_v3_0_1",
    name: "IT4IT",
    version: "3.0.1",
  });
  mockPrisma.eaReferenceModelElement.findMany.mockResolvedValue([
    {
      id: "ref-stream-1",
      parentId: null,
      kind: "value_stream",
      slug: "value_stream_evaluate",
      name: "Evaluate",
      description: "Evaluate demand and opportunities",
      properties: {},
    },
    {
      id: "ref-stage-1",
      parentId: "ref-stream-1",
      kind: "value_stream_stage",
      slug: "value_stream_stage_evaluate_identify",
      name: "Identify",
      description: "Identify and qualify demand",
      properties: { sequenceNumber: 2 },
    },
    {
      id: "ref-stage-2",
      parentId: "ref-stream-1",
      kind: "value_stream_stage",
      slug: "value_stream_stage_evaluate_analyze",
      name: "Analyze",
      description: "Analyze opportunities",
      properties: { sequenceNumber: 1 },
    },
  ]);
  mockPrisma.eaNotation.findUnique.mockResolvedValue({ id: "notation-1" });
  mockPrisma.viewpointDefinition.findUnique.mockResolvedValue({ id: "viewpoint-1" });
  mockPrisma.eaElementType.findUnique.mockImplementation(async (args: { where: { notationId_slug: { slug: string } } }) => {
    const slug = args.where.notationId_slug.slug;
    return {
      id: `type-${slug}`,
      slug,
      neoLabel: `ArchiMate__${slug}`,
      notation: { slug: "archimate4" },
    };
  });
  mockPrisma.eaRelationshipType.findUnique.mockResolvedValue({
    id: "reltype-flow",
    slug: "flows_to",
    neoType: "FLOWS_TO",
    notation: { slug: "archimate4" },
  });
  mockPrisma.eaView.findFirst.mockResolvedValue(null);
  mockPrisma.eaView.create.mockResolvedValue({ id: "view-1" });
  mockPrisma.eaElement.findFirst.mockResolvedValue(null);
  mockPrisma.eaElement.create
    .mockResolvedValueOnce({ id: "ea-stream-1" })
    .mockResolvedValueOnce({ id: "ea-stage-1" })
    .mockResolvedValueOnce({ id: "ea-stage-2" });
  mockPrisma.eaViewElement.findUnique.mockResolvedValue(null);
  mockPrisma.eaViewElement.create
    .mockResolvedValueOnce({ id: "view-stream-1" })
    .mockResolvedValueOnce({ id: "view-stage-1" })
    .mockResolvedValueOnce({ id: "view-stage-2" });
  mockPrisma.eaRelationship.findFirst.mockResolvedValue(null);
  mockPrisma.eaRelationship.create.mockResolvedValue({ id: "rel-1" });
  mockPrisma.eaConformanceIssue.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.eaConformanceIssue.createMany.mockResolvedValue({ count: 0 });
});

describe("projectReferenceModel", () => {
  it("projects reference-model value streams into a structured EA view", async () => {
    const result = await projectReferenceModel({
      referenceModelSlug: "it4it_v3_0_1",
      projectionType: "value_stream_view",
    });

    expect(result.viewId).toBe("view-1");
    expect(result.createdView).toBe(true);
    expect(result.createdElements).toBe(3);
    expect(result.createdViewElements).toBe(3);

    expect(mockPrisma.eaView.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scopeType: "reference_model_projection",
          scopeRef: "it4it_v3_0_1:value_stream_view",
        }),
      }),
    );
    expect(mockPrisma.eaElement.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          properties: expect.objectContaining({
            projection: expect.objectContaining({
              layoutRole: "stream_band",
            }),
          }),
        }),
      }),
    );
    expect(mockPrisma.eaElement.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          properties: expect.objectContaining({
            projection: expect.objectContaining({
              layoutRole: "stream_stage",
            }),
          }),
        }),
      }),
    );

    expect(mockPrisma.eaViewElement.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          parentViewElementId: "view-stream-1",
          orderIndex: 1,
        }),
      }),
    );
    expect(mockPrisma.eaViewElement.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        data: expect.objectContaining({
          parentViewElementId: "view-stream-1",
          orderIndex: 0,
        }),
      }),
    );
  });

  it("refreshes an existing projection without duplicating the view", async () => {
    mockPrisma.eaView.findFirst.mockResolvedValue({ id: "view-1" });
    mockPrisma.eaElement.findFirst
      .mockResolvedValueOnce({ id: "ea-stream-1" })
      .mockResolvedValueOnce({ id: "ea-stage-1" })
      .mockResolvedValueOnce({ id: "ea-stage-2" });
    mockPrisma.eaViewElement.findUnique
      .mockResolvedValueOnce({ id: "view-stream-1" })
      .mockResolvedValueOnce({ id: "view-stage-1" })
      .mockResolvedValueOnce({ id: "view-stage-2" });
    mockPrisma.eaRelationship.findFirst.mockResolvedValue({ id: "rel-1" });
    mockPrisma.eaView.update.mockResolvedValue({ id: "view-1" });
    mockPrisma.eaElement.update
      .mockResolvedValueOnce({ id: "ea-stream-1" })
      .mockResolvedValueOnce({ id: "ea-stage-1" })
      .mockResolvedValueOnce({ id: "ea-stage-2" });
    mockPrisma.eaViewElement.update
      .mockResolvedValueOnce({ id: "view-stream-1" })
      .mockResolvedValueOnce({ id: "view-stage-1" })
      .mockResolvedValueOnce({ id: "view-stage-2" });

    const result = await projectReferenceModel({
      referenceModelSlug: "it4it_v3_0_1",
      projectionType: "value_stream_view",
    });

    expect(result.viewId).toBe("view-1");
    expect(result.createdView).toBe(false);
    expect(result.createdElements).toBe(0);
    expect(result.updatedElements).toBe(3);
    expect(result.createdViewElements).toBe(0);
    expect(result.updatedViewElements).toBe(3);
    expect(mockPrisma.eaView.create).not.toHaveBeenCalled();
    expect(mockPrisma.eaElement.create).not.toHaveBeenCalled();
    expect(mockPrisma.eaViewElement.create).not.toHaveBeenCalled();
  });

  it("fails clearly when the reference model does not exist", async () => {
    mockPrisma.eaReferenceModel.findUnique.mockResolvedValue(null);

    await expect(
      projectReferenceModel({
        referenceModelSlug: "missing_model",
        projectionType: "value_stream_view",
      }),
    ).rejects.toThrow("Reference model not found");
  });

  it("returns a no-op result when the reference model has no value streams to project", async () => {
    mockPrisma.eaReferenceModelElement.findMany.mockResolvedValue([]);

    const result = await projectReferenceModel({
      referenceModelSlug: "it4it_v3_0_1",
      projectionType: "value_stream_view",
    });

    expect(result.createdView).toBe(false);
    expect(result.createdElements).toBe(0);
    expect(result.viewId).toBe("");
  });
});

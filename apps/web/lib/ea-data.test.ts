import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  cache: <T>(fn: T) => fn,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    eaView: { findUnique: vi.fn() },
    eaStructureRule: { findMany: vi.fn() },
    eaConformanceIssue: { findMany: vi.fn() },
    eaRelationship: { findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { getEaView } from "./ea-data";

const mockPrisma = prisma as unknown as {
  eaView: { findUnique: ReturnType<typeof vi.fn> };
  eaStructureRule: { findMany: ReturnType<typeof vi.fn> };
  eaConformanceIssue: { findMany: ReturnType<typeof vi.fn> };
  eaRelationship: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.eaView.findUnique.mockResolvedValue({
    id: "view-1",
    notationId: "notation-1",
    name: "IT4IT value streams",
    description: "Reference model projection",
    layoutType: "graph",
    scopeType: "reference_model_projection",
    scopeRef: "it4it_v3_0_1:value_stream_view",
    status: "draft",
    canvasState: null,
    viewpoint: null,
    viewElements: [
      {
        id: "ve-stream-1",
        elementId: "el-stream-1",
        mode: "reference",
        parentViewElementId: null,
        orderIndex: null,
        proposedProperties: null,
        element: {
          name: "Evaluate",
          description: null,
          lifecycleStage: "design",
          lifecycleStatus: "draft",
          properties: {
            projection: {
              layoutRole: "stream_band",
            },
          },
          elementType: {
            slug: "value_stream",
            name: "Value Stream",
            neoLabel: "ArchiMate__ValueStream",
          },
        },
      },
    ],
  });
  mockPrisma.eaStructureRule.findMany.mockResolvedValue([
    {
      rendererHint: "nested_chevron_sequence",
      parentElementType: { slug: "value_stream" },
    },
  ]);
  mockPrisma.eaConformanceIssue.findMany.mockResolvedValue([]);
  mockPrisma.eaRelationship.findMany.mockResolvedValue([]);
});

describe("getEaView", () => {
  it("serializes projection layout roles for structured value stream elements", async () => {
    const view = await getEaView("view-1");

    expect(view?.elements[0]).toEqual(
      expect.objectContaining({
        layoutRole: "stream_band",
        rendererHint: "nested_chevron_sequence",
      }),
    );
  });
});

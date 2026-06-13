import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { eaView: { findMany: mockFindMany } } }));

import {
  isOperationalValueStreamScope,
  listValueStreamViews,
  VALUE_STREAM_VIEW_SCOPES,
} from "./value-stream-views";

beforeEach(() => {
  mockFindMany.mockReset();
  mockFindMany.mockResolvedValue([]);
});

describe("listValueStreamViews", () => {
  it("queries both reference-model and operational value-stream scopes", async () => {
    await listValueStreamViews();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scopeType: { in: ["reference_model_projection", "archetype_value_stream"] } },
      }),
    );
    // scopeType must be selected so cards can label operational vs reference.
    const arg = mockFindMany.mock.calls[0]![0] as { select: { scopeType?: boolean } };
    expect(arg.select.scopeType).toBe(true);
  });
});

describe("isOperationalValueStreamScope", () => {
  it("recognises the org operational scope and nothing else", () => {
    expect(isOperationalValueStreamScope("archetype_value_stream")).toBe(true);
    expect(isOperationalValueStreamScope("reference_model_projection")).toBe(false);
    expect(isOperationalValueStreamScope(null)).toBe(false);
    expect(VALUE_STREAM_VIEW_SCOPES).toContain("archetype_value_stream");
  });
});

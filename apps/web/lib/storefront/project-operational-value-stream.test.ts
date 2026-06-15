import { beforeEach, describe, expect, it, vi } from "vitest";

// This helper is pure orchestration glue (find template → derive → project).
// Mock both heavy dependencies and assert the wiring; the derivation itself is
// covered by packages/storefront-templates/operational-value-stream.test.ts and
// the projection by packages/db/archetype-value-stream-projection.test.ts.
const { mockDerive, mockProject } = vi.hoisted(() => ({
  mockDerive: vi.fn(),
  mockProject: vi.fn(),
}));

vi.mock("@dpf/storefront-templates", () => ({
  ALL_ARCHETYPES: [
    { archetypeId: "hair-salon", name: "Hair Salon", category: "beauty-personal-care" },
    { archetypeId: "veterinary-clinic", name: "Veterinary Clinic", category: "healthcare-wellness" },
  ],
  deriveOperationalValueStream: mockDerive,
}));

vi.mock("@dpf/db/archetype-value-stream-projection", () => ({
  projectArchetypeValueStream: mockProject,
}));

import { projectOperationalValueStreamForArchetype } from "./project-operational-value-stream";

beforeEach(() => {
  mockDerive.mockReset();
  mockProject.mockReset();
  mockDerive.mockImplementation((a: { archetypeId: string; name: string }) => ({
    archetypeId: a.archetypeId,
    archetypeName: a.name,
    stages: [{ key: "capture" }],
  }));
  mockProject.mockResolvedValue({ viewId: "view-1" });
});

describe("projectOperationalValueStreamForArchetype", () => {
  it("finds the template, derives its OVSM, and projects it", async () => {
    const result = await projectOperationalValueStreamForArchetype({
      organizationId: "org-1",
      archetypeId: "hair-salon",
    });

    expect(result).toEqual({ viewId: "view-1" });
    expect(mockDerive).toHaveBeenCalledWith(
      expect.objectContaining({ archetypeId: "hair-salon" }),
    );
    expect(mockProject).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        ovsm: expect.objectContaining({ archetypeId: "hair-salon" }),
      }),
    );
  });

  it("threads an injected db (the reset transaction) to the projector", async () => {
    const tx = { marker: "tx" };
    await projectOperationalValueStreamForArchetype({
      db: tx as unknown as Parameters<typeof projectOperationalValueStreamForArchetype>[0]["db"],
      organizationId: "org-2",
      archetypeId: "veterinary-clinic",
    });
    expect((mockProject.mock.calls[0]![0] as { db: unknown }).db).toBe(tx);
  });

  it("throws when the archetype template is missing and projects nothing", async () => {
    await expect(
      projectOperationalValueStreamForArchetype({ organizationId: "org-1", archetypeId: "does-not-exist" }),
    ).rejects.toThrow("not found in ALL_ARCHETYPES");
    expect(mockDerive).not.toHaveBeenCalled();
    expect(mockProject).not.toHaveBeenCalled();
  });
});

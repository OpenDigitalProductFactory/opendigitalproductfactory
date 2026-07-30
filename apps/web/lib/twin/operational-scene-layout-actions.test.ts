import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CartesianSceneLayout } from "@dpf/storefront-templates";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  can: vi.fn(),
  findOrganization: vi.fn(),
  findLayout: vi.fn(),
  updateLayout: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: mocks.can }));
vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: mocks.findOrganization },
    operationalSceneLayout: {
      findFirst: mocks.findLayout,
      updateMany: mocks.updateLayout,
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveOperationalCartesianScene } from "./operational-scene-layout-actions";

function layout(): CartesianSceneLayout {
  return {
    schemaVersion: 1,
    spaceKind: "cartesian-interior",
    viewport: { x: 0, y: 0, zoom: 1 },
    zones: [],
    placements: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: {
      platformRole: "HR-200",
      isSuperuser: false,
    },
  });
  mocks.can.mockReturnValue(true);
  mocks.findOrganization.mockResolvedValue({ orgId: "ORG-ACME" });
  mocks.findLayout.mockResolvedValue({
    id: "scene-1",
    version: 2,
    spaceKind: "cartesian-interior",
  });
  mocks.updateLayout.mockResolvedValue({ count: 1 });
});

describe("saveOperationalCartesianScene", () => {
  it("denies an unauthenticated or unauthorized configure write", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    await expect(
      saveOperationalCartesianScene({
        sceneId: "scene-1",
        expectedVersion: 2,
        layout: layout(),
      }),
    ).resolves.toEqual({
      ok: false,
      code: "unauthorized",
      error: "You do not have permission to change this operational layout.",
    });

    mocks.can.mockReturnValueOnce(false);
    await expect(
      saveOperationalCartesianScene({
        sceneId: "scene-1",
        expectedVersion: 2,
        layout: layout(),
      }),
    ).resolves.toMatchObject({ ok: false, code: "unauthorized" });

    expect(mocks.findOrganization).not.toHaveBeenCalled();
    expect(mocks.updateLayout).not.toHaveBeenCalled();
  });

  it("uses the session organization's public orgId and revalidates Operations", async () => {
    const result = await saveOperationalCartesianScene({
      sceneId: "scene-1",
      expectedVersion: 2,
      layout: layout(),
    });

    expect(result).toEqual({ ok: true, version: 3 });
    expect(mocks.findOrganization).toHaveBeenCalledWith({
      select: { orgId: true },
    });
    expect(mocks.findLayout).toHaveBeenCalledWith({
      where: { id: "scene-1", orgId: "ORG-ACME" },
      select: { id: true, version: true, spaceKind: true },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspace");
  });

  it("returns an honest missing-business result without attempting a write", async () => {
    mocks.findOrganization.mockResolvedValueOnce(null);
    const result = await saveOperationalCartesianScene({
      sceneId: "scene-1",
      expectedVersion: 2,
      layout: layout(),
    });

    expect(result).toEqual({
      ok: false,
      code: "not-found",
      error: "The business organization is not configured.",
    });
    expect(mocks.findLayout).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

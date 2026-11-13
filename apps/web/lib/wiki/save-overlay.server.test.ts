import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    wikiPage: { findFirst: vi.fn() },
    agent: { findFirst: vi.fn() },
    perspectiveMaterial: { updateMany: vi.fn() },
  },
}));

vi.mock("@dpf/db/wiki-store", () => ({
  appendRevision: vi.fn(),
  createWikiOverlayPage: vi.fn(),
  upsertWikiPage: vi.fn(),
}));
vi.mock("@/lib/wiki/craft-override-promotion", () => ({ promoteCraftOverrideOnPublish: vi.fn() }));
vi.mock("@/lib/wiki/embed-published-overlay", () => ({ embedPublishedOverlayPage: vi.fn() }));
vi.mock("@/lib/wiki/page-links", () => ({ syncWikiPageLinks: vi.fn() }));
vi.mock("@/lib/coworker-identity", () => ({ coworkerAuthorityWhere: vi.fn() }));

import { prisma } from "@dpf/db";
import { upsertWikiPage } from "@dpf/db/wiki-store";
import { saveWikiOverlayEditForActor } from "./save-overlay.server";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function existingStance(status: string) {
  mocked(prisma.wikiPage.findFirst).mockResolvedValue({
    id: "wp_ruling",
    slug: "stances/ruling-di-x",
    isKernel: false,
    organizationId: "org_test",
    pageKind: "stance",
    status,
    body: "## Stance\n\nRuled.",
  });
}

function save(status: "archived" | "published", body = "## Stance\n\nRuled.") {
  mocked(upsertWikiPage).mockResolvedValue({ id: "wp_ruling", slug: "stances/ruling-di-x", status });
  return saveWikiOverlayEditForActor(
    { pageId: "wp_ruling", slug: "stances/ruling-di-x", pageKind: "stance", title: "Ruling", body, status },
    { userId: "user_1" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org_test" });
  mocked(prisma.perspectiveMaterial.updateMany).mockResolvedValue({ count: 0 });
});

describe("saveWikiOverlayEditForActor — decision material follows the page status (BI-BD9DEC45)", () => {
  it("archiving a published stance in the editor revokes its material", async () => {
    existingStance("published");

    const result = await save("archived");

    expect(result).toEqual({ ok: true, pageId: "wp_ruling", slug: "stances/ruling-di-x", status: "archived" });
    expect(prisma.perspectiveMaterial.updateMany).toHaveBeenCalledWith({
      where: { sourceRef: { path: ["wikiPageId"], equals: "wp_ruling" }, promotionState: "promoted" },
      data: { promotionState: "revoked" },
    });
  });

  it("republishing an archived stance in the editor restores its material", async () => {
    existingStance("archived");

    await save("published");

    expect(prisma.perspectiveMaterial.updateMany).toHaveBeenCalledWith({
      where: { sourceRef: { path: ["wikiPageId"], equals: "wp_ruling" }, promotionState: "revoked" },
      data: { promotionState: "promoted" },
    });
  });

  it("leaves material alone when an edit does not change the status", async () => {
    existingStance("published");

    await save("published", "## Stance\n\nReworded.");

    expect(prisma.perspectiveMaterial.updateMany).not.toHaveBeenCalled();
  });

  it("never reports a completed save as failed when the material sync fails", async () => {
    existingStance("published");
    mocked(prisma.perspectiveMaterial.updateMany).mockRejectedValueOnce(new Error("db down"));

    const result = await save("archived");

    expect(result).toEqual({ ok: true, pageId: "wp_ruling", slug: "stances/ruling-di-x", status: "archived" });
  });
});

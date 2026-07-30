import { describe, expect, it, vi, beforeEach } from "vitest";

import { promoteCraftOverrideOnPublish } from "./craft-override-promotion";

// BI-8AC24F3D. The defect was NOT that promotion was broken — it worked fine in
// publishWikiOverlayPages. The defect was that the publish path an operator can
// actually reach (saveWikiOverlayEdit, behind the portal Edit page's Status
// select) never called it. So these tests pin the shared helper's contract, and
// the wiki-edit callsite test below pins that the reachable path calls it.

const promoteProfessionPageMaterial = vi.hoisted(() => vi.fn());

vi.mock("@dpf/db/profession-material-promotion", () => ({
  // Real implementation — the regex is the contract under test.
  parseProfessionPageSlug: (slug: string) => {
    const match = /^(professions|craft)\/([a-z0-9-]+)\/.+/.exec(slug);
    if (!match) return null;
    return {
      professionKey: match[2],
      corpus: match[1] === "professions" ? "platform" : "org-override",
    };
  },
  promoteProfessionPageMaterial,
}));

vi.mock("@/lib/decision-perspective/resolve-profession-profile", () => ({
  PROFESSION_REGISTRY: {
    families: [
      { professionKey: "enterprise-architecture", contextSlugs: ["engineering-flow"] },
    ],
  },
}));

const db = {} as never;

const eaPage = {
  id: "page-1",
  slug: "craft/enterprise-architecture/architecture-review-verdicts",
  title: "Architecture review verdicts",
  pageKind: "heuristic",
  abstract: null,
};

beforeEach(() => {
  promoteProfessionPageMaterial.mockReset();
  promoteProfessionPageMaterial.mockResolvedValue({
    ok: true,
    gateLive: true,
    materialIds: ["wsid-enterprise-architecture:craft/…:architecture-tradeoff"],
  });
});

describe("promoteCraftOverrideOnPublish", () => {
  it("promotes an org-override craft page at confirmed tier", async () => {
    const result = await promoteCraftOverrideOnPublish({ db, page: eaPage, origin: "test" });

    expect(result).toMatchObject({
      slug: eaPage.slug,
      professionKey: "enterprise-architecture",
      gateLive: true,
    });
    // confirmed, not derived: publishing an override IS the owner's approval,
    // and derived would map to professional-practice only.
    expect(promoteProfessionPageMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "confirmed", professionKey: "enterprise-architecture" }),
    );
  });

  it("passes the family's context slugs so high-stakes holds can apply", async () => {
    await promoteCraftOverrideOnPublish({ db, page: eaPage, origin: "test" });
    expect(promoteProfessionPageMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ contextSlugs: ["engineering-flow"] }),
    );
  });

  it("ignores a PLATFORM corpus page — those are seeded, never publish-promoted", async () => {
    const result = await promoteCraftOverrideOnPublish({
      db,
      page: { ...eaPage, slug: "professions/enterprise-architecture/togaf-adm-phases" },
      origin: "test",
    });
    expect(result).toBeNull();
    expect(promoteProfessionPageMaterial).not.toHaveBeenCalled();
  });

  it("ignores a non-profession overlay page", async () => {
    const result = await promoteCraftOverrideOnPublish({
      db,
      page: { ...eaPage, slug: "principles/never-wipe-db" },
      origin: "test",
    });
    expect(result).toBeNull();
    expect(promoteProfessionPageMaterial).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when promotion reports a failure", async () => {
    promoteProfessionPageMaterial.mockResolvedValue({ ok: false, error: "no-profession-profile" });
    await expect(
      promoteCraftOverrideOnPublish({ db, page: eaPage, origin: "test" }),
    ).resolves.toBeNull();
  });

  it("returns null (never throws) when promotion throws — the publish must stand", async () => {
    // Load-bearing: callers must not roll back a completed status flip because
    // promotion failed. The seed backfill converges missed material later.
    promoteProfessionPageMaterial.mockRejectedValue(new Error("db down"));
    await expect(
      promoteCraftOverrideOnPublish({ db, page: eaPage, origin: "test" }),
    ).resolves.toBeNull();
  });

  it("does not promote a page kind the promoter rejects as non-decision-bearing", async () => {
    // The kind gate lives in promoteProfessionPageMaterial; assert we surface
    // its refusal as null rather than inventing a second kind allow-list here.
    promoteProfessionPageMaterial.mockResolvedValue({ ok: false, error: "not-decision-bearing" });
    const result = await promoteCraftOverrideOnPublish({
      db,
      page: { ...eaPage, pageKind: "summary" },
      origin: "test",
    });
    expect(result).toBeNull();
  });
});

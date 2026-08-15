import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    wikiPage: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    wikiPageRevision: { create: vi.fn(), findFirst: vi.fn() },
    wikiPageLink: { upsert: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// BI-8AC24F3D: mocked so the callsite wiring is what is under test here; the
// helper's own contract is covered in lib/wiki/craft-override-promotion.test.ts.
// BI-D4C1E05E: mock the shared embed seam so these action tests don't reach the
// real storeWikiPage → generateEmbedding network path. The seam's own contract is
// covered in lib/wiki/embed-published-overlay.test.ts.
vi.mock("@/lib/wiki/embed-published-overlay", () => ({
  embedPublishedOverlayPage: vi.fn().mockResolvedValue({ embedded: true, slug: "x" }),
}));
vi.mock("@/lib/wiki/craft-override-promotion", () => ({
  promoteCraftOverrideOnPublish: vi.fn().mockResolvedValue(null),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { saveWikiOverlayEdit } from "./wiki-edit";

beforeEach(() => {
  vi.clearAllMocks();
  (auth as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "user_1" },
  });
  (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "org_test",
  });
  (prisma.wikiPageRevision.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

// ─── Auth + scope ──────────────────────────────────────────────────────────

describe("saveWikiOverlayEdit — auth + scope", () => {
  it("rejects an unauthenticated session", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await saveWikiOverlayEdit({
      slug: "entities/foo",
      pageKind: "entity",
      title: "Foo",
      body: "## Definition\n\nFoo is something.",
    });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/unauthorized/i) });
  });

  it("rejects when there is no Organization row", async () => {
    (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await saveWikiOverlayEdit({
      slug: "entities/foo",
      pageKind: "entity",
      title: "Foo",
      body: "## Definition\n\nFoo.",
    });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/needs? an org context/i) });
  });
});

// ─── Validation ────────────────────────────────────────────────────────────

describe("saveWikiOverlayEdit — validation", () => {
  it("rejects empty title", async () => {
    const result = await saveWikiOverlayEdit({
      slug: "entities/foo",
      pageKind: "entity",
      title: "   ",
      body: "## Definition\n\nFoo.",
    });
    expect(result).toEqual({ ok: false, error: "Title is required." });
  });

  it("rejects empty body", async () => {
    const result = await saveWikiOverlayEdit({
      slug: "entities/foo",
      pageKind: "entity",
      title: "Foo",
      body: "   ",
    });
    expect(result).toEqual({ ok: false, error: "Body is required." });
  });
});

// ─── Kernel write refusal ──────────────────────────────────────────────────

describe("saveWikiOverlayEdit — kernel write refusal", () => {
  it("refuses to update a row flagged isKernel=true", async () => {
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "wp_kernel",
      slug: "entities/digital-product",
      isKernel: true,
      organizationId: null,
      pageKind: "entity",
    });
    const result = await saveWikiOverlayEdit({
      pageId: "wp_kernel",
      slug: "entities/digital-product",
      pageKind: "entity",
      title: "DP",
      body: "## Definition\n\nA digital product.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/PR-only/);
    }
  });

  it("refuses to write when pageId belongs to a different organization", async () => {
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "wp_other",
      slug: "entities/portfolio",
      isKernel: false,
      organizationId: "org_other",
      pageKind: "entity",
    });
    const result = await saveWikiOverlayEdit({
      pageId: "wp_other",
      slug: "entities/portfolio",
      pageKind: "entity",
      title: "Portfolio",
      body: "## Definition\n\nA portfolio.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/different organization/i);
    }
  });

  it("refuses a slug change on an existing overlay row", async () => {
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "wp_overlay",
      slug: "entities/foo",
      isKernel: false,
      organizationId: "org_test",
      pageKind: "entity",
    });
    const result = await saveWikiOverlayEdit({
      pageId: "wp_overlay",
      slug: "entities/foo-renamed",
      pageKind: "entity",
      title: "Foo",
      body: "## Definition\n\nFoo.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Slug changes are not supported/);
    }
  });
});

// ─── Update existing overlay ───────────────────────────────────────────────

describe("saveWikiOverlayEdit — update existing overlay", () => {
  it("updates the row, appends a manual revision, and revalidates the route", async () => {
    const existing = {
      id: "wp_overlay",
      slug: "entities/portfolio",
      isKernel: false,
      organizationId: "org_test",
      pageKind: "entity",
    };
    // First findFirst: the scope check inside saveWikiOverlayEdit.
    // Second findFirst (from getWikiPage via upsertWikiPage): existing row lookup.
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ id: existing.id });
    (prisma.wikiPage.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...existing,
      title: "Portfolio v2",
      body: "## Definition\n\nNew body.",
      status: "draft",
    });
    (prisma.wikiPageRevision.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rev_1",
    });

    const { revalidatePath } = await import("next/cache");
    const result = await saveWikiOverlayEdit({
      pageId: existing.id,
      slug: existing.slug,
      pageKind: "entity",
      title: "Portfolio v2",
      body: "## Definition\n\nNew body.",
    });

    expect(result).toEqual({
      ok: true,
      pageId: "wp_overlay",
      slug: "entities/portfolio",
      status: "draft",
    });
    expect(prisma.wikiPage.update).toHaveBeenCalledTimes(1);
    expect(prisma.wikiPageRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pageId: "wp_overlay",
        changeKind: "manual",
        createdById: "user_1",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/coworker-decisions/entities/portfolio");
    expect(revalidatePath).toHaveBeenCalledWith("/coworker-decisions");
  });
});

// ─── Create new overlay ────────────────────────────────────────────────────

describe("saveWikiOverlayEdit — create new overlay (no pageId)", () => {
  it("creates a fresh org-original page when no row exists at (org, slug)", async () => {
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (prisma.wikiPage.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "wp_new",
      slug: "entities/custom",
      status: "draft",
      organizationId: "org_test",
      isKernel: false,
    });

    const result = await saveWikiOverlayEdit({
      slug: "entities/custom",
      pageKind: "entity",
      title: "Custom Entity",
      body: "## Definition\n\nCustom entity definition.",
    });
    expect(result).toEqual({
      ok: true,
      pageId: "wp_new",
      slug: "entities/custom",
      status: "draft",
    });
    expect(prisma.wikiPage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: "entities/custom",
        title: "Custom Entity",
        organizationId: "org_test",
        isKernel: false,
        kernelPageId: null,
      }),
    });
  });
});

// ─── Override a kernel page ────────────────────────────────────────────────

describe("saveWikiOverlayEdit — override a kernel page", () => {
  it("creates an overlay row with kernelPageId + derivedFromKernelVersion set", async () => {
    // Lookup of the kernel page (overridesKernelPageId branch).
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "wp_kernel", slug: "stances/it4it-is-substrate" })
      // upsertWikiPage's findFirst (no existing overlay row).
      .mockResolvedValueOnce(null);
    (prisma.wikiPage.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "wp_override",
      slug: "stances/it4it-is-substrate",
      status: "draft",
    });

    const result = await saveWikiOverlayEdit({
      slug: "stances/it4it-is-substrate",
      pageKind: "stance",
      title: "IT4IT is substrate (our take)",
      body: "## Stance\n\nFor us, this aligns with X.",
      overridesKernelPageId: "wp_kernel",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pageId).toBe("wp_override");
    }
    expect(prisma.wikiPage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kernelPageId: "wp_kernel",
        // Manifest may or may not be readable in the test environment; we
        // accept either string OR null but assert the field is present in
        // the upsert payload so the column is intentionally written.
      }),
    });
    const createCall = (prisma.wikiPage.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data).toHaveProperty("derivedFromKernelVersion");
  });

  it("rejects when overridesKernelPageId resolves to a non-kernel row", async () => {
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await saveWikiOverlayEdit({
      slug: "stances/foo",
      pageKind: "stance",
      title: "Foo",
      body: "## Stance\n\nFoo.",
      overridesKernelPageId: "wp_doesnt_exist",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Kernel page to override not found/);
    }
  });

  it("rejects when the override slug doesn't match the kernel slug", async () => {
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "wp_kernel",
      slug: "stances/canonical",
    });
    const result = await saveWikiOverlayEdit({
      slug: "stances/different",
      pageKind: "stance",
      title: "Different",
      body: "## Stance\n\nDifferent.",
      overridesKernelPageId: "wp_kernel",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/match the kernel page slug/);
    }
  });
});

// ─── Wikilink graph sync ───────────────────────────────────────────────────

describe("saveWikiOverlayEdit — wikilink graph", () => {
  it("upserts WikiPageLink edges for every resolvable [[wikilink]] in the body", async () => {
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>)
      // Scope check (existing overlay).
      .mockResolvedValueOnce({
        id: "wp_self",
        slug: "entities/foo",
        isKernel: false,
        organizationId: "org_test",
        pageKind: "entity",
      })
      // upsertWikiPage existing lookup.
      .mockResolvedValueOnce({ id: "wp_self" })
      // First wikilink target lookup → resolves.
      .mockResolvedValueOnce({ id: "wp_target_a" })
      // Second wikilink target lookup → resolves.
      .mockResolvedValueOnce({ id: "wp_target_b" })
      // Third wikilink target lookup → dangling.
      .mockResolvedValueOnce(null);
    (prisma.wikiPage.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "wp_self",
      slug: "entities/foo",
      status: "draft",
    });
    (prisma.wikiPageRevision.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rev_1",
    });

    await saveWikiOverlayEdit({
      pageId: "wp_self",
      slug: "entities/foo",
      pageKind: "entity",
      title: "Foo",
      body: `## Definition\n\nFoo references [[entities/target-a]] and [[entities/target-b]] and [[entities/missing]]. Also [[raw-sources/articles/skip]].`,
    });

    // Two resolvable targets → two link upserts. The dangling slug and
    // the raw-source citation are skipped.
    expect(prisma.wikiPageLink.upsert).toHaveBeenCalledTimes(2);
    const linkArgs = (prisma.wikiPageLink.upsert as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0].create,
    );
    expect(linkArgs).toEqual(
      expect.arrayContaining([
        { fromPageId: "wp_self", toPageId: "wp_target_a" },
        { fromPageId: "wp_self", toPageId: "wp_target_b" },
      ]),
    );
  });
});

// ─── Craft-override promotion on publish (BI-8AC24F3D) ─────────────────────
//
// THE DEFECT THESE PIN. This action is what the portal Edit page calls, so
// flipping Status to `published` here IS how an operator publishes a craft
// override. It used to write `status` and nothing else: the page went live, no
// PerspectiveMaterial was written, and the profession gate kept deferring —
// while the craft form said "Publish it to make it part of this role's craft"
// and the WWWD sibling promised "Your AI now weighs this stance when it
// decides". Structurally published, functionally inert.
//
// The promoting path (publishWikiOverlayPages) had the hook but no UI caller,
// so the two publish routes meant different things. Both now share
// promoteCraftOverrideOnPublish; these tests keep the reachable one wired.

describe("saveWikiOverlayEdit — craft-override promotion", () => {
  const craftSlug = "craft/enterprise-architecture/verify-the-substrate-first";

  function stubExistingCraftPage(status: string) {
    const existing = {
      id: "wp_craft",
      slug: craftSlug,
      isKernel: false,
      organizationId: "org_test",
      pageKind: "heuristic",
      status,
    };
    (prisma.wikiPage.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ id: existing.id });
    return existing;
  }

  function stubUpdateResult(status: string) {
    (prisma.wikiPage.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "wp_craft",
      slug: craftSlug,
      status,
    });
    (prisma.wikiPageRevision.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rev_craft",
    });
  }

  const save = (status: "draft" | "published") =>
    saveWikiOverlayEdit({
      pageId: "wp_craft",
      slug: craftSlug,
      pageKind: "heuristic",
      title: "Verify the substrate first",
      body: "Sweep the existing substrate before proposing a new model.",
      status,
    });

  it("promotes to gate-live material when an operator flips draft -> published", async () => {
    const { promoteCraftOverrideOnPublish } = await import("@/lib/wiki/craft-override-promotion");
    stubExistingCraftPage("draft");
    stubUpdateResult("published");

    const result = await save("published");

    expect(result.ok).toBe(true);
    expect(promoteCraftOverrideOnPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "wiki-edit",
        page: expect.objectContaining({ id: "wp_craft", slug: craftSlug, pageKind: "heuristic" }),
      }),
    );
    // BI-D4C1E05E: publishing also embeds the page via the shared seam.
    const { embedPublishedOverlayPage } = await import("@/lib/wiki/embed-published-overlay");
    expect(embedPublishedOverlayPage).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "wiki-edit",
        organizationId: "org_test",
        page: expect.objectContaining({ id: "wp_craft", slug: craftSlug }),
      }),
    );
  });

  it("does NOT promote or embed when the save leaves the page in draft", async () => {
    const { promoteCraftOverrideOnPublish } = await import("@/lib/wiki/craft-override-promotion");
    const { embedPublishedOverlayPage } = await import("@/lib/wiki/embed-published-overlay");
    stubExistingCraftPage("draft");
    stubUpdateResult("draft");

    await save("draft");

    expect(promoteCraftOverrideOnPublish).not.toHaveBeenCalled();
    expect(embedPublishedOverlayPage).not.toHaveBeenCalled();
  });

  it("does NOT re-promote when editing a page that was ALREADY published", async () => {
    // Guarded on the transition, not the target status — otherwise every
    // subsequent copy edit re-promotes and churns material rows.
    const { promoteCraftOverrideOnPublish } = await import("@/lib/wiki/craft-override-promotion");
    stubExistingCraftPage("published");
    stubUpdateResult("published");

    await save("published");

    expect(promoteCraftOverrideOnPublish).not.toHaveBeenCalled();
  });

  it("still returns ok when promotion fails — a completed publish is never rolled back", async () => {
    const { promoteCraftOverrideOnPublish } = await import("@/lib/wiki/craft-override-promotion");
    (promoteCraftOverrideOnPublish as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    stubExistingCraftPage("draft");
    stubUpdateResult("published");

    const result = await save("published");

    expect(result).toMatchObject({ ok: true, status: "published" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    wikiPage: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    wikiPageRevision: { create: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import {
  listOverlayDrafts,
  publishWikiOverlayPages,
} from "./wiki-publish";

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

// ─── Auth + validation ──────────────────────────────────────────────────────

describe("publishWikiOverlayPages — auth + validation", () => {
  it("rejects when not authenticated", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const r = await publishWikiOverlayPages({ pageIds: ["a"] });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/not authenticated/i) });
  });

  it("rejects when no organization exists", async () => {
    (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const r = await publishWikiOverlayPages({ pageIds: ["a"] });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/needs? an org context/i) });
  });

  it("rejects empty pageIds", async () => {
    const r = await publishWikiOverlayPages({ pageIds: [] });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/non-empty/i) });
  });
});

// ─── Batch flow ─────────────────────────────────────────────────────────────

describe("publishWikiOverlayPages — batch flow", () => {
  it("publishes eligible drafts, appends a manual revision each, revalidates routes", async () => {
    (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "wp_a",
        slug: "entities/a",
        title: "A",
        body: "## Definition\n\nA",
        status: "draft",
        isKernel: false,
        organizationId: "org_test",
      },
      {
        id: "wp_b",
        slug: "stances/b",
        title: "B",
        body: "## Stance\n\nB",
        status: "draft",
        isKernel: false,
        organizationId: "org_test",
      },
    ]);
    (prisma.wikiPage.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.wikiPageRevision.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rev_x",
    });
    const { revalidatePath } = await import("next/cache");

    const r = await publishWikiOverlayPages({ pageIds: ["wp_a", "wp_b"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.published).toHaveLength(2);
      expect(r.published.map((p) => p.slug).sort()).toEqual([
        "entities/a",
        "stances/b",
      ]);
      expect(r.rejected).toEqual([]);
    }
    expect(prisma.wikiPage.update).toHaveBeenCalledTimes(2);
    expect(prisma.wikiPageRevision.create).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith("/wiki");
    expect(revalidatePath).toHaveBeenCalledWith("/wiki/entities/a");
    expect(revalidatePath).toHaveBeenCalledWith("/wiki/stances/b");
  });

  it("reports each rejection reason — not-found, kernel, cross-org, already-target", async () => {
    (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "wp_kernel",
        slug: "entities/kernel",
        title: "K",
        body: "b",
        status: "draft",
        isKernel: true,
        organizationId: null,
      },
      {
        id: "wp_other_org",
        slug: "entities/other",
        title: "O",
        body: "b",
        status: "draft",
        isKernel: false,
        organizationId: "org_other",
      },
      {
        id: "wp_already",
        slug: "entities/already",
        title: "A",
        body: "b",
        status: "published",
        isKernel: false,
        organizationId: "org_test",
      },
    ]);
    const r = await publishWikiOverlayPages({
      pageIds: ["wp_kernel", "wp_other_org", "wp_already", "wp_missing"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reasonByPage = Object.fromEntries(
        r.rejected.map((r) => [r.pageId, r.reason]),
      );
      expect(reasonByPage).toEqual({
        wp_kernel: "kernel",
        wp_other_org: "cross-org",
        wp_already: "already-target-status",
        wp_missing: "not-found",
      });
      expect(r.published).toEqual([]);
    }
    expect(prisma.wikiPage.update).not.toHaveBeenCalled();
  });

  it("honors targetStatus override (e.g. 'review-needed')", async () => {
    (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "wp_a",
        slug: "entities/a",
        title: "A",
        body: "b",
        status: "draft",
        isKernel: false,
        organizationId: "org_test",
      },
    ]);
    (prisma.wikiPage.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.wikiPageRevision.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rev_x",
    });
    const r = await publishWikiOverlayPages({
      pageIds: ["wp_a"],
      targetStatus: "review-needed",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.published[0].newStatus).toBe("review-needed");
    }
    expect(prisma.wikiPage.update).toHaveBeenCalledWith({
      where: { id: "wp_a" },
      data: expect.objectContaining({ status: "review-needed" }),
    });
  });

  it("partially commits — eligible rows publish even when others are rejected", async () => {
    (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "wp_ok",
        slug: "entities/ok",
        title: "OK",
        body: "b",
        status: "draft",
        isKernel: false,
        organizationId: "org_test",
      },
      {
        id: "wp_kernel",
        slug: "entities/kernel",
        title: "K",
        body: "b",
        status: "draft",
        isKernel: true,
        organizationId: null,
      },
    ]);
    (prisma.wikiPage.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.wikiPageRevision.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rev_ok",
    });
    const r = await publishWikiOverlayPages({ pageIds: ["wp_ok", "wp_kernel"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.published.map((p) => p.pageId)).toEqual(["wp_ok"]);
      expect(r.rejected.map((r) => r.pageId)).toEqual(["wp_kernel"]);
    }
  });
});

// ─── listOverlayDrafts ──────────────────────────────────────────────────────

describe("listOverlayDrafts", () => {
  it("returns drafts scoped to the current org with body preview + source slugs", async () => {
    (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "wp_a",
        slug: "entities/a",
        title: "A",
        pageKind: "entity",
        abstract: "Abstract A",
        body: "Body A".repeat(200), // 1200 chars
        kernelPageId: null,
        derivedFromKernelVersion: null,
        sources: [{ source: { sourceKey: "articles/foo" } }],
      },
      {
        id: "wp_b",
        slug: "stances/b",
        title: "B",
        pageKind: "stance",
        abstract: null,
        body: "Short body",
        kernelPageId: "wp_kernel",
        derivedFromKernelVersion: "0.2.1",
        sources: [],
      },
    ]);
    const drafts = await listOverlayDrafts();
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      pageId: "wp_a",
      slug: "entities/a",
      pageKind: "entity",
      abstract: "Abstract A",
      sourceSlugs: ["articles/foo"],
    });
    expect(drafts[0].bodyLength).toBe(1200);
    expect(drafts[0].bodyPreview).toHaveLength(800);
    expect(drafts[1]).toMatchObject({
      slug: "stances/b",
      kernelPageId: "wp_kernel",
      derivedFromKernelVersion: "0.2.1",
      bodyLength: 10,
    });
  });

  it("scopes by org + status=draft in the query", async () => {
    (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await listOverlayDrafts();
    const arg = (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where).toEqual({ organizationId: "org_test", status: "draft" });
    expect(arg.orderBy).toEqual([{ updatedAt: "desc" }, { slug: "asc" }]);
  });

  it("rejects when not authenticated", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(listOverlayDrafts()).rejects.toThrow(/not authenticated/i);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  appendRevision,
  attachSource,
  getWikiPage,
  linkPages,
  upsertWikiPage,
} from "./wiki-store";

describe("wiki store helpers", () => {
  it("upserts a kernel page with organizationId=null", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "wp_kernel_1" });
    const db = { wikiPage: { upsert, findUnique: vi.fn(), findFirst: vi.fn() } };

    await upsertWikiPage(db, {
      slug: "entities/digital-product",
      title: "Digital Product",
      body: "A digital product is...",
      pageKind: "entity",
      isKernel: true,
      kernelVersion: "0.1.0",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_slug: { organizationId: null, slug: "entities/digital-product" } },
        create: expect.objectContaining({
          slug: "entities/digital-product",
          pageKind: "entity",
          isKernel: true,
          kernelVersion: "0.1.0",
          organizationId: null,
        }),
      }),
    );
  });

  it("upserts an org overlay page with kernelPageId set", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "wp_overlay_1" });
    const db = { wikiPage: { upsert, findUnique: vi.fn(), findFirst: vi.fn() } };

    await upsertWikiPage(db, {
      organizationId: "org_acme",
      slug: "entities/digital-product",
      title: "Digital Product (Acme override)",
      body: "Acme considers a digital product to also include...",
      pageKind: "entity",
      kernelPageId: "wp_kernel_1",
      derivedFromKernelVersion: "0.1.0",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_slug: {
            organizationId: "org_acme",
            slug: "entities/digital-product",
          },
        },
        create: expect.objectContaining({
          organizationId: "org_acme",
          kernelPageId: "wp_kernel_1",
          derivedFromKernelVersion: "0.1.0",
          isKernel: false,
        }),
      }),
    );
  });

  it("appends a revision with auto-incremented version when prior revisions exist", async () => {
    const findFirst = vi.fn().mockResolvedValue({ version: 4 });
    const create = vi.fn().mockResolvedValue({ id: "rev_5" });
    const db = { wikiPageRevision: { findFirst, create } };

    await appendRevision(db, {
      pageId: "wp_kernel_1",
      title: "Digital Product",
      body: "A digital product is... (v5)",
      changeKind: "manual",
      changeSummary: "Tightened the definition",
      createdById: "user_mark",
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pageId: "wp_kernel_1" },
        orderBy: { version: "desc" },
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pageId: "wp_kernel_1",
        version: 5,
        changeKind: "manual",
        createdById: "user_mark",
      }),
    });
  });

  it("appends version 1 when no prior revisions exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "rev_1" });
    const db = { wikiPageRevision: { findFirst, create } };

    await appendRevision(db, {
      pageId: "wp_kernel_1",
      title: "Digital Product",
      body: "First revision body",
      changeKind: "ingest",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 1, changeKind: "ingest" }),
    });
  });

  it("links pages idempotently", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { wikiPageLink: { upsert } };

    await linkPages(db, { fromPageId: "wp_a", toPageId: "wp_b" });

    expect(upsert).toHaveBeenCalledWith({
      where: { fromPageId_toPageId: { fromPageId: "wp_a", toPageId: "wp_b" } },
      create: { fromPageId: "wp_a", toPageId: "wp_b" },
      update: {},
    });
  });

  it("attaches a source citation idempotently", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { wikiPageSource: { upsert } };

    await attachSource(db, { pageId: "wp_a", sourceId: "src_paper_1" });

    expect(upsert).toHaveBeenCalledWith({
      where: { pageId_sourceId: { pageId: "wp_a", sourceId: "src_paper_1" } },
      create: { pageId: "wp_a", sourceId: "src_paper_1" },
      update: {},
    });
  });

  it("looks up a kernel page by slug with organizationId=null", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "wp_kernel_1" });
    const db = { wikiPage: { upsert: vi.fn(), findUnique, findFirst: vi.fn() } };

    await getWikiPage(db, { organizationId: null, slug: "entities/digital-product" });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_slug: {
          organizationId: null,
          slug: "entities/digital-product",
        },
      },
    });
  });
});

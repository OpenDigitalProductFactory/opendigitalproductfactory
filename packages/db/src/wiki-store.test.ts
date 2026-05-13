import { describe, expect, it, vi } from "vitest";
import {
  WIKI_PAGE_KINDS,
  WIKI_PAGE_STATUSES,
  appendRevision,
  attachSource,
  getWikiPage,
  linkPages,
  upsertWikiPage,
} from "./wiki-store";

describe("wiki-store re-exports from wiki-taxonomy", () => {
  it("re-exports WIKI_PAGE_KINDS including the principle kind", () => {
    expect(WIKI_PAGE_KINDS).toContain("principle");
    expect(WIKI_PAGE_KINDS).toHaveLength(8);
  });

  it("preserves the seven pre-existing kinds", () => {
    expect(WIKI_PAGE_KINDS).toEqual(
      expect.arrayContaining([
        "entity",
        "summary",
        "decision",
        "runbook",
        "index",
        "stance",
        "heuristic",
      ]),
    );
  });

  it("re-exports WIKI_PAGE_STATUSES for callers using the wiki-store entry point", () => {
    expect(WIKI_PAGE_STATUSES).toEqual([
      "draft",
      "published",
      "review-needed",
      "archived",
    ]);
  });
});

describe("upsertWikiPage with principle-only fields", () => {
  it("forwards principle metadata to create when no row exists", async () => {
    const { db, findFirst, create, update } = makeWikiPageMocks();
    findFirst.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: "wp_principle_new" });

    await upsertWikiPage(db, {
      slug: "principles/architecture-over-shortcuts",
      title: "Architecture Over Shortcuts",
      body: "## Rule\n\nPrefer architecturally sound solutions...",
      pageKind: "principle",
      isKernel: true,
      kernelVersion: "0.2.0",
      principleTier: "commandment",
      principleDirection:
        "Prefer long-term maintainability over short-term speed.",
      principleDimensionVector: {
        long_term_maintainability: 1.0,
        schema_grounding: 0.8,
        speed_to_value: -0.4,
      },
      principleDimensions: [
        "long_term_maintainability",
        "schema_grounding",
        "speed_to_value",
      ],
      principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
      principlePublic: true,
      principlePublicRationale:
        "Surface architecture posture to adopters and contributors.",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: "principles/architecture-over-shortcuts",
        pageKind: "principle",
        principleTier: "commandment",
        principleDirection:
          "Prefer long-term maintainability over short-term speed.",
        principleDimensionVector: {
          long_term_maintainability: 1.0,
          schema_grounding: 0.8,
          speed_to_value: -0.4,
        },
        principleDimensions: [
          "long_term_maintainability",
          "schema_grounding",
          "speed_to_value",
        ],
        principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
        principlePublic: true,
        principlePublicRationale:
          "Surface architecture posture to adopters and contributors.",
      }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("forwards principle metadata to update when a row already exists", async () => {
    const { db, findFirst, create, update } = makeWikiPageMocks();
    findFirst.mockResolvedValueOnce({ id: "wp_principle_existing" });
    update.mockResolvedValueOnce({ id: "wp_principle_existing" });

    await upsertWikiPage(db, {
      slug: "principles/evidence-before-diagnosis",
      title: "Evidence Before Diagnosis",
      body: "## Rule\n\nConfirm cause by querying state...",
      pageKind: "principle",
      isKernel: true,
      principleTier: "commandment",
      principleDirection: "Prefer queried state over inferred causes.",
      principleDimensionVector: { evidence_density: 1.0, blast_radius: 0.3 },
      principleDimensions: ["evidence_density", "blast_radius"],
      principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
      principlePublic: true,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "wp_principle_existing" },
      data: expect.objectContaining({
        principleTier: "commandment",
        principleDirection: "Prefer queried state over inferred causes.",
        principleDimensionVector: {
          evidence_density: 1.0,
          blast_radius: 0.3,
        },
        principleDimensions: ["evidence_density", "blast_radius"],
        principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
        principlePublic: true,
      }),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("defaults principle arrays + principlePublic when caller omits them", async () => {
    const { db, findFirst, create } = makeWikiPageMocks();
    findFirst.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: "wp_non_principle" });

    // A non-principle page should not receive principle-only fields in the
    // outgoing data payload; absence is the contract, not explicit nulls.
    await upsertWikiPage(db, {
      slug: "entities/edge-node",
      title: "Edge Node",
      body: "## Definition\n\nAn edge node is...",
      pageKind: "entity",
      isKernel: true,
    });

    const createArgs = create.mock.calls[0]?.[0];
    expect(createArgs.data.pageKind).toBe("entity");
    expect(createArgs.data).not.toHaveProperty("principleTier");
    expect(createArgs.data).not.toHaveProperty("principleDirection");
    expect(createArgs.data).not.toHaveProperty("principleDimensionVector");
  });

  it("does not require principleDirection for the DB layer (validation lives in lint)", async () => {
    const { db, findFirst, create } = makeWikiPageMocks();
    findFirst.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: "wp_principle_partial" });

    // Spec section 14: principle-missing-direction is a LINT finding, not a
    // store-layer rejection. The store accepts incomplete principle data so
    // that lint can surface findings on saved drafts.
    await expect(
      upsertWikiPage(db, {
        slug: "principles/draft-without-direction",
        title: "Draft principle missing direction",
        body: "## Rule\n\nTBD",
        pageKind: "principle",
        isKernel: true,
        principleTier: "core",
        principleAppliesTo: ["human"],
      }),
    ).resolves.toBeDefined();

    expect(create).toHaveBeenCalled();
  });
});

function makeWikiPageMocks() {
  const findFirst = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const findUnique = vi.fn();
  const db = { wikiPage: { findFirst, create, update, findUnique } };
  return { db, findFirst, create, update, findUnique };
}

describe("wiki store helpers", () => {
  it("creates a kernel page when none exists at (organizationId=null, slug)", async () => {
    const { db, findFirst, create, update } = makeWikiPageMocks();
    findFirst.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: "wp_kernel_new" });

    await upsertWikiPage(db, {
      slug: "entities/digital-product",
      title: "Digital Product",
      body: "A digital product is...",
      pageKind: "entity",
      isKernel: true,
      kernelVersion: "0.1.0",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: null, slug: "entities/digital-product" },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: "entities/digital-product",
        pageKind: "entity",
        isKernel: true,
        kernelVersion: "0.1.0",
        organizationId: null,
      }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("updates an existing kernel page in place when one exists at the same slug", async () => {
    const { db, findFirst, create, update } = makeWikiPageMocks();
    findFirst.mockResolvedValueOnce({ id: "wp_kernel_existing" });
    update.mockResolvedValueOnce({ id: "wp_kernel_existing" });

    await upsertWikiPage(db, {
      slug: "entities/digital-product",
      title: "Digital Product (revised)",
      body: "Updated body.",
      pageKind: "entity",
      isKernel: true,
      kernelVersion: "0.2.0",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "wp_kernel_existing" },
      data: expect.objectContaining({
        title: "Digital Product (revised)",
        body: "Updated body.",
        kernelVersion: "0.2.0",
      }),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates an org overlay page with kernelPageId set", async () => {
    const { db, findFirst, create } = makeWikiPageMocks();
    findFirst.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: "wp_overlay_1" });

    await upsertWikiPage(db, {
      organizationId: "org_acme",
      slug: "entities/digital-product",
      title: "Digital Product (Acme override)",
      body: "Acme considers a digital product to also include...",
      pageKind: "entity",
      kernelPageId: "wp_kernel_1",
      derivedFromKernelVersion: "0.1.0",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_acme", slug: "entities/digital-product" },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_acme",
        kernelPageId: "wp_kernel_1",
        derivedFromKernelVersion: "0.1.0",
        isKernel: false,
      }),
    });
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

  it("looks up a kernel page by slug via findFirst (not findUnique)", async () => {
    const { db, findFirst } = makeWikiPageMocks();
    findFirst.mockResolvedValueOnce({ id: "wp_kernel_1" });

    await getWikiPage(db, { organizationId: null, slug: "entities/digital-product" });

    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: null, slug: "entities/digital-product" },
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  RAW_SOURCE_TYPES,
  WIKI_PAGE_KINDS,
  WIKI_PAGE_STATUSES,
  appendRevision,
  attachSource,
  getWikiPage,
  isRawSourceType,
  linkPages,
  listPrinciplesByTier,
  recordIngestEvent,
  upsertRawSource,
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
  const findMany = vi.fn();
  const db = { wikiPage: { findFirst, create, update, findUnique, findMany } };
  return { db, findFirst, create, update, findUnique, findMany };
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

describe("listPrinciplesByTier", () => {
  function makeListMocks() {
    const findMany = vi.fn();
    const db = { wikiPage: { findMany } };
    return { db, findMany };
  }

  it("queries published kernel principle pages matching the tier", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([
      { id: "wp1", slug: "principles/p1", title: "P1" },
    ]);

    await listPrinciplesByTier(db, { tier: "commandment" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pageKind: "principle",
          status: "published",
          principleTier: "commandment",
        }),
      }),
    );
  });

  it("filters by appliesTo using array containment (has)", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, {
      tier: "commandment",
      appliesTo: "external_coding_agent",
    });

    const arg = findMany.mock.calls[0][0] as {
      where: { principleAppliesTo: { has: string } };
    };
    expect(arg.where.principleAppliesTo).toEqual({
      has: "external_coding_agent",
    });
  });

  it("scopes to kernel rows when organizationId is null", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, {
      tier: "commandment",
      organizationId: null,
    });

    const arg = findMany.mock.calls[0][0] as {
      where: { organizationId: null };
    };
    expect(arg.where.organizationId).toBeNull();
  });

  it("includes both kernel and org rows when an organizationId is supplied", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, {
      tier: "core",
      organizationId: "org_acme",
    });

    const arg = findMany.mock.calls[0][0] as {
      where: { OR: Array<{ organizationId: string | null }> };
    };
    expect(arg.where.OR).toEqual([
      { organizationId: "org_acme" },
      { organizationId: null },
    ]);
  });

  it("respects an optional limit (default 50)", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, { tier: "commandment", limit: 10 });
    const arg = findMany.mock.calls[0][0] as { take: number };
    expect(arg.take).toBe(10);

    await listPrinciplesByTier(db, { tier: "commandment" });
    const arg2 = findMany.mock.calls[1][0] as { take: number };
    expect(arg2.take).toBe(50);
  });

  it("orders results by lastReviewedAt desc then title asc for stable listing", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, { tier: "commandment" });
    const arg = findMany.mock.calls[0][0] as {
      orderBy: Array<Record<string, "asc" | "desc">>;
    };
    expect(arg.orderBy).toEqual([
      { lastReviewedAt: "desc" },
      { title: "asc" },
    ]);
  });

  it("rejects unknown tier values with a clear error", async () => {
    const { db } = makeListMocks();
    await expect(
      listPrinciplesByTier(db, { tier: "imaginary" as never }),
    ).rejects.toThrow(/tier/);
  });
});

// ─── Raw source ingest helpers (Phase 2.1) ──────────────────────────────────

function makeRawSourceMock() {
  const upsert = vi.fn();
  const db = { rawSource: { upsert } };
  return { db, upsert };
}

function makeIngestEventMock() {
  const create = vi.fn();
  const db = { wikiIngestEvent: { create } };
  return { db, create };
}

describe("RAW_SOURCE_TYPES + isRawSourceType", () => {
  it("exposes the canonical six source types", () => {
    expect(RAW_SOURCE_TYPES).toEqual([
      "paper",
      "article",
      "spec",
      "doc",
      "framework",
      "external-url",
    ]);
  });

  it("narrows known strings via the type guard", () => {
    expect(isRawSourceType("paper")).toBe(true);
    expect(isRawSourceType("external-url")).toBe(true);
  });

  it("rejects unknown strings, non-strings, and null/undefined", () => {
    expect(isRawSourceType("podcast")).toBe(false);
    expect(isRawSourceType(null)).toBe(false);
    expect(isRawSourceType(undefined)).toBe(false);
    expect(isRawSourceType(42)).toBe(false);
  });
});

describe("upsertRawSource", () => {
  it("upserts on sourceKey with sensible defaults for unsupplied fields", async () => {
    const { db, upsert } = makeRawSourceMock();
    upsert.mockResolvedValueOnce({ id: "rs_new", sourceKey: "articles/foo" });

    await upsertRawSource(db, {
      sourceKey: "articles/foo",
      sourceType: "article",
      title: "Foo",
    });

    const arg = upsert.mock.calls[0][0] as {
      where: { sourceKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ sourceKey: "articles/foo" });
    expect(arg.create).toMatchObject({
      sourceKey: "articles/foo",
      sourceType: "article",
      title: "Foo",
      authors: [],
      publishedAt: null,
      url: null,
      isKernel: false,
      organizationId: null,
    });
  });

  it("forwards every supplied optional field on both create and update sides", async () => {
    const { db, upsert } = makeRawSourceMock();
    upsert.mockResolvedValueOnce({ id: "rs_full" });
    const publishedAt = new Date("2024-12-01T00:00:00Z");
    const retrievedAt = new Date("2026-05-13T00:00:00Z");

    await upsertRawSource(db, {
      sourceKey: "papers/it4it-overview",
      sourceType: "paper",
      title: "IT4IT Overview",
      authors: ["Bodman, Mark", "Rossen, Lars"],
      publishedAt,
      url: "https://example.org/paper",
      doi: "10.0000/test",
      locator: { archive: "internal", id: "abc" },
      abstract: "An overview",
      excerpt: "Sample text",
      fullTextPath: "/tmp/fulltext.md",
      license: "CC-BY-4.0",
      retrievedAt,
      organizationId: "org_acme",
      isKernel: false,
    });

    const arg = upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    for (const side of [arg.create, arg.update]) {
      expect(side).toMatchObject({
        sourceType: "paper",
        title: "IT4IT Overview",
        authors: ["Bodman, Mark", "Rossen, Lars"],
        publishedAt,
        url: "https://example.org/paper",
        doi: "10.0000/test",
        abstract: "An overview",
        excerpt: "Sample text",
        fullTextPath: "/tmp/fulltext.md",
        license: "CC-BY-4.0",
        retrievedAt,
        organizationId: "org_acme",
        isKernel: false,
      });
    }
    expect(arg.create["sourceKey"]).toBe("papers/it4it-overview");
    expect(arg.update).not.toHaveProperty("sourceKey");
  });

  it("scopes kernel rows with isKernel=true and organizationId=null", async () => {
    const { db, upsert } = makeRawSourceMock();
    upsert.mockResolvedValueOnce({ id: "rs_kernel" });

    await upsertRawSource(db, {
      sourceKey: "frameworks/csdm",
      sourceType: "framework",
      title: "CSDM",
      isKernel: true,
    });

    const arg = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(arg.create).toMatchObject({
      isKernel: true,
      organizationId: null,
    });
  });
});

describe("recordIngestEvent", () => {
  it("creates an audit row with empty touchedPageIds when none are supplied", async () => {
    const { db, create } = makeIngestEventMock();
    create.mockResolvedValueOnce({ id: "evt_1" });

    await recordIngestEvent(db, { sourceId: "rs_1" });

    expect(create).toHaveBeenCalledWith({
      data: {
        sourceId: "rs_1",
        organizationId: null,
        touchedPageIds: [],
        agentId: null,
        userId: null,
        kernelVersion: null,
      },
    });
  });

  it("forwards every supplied attribution field", async () => {
    const { db, create } = makeIngestEventMock();
    create.mockResolvedValueOnce({ id: "evt_2" });

    await recordIngestEvent(db, {
      sourceId: "rs_2",
      organizationId: "org_acme",
      touchedPageIds: ["wp_a", "wp_b"],
      agentId: "agent_1",
      userId: "user_1",
      kernelVersion: "0.2.1",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        sourceId: "rs_2",
        organizationId: "org_acme",
        touchedPageIds: ["wp_a", "wp_b"],
        agentId: "agent_1",
        userId: "user_1",
        kernelVersion: "0.2.1",
      },
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  fetchWikiSnapshot,
  persistFindings,
  runWikiLint,
  type WikiLintPrismaClient,
} from "./lint";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makePrismaMock(seed: {
  pages?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  sources?: Array<Record<string, unknown>>;
  rawSources?: Array<Record<string, unknown>>;
  existingFindings?: Array<{ id: string; pageId: string; findingKind: string }>;
}): WikiLintPrismaClient & {
  __findingsCreated: ReturnType<typeof vi.fn>;
  __findingsUpdated: ReturnType<typeof vi.fn>;
  __findingsFetched: ReturnType<typeof vi.fn>;
  __pagesFetched: ReturnType<typeof vi.fn>;
} {
  const created = vi.fn();
  const updated = vi.fn();
  const findingsFetched = vi.fn(async () => seed.existingFindings ?? []);
  const pagesFetched = vi.fn(async () => seed.pages ?? []);
  return {
    wikiPage: { findMany: pagesFetched as never },
    wikiPageLink: { findMany: vi.fn(async () => seed.links ?? []) as never },
    wikiPageSource: { findMany: vi.fn(async () => seed.sources ?? []) as never },
    rawSource: { findMany: vi.fn(async () => seed.rawSources ?? []) as never },
    wikiLintFinding: {
      findMany: findingsFetched as never,
      create: created as never,
      update: updated as never,
    },
    __findingsCreated: created,
    __findingsUpdated: updated,
    __findingsFetched: findingsFetched,
    __pagesFetched: pagesFetched,
  };
}

const dummyPage = {
  id: "wp_1",
  slug: "entities/lonely",
  title: "Lonely",
  body: "An entity with no inbound link and no source.",
  pageKind: "entity",
  status: "published",
  isKernel: true,
  kernelVersion: "0.1.0",
  organizationId: null,
  kernelPageId: null,
  derivedFromKernelVersion: null,
};

// ─── fetchWikiSnapshot ───────────────────────────────────────────────────────

describe("fetchWikiSnapshot", () => {
  it("filters pages by organizationId IS NULL when linting the kernel", async () => {
    const prisma = makePrismaMock({});
    await fetchWikiSnapshot(prisma, null);
    expect(prisma.__pagesFetched).toHaveBeenCalledWith({
      where: { organizationId: null },
    });
  });

  it("includes both org-scoped and kernel pages when linting an org", async () => {
    const prisma = makePrismaMock({});
    await fetchWikiSnapshot(prisma, "org_acme");
    expect(prisma.__pagesFetched).toHaveBeenCalledWith({
      where: { OR: [{ organizationId: "org_acme" }, { organizationId: null }] },
    });
  });

  it("projects Prisma rows into the LintWikiPage shape", async () => {
    const prisma = makePrismaMock({
      pages: [
        {
          id: "wp_1",
          slug: "entities/test",
          title: "Test",
          body: "B",
          pageKind: "entity",
          status: "published",
          isKernel: true,
          kernelVersion: "0.1.0",
          organizationId: null,
          kernelPageId: null,
          derivedFromKernelVersion: null,
        },
      ],
    });
    const snap = await fetchWikiSnapshot(prisma, null);
    expect(snap.pages).toEqual([
      {
        id: "wp_1",
        slug: "entities/test",
        title: "Test",
        body: "B",
        pageKind: "entity",
        status: "published",
        isKernel: true,
        kernelVersion: "0.1.0",
        organizationId: null,
        kernelPageId: null,
        derivedFromKernelVersion: null,
      },
    ]);
  });

  it("preserves Date instances on retrievedAt and nulls others", async () => {
    const dt = new Date("2026-01-01T00:00:00Z");
    const prisma = makePrismaMock({
      rawSources: [
        { id: "src_1", retrievedAt: dt },
        { id: "src_2", retrievedAt: null },
        { id: "src_3" }, // missing field
      ],
    });
    const snap = await fetchWikiSnapshot(prisma, null);
    expect(snap.rawSources[0]).toEqual({ id: "src_1", retrievedAt: dt });
    expect(snap.rawSources[1]).toEqual({ id: "src_2", retrievedAt: null });
    expect(snap.rawSources[2]).toEqual({ id: "src_3", retrievedAt: null });
  });
});

// ─── persistFindings ─────────────────────────────────────────────────────────

describe("persistFindings", () => {
  it("creates a new row for a finding with no prior open match", async () => {
    const prisma = makePrismaMock({ existingFindings: [] });
    const res = await persistFindings(prisma, null, [
      {
        organizationId: null,
        pageId: "wp_1",
        findingKind: "orphan",
        severity: "warn",
        detail: { slug: "entities/lonely" },
      },
    ]);
    expect(res).toEqual({ opened: 1, kept: 0, resolved: 0 });
    expect(prisma.__findingsCreated).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: null,
        pageId: "wp_1",
        findingKind: "orphan",
        status: "open",
      }),
    });
  });

  it("updates an existing open row when the same (pageId, kind) re-emits", async () => {
    const prisma = makePrismaMock({
      existingFindings: [{ id: "f_existing", pageId: "wp_1", findingKind: "orphan" }],
    });
    const res = await persistFindings(prisma, null, [
      {
        organizationId: null,
        pageId: "wp_1",
        findingKind: "orphan",
        severity: "warn",
        detail: { reason: "no_sources" },
      },
    ]);
    expect(res).toEqual({ opened: 0, kept: 1, resolved: 0 });
    expect(prisma.__findingsUpdated).toHaveBeenCalledWith({
      where: { id: "f_existing" },
      data: expect.objectContaining({
        detail: { reason: "no_sources" },
        severity: "warn",
        status: "open",
      }),
    });
    expect(prisma.__findingsCreated).not.toHaveBeenCalled();
  });

  it("resolves prior findings that did not re-emit this run", async () => {
    const prisma = makePrismaMock({
      existingFindings: [
        { id: "f_old", pageId: "wp_other", findingKind: "stale" },
      ],
    });
    const res = await persistFindings(prisma, null, []);
    expect(res).toEqual({ opened: 0, kept: 0, resolved: 1 });
    expect(prisma.__findingsUpdated).toHaveBeenCalledWith({
      where: { id: "f_old" },
      data: expect.objectContaining({
        status: "resolved",
        resolvedAt: expect.any(Date),
      }),
    });
  });
});

// ─── runWikiLint (end-to-end with mocked prisma) ─────────────────────────────

describe("runWikiLint", () => {
  it("creates findings on a fresh fixture and reports counts", async () => {
    const prisma = makePrismaMock({
      pages: [dummyPage],
      existingFindings: [],
    });
    const res = await runWikiLint({
      organizationId: null,
      prisma,
      currentKernelVersion: "0.1.0",
    });
    expect(res.scannedPageCount).toBe(1);
    expect(res.findingsOpened).toBeGreaterThan(0); // orphan + dangling-xref shouldn't both fire here, just orphan
    expect(prisma.__findingsCreated).toHaveBeenCalled();
  });

  it("is idempotent — re-emitting the same finding keeps the prior row", async () => {
    const prisma = makePrismaMock({
      pages: [dummyPage],
      existingFindings: [{ id: "f_pre", pageId: "wp_1", findingKind: "orphan" }],
    });
    const res = await runWikiLint({
      organizationId: null,
      prisma,
      currentKernelVersion: "0.1.0",
    });
    expect(res.findingsOpened).toBe(0);
    expect(res.findingsKept).toBeGreaterThan(0);
    expect(prisma.__findingsCreated).not.toHaveBeenCalled();
  });

  it("propagates organizationId through the snapshot filter", async () => {
    const prisma = makePrismaMock({ pages: [], existingFindings: [] });
    await runWikiLint({
      organizationId: "org_acme",
      prisma,
      currentKernelVersion: "0.1.0",
    });
    expect(prisma.__pagesFetched).toHaveBeenCalledWith({
      where: { OR: [{ organizationId: "org_acme" }, { organizationId: null }] },
    });
    expect(prisma.__findingsFetched).toHaveBeenCalledWith({
      where: { organizationId: "org_acme", status: "open" },
    });
  });

  it("emits principle-only findings when a principle page is in the snapshot", async () => {
    // A principle page with no tier and no applies-to. Per Phase 1
    // detectors that should produce principle-missing-tier AND
    // principle-missing-applies-to findings at error severity.
    const principleDraft: Record<string, unknown> = {
      id: "wp_principle_draft",
      slug: "principles/draft",
      title: "Draft Principle",
      body: "## Rule\n\nTBD",
      pageKind: "principle",
      status: "draft",
      isKernel: true,
      kernelVersion: "0.2.0",
      organizationId: null,
      kernelPageId: null,
      derivedFromKernelVersion: null,
      principleTier: null,
      principleDirection: null,
      principleWeight: null,
      principleWeightRationale: null,
      principleDimensionVector: null,
      principleDimensions: [],
      principleAppliesTo: [],
      principlePublic: false,
      principlePublicRationale: null,
    };
    const prisma = makePrismaMock({
      pages: [principleDraft],
      existingFindings: [],
    });

    await runWikiLint({
      organizationId: null,
      prisma,
      currentKernelVersion: "0.2.0",
    });

    const createdKinds = prisma.__findingsCreated.mock.calls.map(
      (c) => (c[0] as { data: { findingKind: string } }).data.findingKind,
    );
    expect(createdKinds).toContain("principle-missing-tier");
    expect(createdKinds).toContain("principle-missing-applies-to");
  });
});

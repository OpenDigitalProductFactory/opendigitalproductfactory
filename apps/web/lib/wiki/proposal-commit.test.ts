import { describe, expect, it, vi } from "vitest";
import {
  commitIngestProposal,
  type CommitProposalInput,
} from "./proposal-commit";
import type {
  ClaimProposal,
  HeuristicProposal,
  StanceProposal,
  WikiDiffProposal,
} from "./proposal";

// ─── Mock factory ───────────────────────────────────────────────────────────

type FakePage = {
  id: string;
  slug: string;
  title: string;
  body: string;
  pageKind: string;
  status: string;
  isKernel: boolean;
  organizationId: string | null;
};

function makeMockClient(seed: FakePage[] = []) {
  const pages = new Map<string, FakePage>();
  for (const p of seed) pages.set(`${p.organizationId ?? "kernel"}:${p.slug}`, { ...p });

  const revisions: Array<Record<string, unknown>> = [];
  const links: Array<{ fromPageId: string; toPageId: string }> = [];
  const sources: Array<{ pageId: string; sourceId: string }> = [];
  const events: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const newId = () => `wp_test_${nextId++}`;

  const findFirst = vi.fn(async (args: { where: Record<string, unknown>; select?: unknown }) => {
    const w = args.where;
    if (typeof w.id === "string") {
      for (const p of pages.values()) if (p.id === w.id) return { ...p };
      return null;
    }
    const orgId = w.organizationId ?? null;
    const slug = w.slug as string;
    return pages.get(`${orgId ?? "kernel"}:${slug}`) ?? null;
  });

  const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
    const id = newId();
    const page: FakePage = {
      id,
      slug: args.data.slug as string,
      title: args.data.title as string,
      body: args.data.body as string,
      pageKind: args.data.pageKind as string,
      status: (args.data.status as string) ?? "draft",
      isKernel: (args.data.isKernel as boolean) ?? false,
      organizationId: (args.data.organizationId as string | null) ?? null,
    };
    pages.set(`${page.organizationId ?? "kernel"}:${page.slug}`, page);
    return { ...page };
  });

  const update = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    for (const [key, p] of pages) {
      if (p.id === args.where.id) {
        const merged: FakePage = { ...p, ...(args.data as Partial<FakePage>) };
        pages.set(key, merged);
        return { ...merged };
      }
    }
    throw new Error(`update: page not found ${args.where.id}`);
  });

  const wikiPage = { findFirst, create, update, findUnique: vi.fn(), findMany: vi.fn() };

  const revisionCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
    revisions.push(args.data);
    return { id: `rev_${revisions.length}`, ...args.data };
  });
  const revisionFindFirst = vi.fn(async () => null);
  const wikiPageRevision = { create: revisionCreate, findFirst: revisionFindFirst };

  const linkUpsert = vi.fn(async (args: { create: { fromPageId: string; toPageId: string } }) => {
    links.push(args.create);
    return args.create;
  });
  const wikiPageLink = { upsert: linkUpsert };

  const sourceUpsert = vi.fn(async (args: { create: { pageId: string; sourceId: string } }) => {
    sources.push(args.create);
    return args.create;
  });
  const wikiPageSource = { upsert: sourceUpsert };

  const rawSource = { upsert: vi.fn() };

  const eventCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
    const id = `evt_${events.length + 1}`;
    events.push({ id, ...args.data });
    return { id, ...args.data };
  });
  const wikiIngestEvent = { create: eventCreate };

  const db = {
    wikiPage,
    wikiPageRevision,
    wikiPageLink,
    wikiPageSource,
    rawSource,
    wikiIngestEvent,
  };
  return {
    db,
    pages,
    revisions,
    links,
    sources,
    events,
    mocks: {
      findFirst,
      create,
      update,
      revisionCreate,
      linkUpsert,
      sourceUpsert,
      eventCreate,
    },
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeInput(
  proposal: WikiDiffProposal,
  organizationId: string | null = "org_test",
): CommitProposalInput {
  return {
    rawSourceId: "rs_1",
    sourceKey: "articles/example",
    proposal,
    organizationId,
    userId: "user_1",
    kernelVersion: "0.2.1",
  };
}

function emptyProposal(): WikiDiffProposal {
  return {
    abstract: "abs",
    claims: [],
    stances: [],
    heuristics: [],
    parseErrors: [],
  };
}

const claimSample = (overrides: Partial<ClaimProposal> = {}): ClaimProposal => ({
  claim: "Digital Product is the unit of organization.",
  targetSlug: "entities/digital-product",
  pageKind: "entity",
  proposeNew: false,
  confidence: 0.9,
  supportingExcerpt: "Pick one canonical model.",
  ...overrides,
});

const stanceSample = (overrides: Partial<StanceProposal> = {}): StanceProposal => ({
  statement: "Two-system integration always decays.",
  targetSlug: "stances/dont-integrate-ea-platform",
  proposeNew: true,
  supportingExcerpt: "The two-system pattern fails on reconciliation.",
  ...overrides,
});

const heuristicSample = (
  overrides: Partial<HeuristicProposal> = {},
): HeuristicProposal => ({
  rule: "When in doubt, auto-populate.",
  targetSlug: "heuristics/auto-populate-or-its-wrong",
  proposeNew: true,
  supportingExcerpt: "Manual inventory data is already lying to you.",
  ...overrides,
});

// ─── Kernel write refusal ───────────────────────────────────────────────────

describe("commitIngestProposal — kernel write refusal", () => {
  it("refuses to write when organizationId is null and surfaces a typed error", async () => {
    const { db, mocks, events } = makeMockClient();
    const result = await commitIngestProposal(
      db,
      makeInput({ ...emptyProposal(), claims: [claimSample()] }, null),
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/kernel writes are not allowed/);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    // Audit event still recorded so the attempt is visible.
    expect(events).toHaveLength(1);
    expect(result.eventId).toMatch(/^evt_/);
  });

  it("refuses to overwrite a kernel page even when scoped to an org overlay", async () => {
    const { db, mocks } = makeMockClient([
      {
        id: "wp_kernel_dp",
        slug: "entities/digital-product",
        title: "Digital Product",
        body: "kernel body",
        pageKind: "entity",
        status: "published",
        isKernel: true,
        organizationId: "org_test",
      },
    ]);
    const result = await commitIngestProposal(
      db,
      makeInput({ ...emptyProposal(), claims: [claimSample()] }),
    );
    expect(result.errors[0]).toMatch(/kernel page \(kernel pages are PR-only\)/);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

// ─── Confidence threshold ───────────────────────────────────────────────────

describe("commitIngestProposal — confidence threshold", () => {
  it("skips claims below acceptThreshold and surfaces them in skippedLowConfidence", async () => {
    const { db, mocks } = makeMockClient();
    const low = claimSample({ confidence: 0.4, claim: "Weak signal" });
    const high = claimSample({ confidence: 0.9, claim: "Strong signal", targetSlug: "entities/portfolio" });
    const result = await commitIngestProposal(
      db,
      makeInput({ ...emptyProposal(), claims: [low, high] }),
    );
    expect(result.skippedLowConfidence).toEqual([low]);
    expect(result.createdPageSlugs).toContain("entities/portfolio");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("respects an explicit acceptThreshold override", async () => {
    const { db } = makeMockClient();
    const result = await commitIngestProposal(db, {
      ...makeInput({ ...emptyProposal(), claims: [claimSample({ confidence: 0.4 })] }),
      acceptThreshold: 0.3,
    });
    expect(result.skippedLowConfidence).toEqual([]);
    expect(result.createdPageSlugs).toContain("entities/digital-product");
  });
});

// ─── New page creation ──────────────────────────────────────────────────────

describe("commitIngestProposal — creates new pages from templates", () => {
  it("creates an entity page from a claim with the SCHEMA-compliant section structure", async () => {
    const { db, mocks, pages } = makeMockClient();
    await commitIngestProposal(
      db,
      makeInput({ ...emptyProposal(), claims: [claimSample()] }),
    );
    const created = pages.get("org_test:entities/digital-product");
    expect(created?.status).toBe("draft");
    expect(created?.body).toMatch(/## Definition/);
    expect(created?.body).toMatch(/## Properties/);
    expect(created?.body).toMatch(/## Relationships/);
    expect(created?.body).toMatch(/## Source-anchored claims/);
    expect(created?.body).toMatch(/\[\[raw-sources\/articles\/example\]\]/);
    expect(mocks.revisionCreate).toHaveBeenCalled();
    expect(mocks.sourceUpsert).toHaveBeenCalled();
  });

  it("creates a stance page from a stance proposal with the SCHEMA stance structure", async () => {
    const { db, pages } = makeMockClient();
    await commitIngestProposal(
      db,
      makeInput({ ...emptyProposal(), stances: [stanceSample()] }),
    );
    const created = pages.get("org_test:stances/dont-integrate-ea-platform");
    expect(created?.body).toMatch(/## Stance/);
    expect(created?.body).toMatch(/## Reasoning/);
    expect(created?.body).toMatch(/## When this applies \/ when it doesn't/);
    expect(created?.body).toMatch(/Two-system integration always decays/);
  });

  it("creates a heuristic page from a heuristic proposal with the rule/why/example structure", async () => {
    const { db, pages } = makeMockClient();
    await commitIngestProposal(
      db,
      makeInput({ ...emptyProposal(), heuristics: [heuristicSample()] }),
    );
    const created = pages.get("org_test:heuristics/auto-populate-or-its-wrong");
    expect(created?.body).toMatch(/## Rule/);
    expect(created?.body).toMatch(/## Why/);
    expect(created?.body).toMatch(/## Worked example/);
    expect(created?.body).toMatch(/When in doubt, auto-populate/);
  });

  it("rejects pass-2 stance/heuristic claims (those come from pass-3)", async () => {
    const { db, mocks } = makeMockClient();
    const result = await commitIngestProposal(
      db,
      makeInput({
        ...emptyProposal(),
        claims: [claimSample({ pageKind: "stance", targetSlug: "stances/foo" })],
      }),
    );
    expect(result.errors[0]).toMatch(/pass-2 cannot create stance\/heuristic/);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

// ─── Existing page update + body delta cap ──────────────────────────────────

describe("commitIngestProposal — appends to existing pages within delta cap", () => {
  it("appends a claim to an existing page body and creates a revision", async () => {
    const { db, pages, mocks } = makeMockClient([
      {
        id: "wp_existing",
        slug: "entities/portfolio",
        // Body intentionally large so the append stays comfortably under the
        // default 30% body-delta cap; the cap behaviour gets its own test.
        body: `## Definition\n\nA portfolio is a curated set of digital products.\n\n${"existing-content ".repeat(80)}`,
        title: "Portfolio",
        pageKind: "entity",
        status: "published",
        isKernel: false,
        organizationId: "org_test",
      },
    ]);
    const result = await commitIngestProposal(
      db,
      makeInput({
        ...emptyProposal(),
        claims: [
          claimSample({
            targetSlug: "entities/portfolio",
            claim: "A portfolio is grouped by management purpose.",
            supportingExcerpt: "Curated set of digital products grouped for shared management.",
            confidence: 0.9,
          }),
        ],
      }),
    );
    expect(result.updatedPageSlugs).toContain("entities/portfolio");
    const updated = pages.get("org_test:entities/portfolio");
    expect(updated?.body).toContain("Additional source-anchored claims (ingested)");
    expect(updated?.body).toContain("A portfolio is grouped by management purpose.");
    expect(mocks.revisionCreate).toHaveBeenCalled();
  });

  it("is idempotent — the same claim re-applied does not duplicate the bullet", async () => {
    const seedPage: FakePage = {
      id: "wp_idem",
      slug: "entities/portfolio",
      title: "Portfolio",
      body: `## Definition\n\nA portfolio is a curated set.\n\n${"existing-content ".repeat(80)}`,
      pageKind: "entity",
      status: "published",
      isKernel: false,
      organizationId: "org_test",
    };
    const { db, pages, mocks } = makeMockClient([seedPage]);
    const claim = claimSample({
      targetSlug: "entities/portfolio",
      claim: "Idempotent claim.",
      supportingExcerpt: "evidence",
      confidence: 0.9,
    });

    await commitIngestProposal(
      db,
      makeInput({ ...emptyProposal(), claims: [claim] }),
    );
    const bodyAfterFirst = pages.get("org_test:entities/portfolio")?.body ?? "";
    const occurrencesFirst = bodyAfterFirst.match(/Idempotent claim/g)?.length ?? 0;

    await commitIngestProposal(
      db,
      makeInput({ ...emptyProposal(), claims: [claim] }),
    );
    const bodyAfterSecond = pages.get("org_test:entities/portfolio")?.body ?? "";
    const occurrencesSecond = bodyAfterSecond.match(/Idempotent claim/g)?.length ?? 0;

    expect(occurrencesFirst).toBe(1);
    expect(occurrencesSecond).toBe(1);
    // Second pass must not have created a new revision (no body change → upsert no-op).
    expect(mocks.revisionCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses an append that would exceed maxBodyDeltaRatio and reports it", async () => {
    const tinyBody = "x"; // 1 char — any append blows past 30%.
    const { db, pages, mocks } = makeMockClient([
      {
        id: "wp_tiny",
        slug: "entities/portfolio",
        title: "Portfolio",
        body: tinyBody,
        pageKind: "entity",
        status: "published",
        isKernel: false,
        organizationId: "org_test",
      },
    ]);
    const result = await commitIngestProposal(
      db,
      makeInput({
        ...emptyProposal(),
        claims: [claimSample({ targetSlug: "entities/portfolio", confidence: 0.9 })],
      }),
    );
    expect(result.errors[0]).toMatch(/maxBodyDeltaRatio/);
    expect(pages.get("org_test:entities/portfolio")?.body).toBe(tinyBody);
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });

  it("respects an explicit maxBodyDeltaRatio override", async () => {
    const { db, mocks } = makeMockClient([
      {
        id: "wp_a",
        slug: "entities/portfolio",
        title: "Portfolio",
        body: "x",
        pageKind: "entity",
        status: "published",
        isKernel: false,
        organizationId: "org_test",
      },
    ]);
    const result = await commitIngestProposal(db, {
      ...makeInput({
        ...emptyProposal(),
        claims: [claimSample({ targetSlug: "entities/portfolio", confidence: 0.9 })],
      }),
      // 1000x growth allowed — far above the natural ~180-char append from
      // a 1-char seed body, so the cap shouldn't fire.
      maxBodyDeltaRatio: 1000,
    });
    expect(result.errors).toEqual([]);
    expect(mocks.revisionCreate).toHaveBeenCalled();
  });
});

// ─── Audit event ────────────────────────────────────────────────────────────

describe("commitIngestProposal — audit event", () => {
  it("records a single WikiIngestEvent with all touched page ids and attribution", async () => {
    const { db, events } = makeMockClient();
    const result = await commitIngestProposal(
      db,
      makeInput({
        ...emptyProposal(),
        claims: [
          claimSample({ targetSlug: "entities/portfolio", confidence: 0.9 }),
          claimSample({ targetSlug: "entities/value-stream", confidence: 0.9 }),
        ],
        stances: [stanceSample()],
        heuristics: [heuristicSample()],
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceId: "rs_1",
      organizationId: "org_test",
      userId: "user_1",
      kernelVersion: "0.2.1",
    });
    expect((events[0] as { touchedPageIds: string[] }).touchedPageIds).toHaveLength(4);
    expect(result.touchedPageIds).toHaveLength(4);
  });

  it("dedupes touchedPageIds when multiple claims hit the same page", async () => {
    const { db, events } = makeMockClient([
      {
        id: "wp_existing",
        slug: "entities/portfolio",
        title: "Portfolio",
        body: "A".repeat(2000),
        pageKind: "entity",
        status: "published",
        isKernel: false,
        organizationId: "org_test",
      },
    ]);
    const result = await commitIngestProposal(
      db,
      makeInput({
        ...emptyProposal(),
        claims: [
          claimSample({ targetSlug: "entities/portfolio", claim: "Claim A", confidence: 0.9 }),
          claimSample({ targetSlug: "entities/portfolio", claim: "Claim B", confidence: 0.9 }),
        ],
      }),
    );
    expect(events[0]).toBeDefined();
    expect((events[0] as { touchedPageIds: string[] }).touchedPageIds).toEqual([
      "wp_existing",
    ]);
    expect(result.touchedPageIds).toEqual(["wp_existing"]);
  });
});

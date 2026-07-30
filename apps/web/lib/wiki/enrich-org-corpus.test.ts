// EP-CORPUS-BOOTSTRAP Phase 1 — tests for enrichOrgCorpus (BI-7C9D6198).

import { describe, it, expect, vi } from "vitest";
import { enrichOrgCorpus, type EnrichCorpusClient } from "./enrich-org-corpus";
import type { InferenceCallable } from "./proposal";

// ─── Test doubles ───────────────────────────────────────────────────────────

/** Build a stubbed Prisma-shaped client with vi.fn spies for every method
 *  enrichOrgCorpus touches. Defaults model the happy path; individual tests
 *  override `.mockResolvedValueOnce` as needed. */
function makeDbStub(opts: {
  /** Pre-existing wiki pages by slug (for findFirst inside commit step). */
  existingWikiPages?: Array<{ id: string; organizationId: string; slug: string; status: string; pageKind: string; body: string; abstract: string | null }>;
  /** Org profile presence — null means "not seeded yet". */
  profile?: { profileId: string; currentVersionId: string | null } | null;
} = {}) {
  const existingPages = opts.existingWikiPages ?? [];

  const rawSourceUpsert = vi.fn();
  const wikiIngestEventCreate = vi.fn();

  const wikiPageFindFirst = vi.fn();
  const wikiPageFindMany = vi.fn();
  const wikiPageCreate = vi.fn();
  const wikiPageUpdate = vi.fn();
  const wikiPageRevisionCreate = vi.fn();
  const wikiPageRevisionFindFirst = vi.fn();
  const wikiPageSourceUpsert = vi.fn();
  const wikiPageLinkUpsert = vi.fn();

  const profileFindUnique = vi.fn();
  const materialUpsert = vi.fn();

  // Default behaviors

  // RawSource upsert returns a fresh row each call.
  let rsCounter = 0;
  rawSourceUpsert.mockImplementation(async () => {
    rsCounter++;
    const now = new Date();
    return { id: `rs_${rsCounter}`, createdAt: now, updatedAt: now };
  });

  wikiIngestEventCreate.mockImplementation(async () => ({ id: `evt_${rsCounter}` }));

  // WikiPage stubs — track created pages so findFirst/findMany after the
  // commit step see them.
  const createdPages: Array<{
    id: string; organizationId: string; slug: string; title: string; body: string;
    abstract: string | null; pageKind: string; status: string; isKernel: boolean;
  }> = [];
  for (const p of existingPages) {
    createdPages.push({
      ...p,
      title: p.slug,
      isKernel: false,
    });
  }
  let pageCounter = 100;
  wikiPageCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    pageCounter++;
    const id = `wp_${pageCounter}`;
    const row = {
      id,
      organizationId: args.data.organizationId as string,
      slug: args.data.slug as string,
      title: (args.data.title as string) ?? "",
      body: (args.data.body as string) ?? "",
      abstract: (args.data.abstract as string | null) ?? null,
      pageKind: (args.data.pageKind as string) ?? "summary",
      status: (args.data.status as string) ?? "draft",
      isKernel: false,
    };
    createdPages.push(row);
    return row;
  });
  wikiPageUpdate.mockImplementation(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const id = args.where.id as string;
    const idx = createdPages.findIndex((p) => p.id === id);
    if (idx === -1) return { id };
    createdPages[idx] = { ...createdPages[idx], ...(args.data as object) } as typeof createdPages[number];
    return createdPages[idx];
  });
  wikiPageFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    const where = args.where;
    return createdPages.find(
      (p) =>
        (where.organizationId === undefined || p.organizationId === where.organizationId) &&
        (where.slug === undefined || p.slug === where.slug) &&
        (where.id === undefined || p.id === where.id),
    ) ?? null;
  });
  wikiPageFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    const where = args.where;
    const slugFilter = (where.slug as { in?: string[] } | string | undefined);
    return createdPages.filter((p) => {
      if (where.organizationId !== undefined && p.organizationId !== where.organizationId) return false;
      if (where.status !== undefined && p.status !== where.status) return false;
      if (slugFilter && typeof slugFilter === "object" && Array.isArray(slugFilter.in)) {
        return slugFilter.in.includes(p.slug);
      }
      if (typeof slugFilter === "string" && p.slug !== slugFilter) return false;
      return true;
    });
  });
  wikiPageRevisionCreate.mockImplementation(async () => ({ id: "rev_x" }));
  wikiPageRevisionFindFirst.mockImplementation(async () => null);
  wikiPageSourceUpsert.mockImplementation(async () => ({ id: "ps_x" }));
  wikiPageLinkUpsert.mockImplementation(async () => ({ id: "pl_x" }));

  // Profile stub — by default seeded with v1.
  const profile = opts.profile === undefined
    ? { profileId: "default", currentVersionId: "v1" }
    : opts.profile;
  profileFindUnique.mockImplementation(async (args: { where: { profileId: string } }) => {
    if (!profile) return null;
    return { profileId: args.where.profileId, currentVersionId: profile.currentVersionId };
  });

  materialUpsert.mockImplementation(async (args: {
    where: { materialId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => ({ materialId: args.where.materialId }));

  const db = {
    rawSource: { upsert: rawSourceUpsert },
    wikiIngestEvent: { create: wikiIngestEventCreate },
    wikiPage: {
      findFirst: wikiPageFindFirst,
      findMany: wikiPageFindMany,
      create: wikiPageCreate,
      update: wikiPageUpdate,
    },
    wikiPageRevision: {
      create: wikiPageRevisionCreate,
      findFirst: wikiPageRevisionFindFirst,
    },
    wikiPageSource: { upsert: wikiPageSourceUpsert },
    wikiPageLink: { upsert: wikiPageLinkUpsert },
    decisionPerspectiveProfile: { findUnique: profileFindUnique },
    perspectiveMaterial: { upsert: materialUpsert },
  } as unknown as EnrichCorpusClient;

  return {
    db,
    spies: {
      rawSourceUpsert,
      wikiIngestEventCreate,
      wikiPageCreate,
      wikiPageFindMany,
      profileFindUnique,
      materialUpsert,
    },
    createdPages,
  };
}

/** LLM inference stub that returns a deterministic 1-claim proposal targeting
 *  a fresh stance slug. Tests can override via vi.fn().mockImplementation. */
function makeProposalInfer(opts: {
  claimSlug?: string;
  pageKind?: "stance" | "entity" | "principle";
  proposeNew?: boolean;
} = {}): InferenceCallable {
  const slug = opts.claimSlug ?? "stances/we-default-to-rentals";
  const kind = opts.pageKind ?? "stance";
  const proposeNew = opts.proposeNew ?? true;

  return vi.fn(async (req) => {
    if (req.tier === "utility") {
      return "Auto-generated abstract for the source.";
    }
    if (req.systemPrompt.includes("PASS 2") || req.systemPrompt.includes("CLAIM EXTRACTION")) {
      return JSON.stringify({
        claims: [
          {
            claim: "We default to rentals over one-time sales.",
            target_slug: kind === "stance" ? slug : `entities/${slug.split("/")[1]}`,
            page_kind: kind === "stance" ? "stance" : kind,
            propose_new: proposeNew,
            confidence: 0.9,
            supporting_excerpt: "default to rentals",
          },
        ],
      });
    }
    // Pass 3 — return empty stances/heuristics so the test focuses on the
    // claims/commit path.
    return JSON.stringify({ stances: [], heuristics: [] });
  });
}

/** Keep orchestration tests hermetic. Production embedding is covered by the
 * embedding adapter tests; the fail-open case below injects its own failure. */
async function successfulEmbed(): Promise<boolean> {
  return true;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("enrichOrgCorpus (BI-7C9D6198)", () => {
  it("normalises input → ingest text → propose → commit → upsert PerspectiveMaterial (first-party trust)", async () => {
    const { db, spies, createdPages } = makeDbStub();
    const infer = makeProposalInfer({ claimSlug: "entities/rental-business", pageKind: "entity" });

    const result = await enrichOrgCorpus({
      organizationId: "org_acme",
      text: "We default to rentals. We serve seasonal customers.",
      provenance: { sourceType: "data-entry", sourceRef: { field: "mission" } },
      trust: "first-party",
      db,
      embed: successfulEmbed,
      infer,
    });

    // RawSource upserted with the deterministic sourceKey.
    expect(spies.rawSourceUpsert).toHaveBeenCalledTimes(1);
    const rsArg = spies.rawSourceUpsert.mock.calls[0][0] as { where: { sourceKey: string }; create: Record<string, unknown> };
    expect(rsArg.where.sourceKey).toBe('enrich:org_acme:data-entry:{"field":"mission"}');
    expect(rsArg.create.organizationId).toBe("org_acme");
    expect(rsArg.create.locator).toMatchObject({ field: "mission", sourceType: "data-entry" });

    // WikiPage was created (commit step ran).
    expect(spies.wikiPageCreate).toHaveBeenCalled();
    const created = createdPages.find((p) => p.slug.startsWith("entities/"));
    expect(created).toBeDefined();

    // Result surfaces the committed page id + slug.
    expect(result.committed.length).toBeGreaterThan(0);
    expect(result.committed[0].slug).toBe("entities/rental-business");
    expect(result.committed[0].pageId).toBe(created!.id);

    // PerspectiveMaterial upserted with first-party trust shape.
    expect(spies.materialUpsert).toHaveBeenCalledTimes(1);
    const matArg = spies.materialUpsert.mock.calls[0][0] as {
      where: { materialId: string };
      create: Record<string, unknown>;
    };
    expect(matArg.where.materialId).toBe("org-perspective-org_acme:entities/rental-business");
    expect(matArg.create).toMatchObject({
      profileId: "org-perspective-org_acme",
      profileVersionId: "v1",
      evidenceGrade: "A",
      // Draft by default (BI-1378): even first-party enrichment awaits review.
      reviewStatus: "draft",
      promotionState: "candidate",
      direction: "support",
      freshness: "current",
    });
    expect((matArg.create.sourceRef as Record<string, unknown>).enrichment).toMatchObject({
      sourceType: "data-entry",
      trust: "first-party",
    });
    expect(result.materialIds).toContain("org-perspective-org_acme:entities/rental-business");
  });

  it("researched trust → PerspectiveMaterial lands as draft/candidate with evidence grade C", async () => {
    const { db, spies } = makeDbStub();
    const infer = makeProposalInfer({ claimSlug: "entities/market-segment", pageKind: "entity" });

    await enrichOrgCorpus({
      organizationId: "org_acme",
      text: "AI research finding: market is fragmented across 5 segments.",
      provenance: { sourceType: "research", sourceRef: { agent: "scout-coworker", urls: ["https://example.org/market"] } },
      trust: "researched",
      db,
      embed: successfulEmbed,
      infer,
    });

    const matArg = spies.materialUpsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(matArg.create).toMatchObject({
      evidenceGrade: "C",
      reviewStatus: "draft",
      promotionState: "candidate",
    });
    // confidenceWeight reduced for research-trust material.
    expect(matArg.create.confidenceWeight).toBeLessThan(0.5);
  });

  it("derived trust → grade B, draft/candidate (uploaded-doc extraction; draft by default)", async () => {
    const { db, spies } = makeDbStub();
    const infer = makeProposalInfer({ claimSlug: "entities/extracted-fact", pageKind: "entity" });

    await enrichOrgCorpus({
      organizationId: "org_acme",
      text: "Extracted from business plan: margin target is 38%.",
      provenance: { sourceType: "document", sourceRef: { documentId: "doc_42", page: 3 } },
      trust: "derived",
      db,
      embed: successfulEmbed,
      infer,
    });

    const matArg = spies.materialUpsert.mock.calls[0][0] as { create: Record<string, unknown> };
    // Per BI-1378: document-derived material lands as a draft for review, not
    // auto-promoted. The grade still reflects derived-from-first-party-doc trust.
    expect(matArg.create).toMatchObject({
      evidenceGrade: "B",
      reviewStatus: "draft",
      promotionState: "candidate",
    });
  });

  it("idempotent: re-invoking with the same provenance dedups by sourceKey, creates no new pages, leaves state stable", async () => {
    const { db, spies, createdPages } = makeDbStub();
    const infer = makeProposalInfer({ claimSlug: "entities/idem-target", pageKind: "entity" });

    const r1 = await enrichOrgCorpus({
      organizationId: "org_acme",
      text: "Idempotent body.",
      provenance: { sourceType: "data-entry", sourceRef: { field: "mission", version: 1 } },
      trust: "first-party",
      db,
      embed: successfulEmbed,
      infer,
    });

    const pagesAfterFirst = createdPages.length;
    expect(r1.materialIds.length).toBeGreaterThan(0);

    const r2 = await enrichOrgCorpus({
      organizationId: "org_acme",
      text: "Idempotent body.",
      provenance: { sourceType: "data-entry", sourceRef: { version: 1, field: "mission" } }, // key order swapped
      trust: "first-party",
      db,
      embed: successfulEmbed,
      infer,
    });

    // Both RawSource upsert calls used the SAME stable sourceKey — key order
    // in sourceRef must not affect the idempotency key.
    const k1 = (spies.rawSourceUpsert.mock.calls[0][0] as { where: { sourceKey: string } }).where.sourceKey;
    const k2 = (spies.rawSourceUpsert.mock.calls[1][0] as { where: { sourceKey: string } }).where.sourceKey;
    expect(k2).toBe(k1);

    // No NEW WikiPage created on re-invoke for the same slug (the commit step
    // appended to the existing page; with no body delta, nothing is touched).
    const sameSlugPages = createdPages.filter((p) => p.slug === "entities/idem-target");
    expect(sameSlugPages.length).toBe(1);
    expect(createdPages.length).toBe(pagesAfterFirst);

    // The commit-touched set is empty on the no-op round; materialIds reflects
    // that honestly (no work to redo). State is stable.
    expect(r2.committed).toEqual([]);
    expect(r2.materialIds).toEqual([]);
  });

  it("missing DecisionPerspectiveProfile → wiki pages still commit, no PerspectiveMaterial rows, warning surfaced", async () => {
    const { db, spies } = makeDbStub({ profile: null });
    const infer = makeProposalInfer({ claimSlug: "entities/pre-onboarding", pageKind: "entity" });

    const result = await enrichOrgCorpus({
      organizationId: "org_no_profile",
      text: "Captured before onboarding seeded the profile.",
      provenance: { sourceType: "qa", sourceRef: { question: "Where do you serve?" } },
      trust: "first-party",
      db,
      infer,
    });

    expect(result.committed.length).toBeGreaterThan(0);  // page committed
    expect(spies.materialUpsert).not.toHaveBeenCalled(); // no material upsert
    expect(result.materialIds).toEqual([]);
    expect(result.warnings.some((w) => w.includes("DecisionPerspectiveProfile"))).toBe(true);
  });

  it("fail-open embed: storeWikiPage returns false → page still persists, warning recorded", async () => {
    const { db } = makeDbStub();
    const infer = makeProposalInfer({ claimSlug: "entities/embed-failed", pageKind: "entity" });
    const failingEmbed = vi.fn(async () => false);

    const result = await enrichOrgCorpus({
      organizationId: "org_acme",
      text: "Body to embed.",
      provenance: { sourceType: "data-entry", sourceRef: { field: "description" } },
      trust: "first-party",
      db,
      embed: failingEmbed,
      infer,
    });

    expect(failingEmbed).toHaveBeenCalled();
    expect(result.committed.length).toBeGreaterThan(0); // page persisted
    expect(result.warnings.some((w) => w.includes("embedding"))).toBe(true);
  });
});

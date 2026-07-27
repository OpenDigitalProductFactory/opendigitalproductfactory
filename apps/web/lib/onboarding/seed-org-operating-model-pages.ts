// Operating-model WWWD pages (BI-44526F3E Phase B).
//
// The archetype starter seed (seed-org-wwwd-corpus.ts) gives a fresh install
// an honest but GENERIC stance corpus. Onboarding also persists the company's
// actual operating-model map — its market offer as DigitalProducts in the
// Goods and Services for Sale portfolio (seed-market-offer.ts), its portfolio
// decomposition on BusinessContext (seed-portfolio-decomposition.ts), and its
// supply/tooling as DigitalProducts in Manufacturing & Delivery / For
// Employees (projectArchetypeSupply) — but until now none of that map was
// reflected into the WWWD corpus, so the org's own decision gate could not
// cite a single concrete noun about the business.
//
// This module operationalizes the `contextualize-dont-transform` kernel
// stance: the map of the company's operating model INTO DPF's structure (their
// offers → DigitalProducts, their shape → Portfolios, their tools → the one
// platform model) BECOMES the org's WWWD overlay. It generates up to three
// org-overlay stance pages from the persisted map:
//
//   org-what-we-sell        — the actual offer lines + catalog items
//   org-how-we-are-organized — the portfolio decomposition, in plain language
//   org-tools-and-data      — what the business runs on, one platform model
//
// Non-destructive contract: every generated body carries a seed marker. A page
// whose current body lacks the marker was operator-authored (or operator-
// edited) and is NEVER overwritten. Marker-carrying pages regenerate only when
// the derived content actually changed (new revision + re-embed), so re-runs
// are a true no-op on a settled install. Pages whose source data is absent are
// skipped, never written as empty shells.
//
// Auto-publish is the same bootstrap exception seed-org-wwwd-corpus.ts uses —
// this runs at onboarding completion / boot backfill, not through the
// enrichment façade's draft-by-default review path.

import { prisma } from "@dpf/db";
import { upsertWikiPage, appendRevision } from "@dpf/db/wiki-store";
import { storeWikiPage, type StoreWikiPageInput } from "@/lib/wiki/embeddings";
import type { PortfolioDecomposition } from "@dpf/storefront-templates";

/** Marker proving a body was produced by this generator (operator edits drop it). */
export const OPERATING_MODEL_SEED_MARKER = "<!-- seed:operating-model-map -->";

const PLAN_READINESS_DOMAIN_CLASS = "plan-readiness";
const MAX_LISTED_ITEMS = 12;

const PORTFOLIO_SLUGS = {
  sold: "products_and_services_sold",
  supply: "manufacturing_and_delivery",
  forEmployees: "for_employees",
} as const;

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type SeedOperatingModelPagesClient = {
  organization: { findUnique: (args: unknown) => Promise<unknown> };
  businessContext: { findUnique: (args: unknown) => Promise<unknown> };
  portfolio: { findUnique: (args: unknown) => Promise<unknown> };
  digitalProduct: { findMany: (args: unknown) => Promise<unknown> };
  serviceOffering: { findMany: (args: unknown) => Promise<unknown> };
  decisionPerspectiveProfile: { findUnique: (args: unknown) => Promise<unknown> };
  perspectiveMaterial: { upsert: (args: unknown) => Promise<unknown> };
  wikiPage: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  wikiPageRevision: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
};

export type SeedOperatingModelPagesInput = {
  organizationId: string;
  /** Defaults to the shared prisma client. */
  db?: SeedOperatingModelPagesClient;
  /** Qdrant index step; injectable for tests. Defaults to storeWikiPage. */
  embed?: (input: StoreWikiPageInput) => Promise<boolean>;
};

export type SeedOperatingModelPagesResult = {
  /** Slugs written or refreshed this run. */
  written: string[];
  /** Slugs left alone because the operator owns the body (no seed marker). */
  preservedOperatorEdits: string[];
  /** Slugs skipped because their source data is absent. */
  skippedNoData: string[];
  /** True only if every written page was successfully embedded. */
  embedded: boolean;
};

type GeneratedPage = {
  slug: string;
  title: string;
  body: string;
  abstract: string;
};

type ProductRow = { id: string; productId: string; name: string; description: string | null };

function listNames(names: string[]): string {
  const shown = names.slice(0, MAX_LISTED_ITEMS);
  const lines = shown.map((n) => `- ${n}`);
  if (names.length > shown.length) {
    lines.push(`- …and ${names.length - shown.length} more`);
  }
  return lines.join("\n");
}

const ROLE_LABELS: Record<string, string> = {
  productsAndServicesSold: "Goods and Services for Sale — what we offer the market",
  manufactureAndDeliver: "Manufacturing & Delivery — how the work gets made and delivered",
  forEmployees: "Workforce — who and what performs work",
  foundational: "Foundational — the base the rest stands on",
};

const SCOPE_PHRASES: Record<string, string> = {
  primary: "a primary part of how this business runs",
  standard: "a standard part of how this business runs",
  minimal: "present but intentionally light",
  absent: "not part of this business",
};

function buildWhatWeSellPage(input: {
  orgLabel: string;
  targetMarket: string | null;
  offeringNames: string[];
  productNames: string[];
}): GeneratedPage | null {
  const names = input.offeringNames.length > 0 ? input.offeringNames : input.productNames;
  if (names.length === 0) return null;

  const audience = (input.targetMarket ?? "").trim();
  const body = [
    OPERATING_MODEL_SEED_MARKER,
    "# What we sell",
    "",
    `This is ${input.orgLabel}'s recorded market offer — each line lives as a product or service offering in the \`Goods and Services for Sale\` portfolio, so decisions about the catalog can point at the real thing rather than a description of it:`,
    "",
    listNames(names),
    "",
    audience ? `We sell this to ${audience}.` : "",
    "When a decision touches pricing, scope, or what to offer next, weigh it against this catalog and the people it serves (see `[[org-who-we-serve]]`). If the catalog above no longer matches reality, fix the portfolio — this page follows it.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    slug: "org-what-we-sell",
    title: "What we sell",
    body,
    abstract: `Our recorded market offer: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}.`,
  };
}

function buildHowWeAreOrganizedPage(input: {
  orgLabel: string;
  decomposition: PortfolioDecomposition | null;
}): GeneratedPage | null {
  const decomposition = input.decomposition;
  if (!decomposition || Object.keys(decomposition).length === 0) return null;

  const roleLines: string[] = [];
  for (const [role, profile] of Object.entries(decomposition)) {
    const label = ROLE_LABELS[role] ?? role;
    const scope = SCOPE_PHRASES[profile?.scope ?? ""] ?? null;
    if (!scope) continue;
    const offerings =
      Array.isArray(profile?.offerings) && profile.offerings.length > 0
        ? ` Includes: ${profile.offerings.slice(0, 6).join(", ")}.`
        : "";
    roleLines.push(`- **${label}**: ${scope}.${offerings}`);
  }
  if (roleLines.length === 0) return null;

  const body = [
    OPERATING_MODEL_SEED_MARKER,
    "# How we are organized",
    "",
    `${input.orgLabel}'s operating model is mapped into four portfolios — the same structure every decision, budget line, and coworker works against:`,
    "",
    ...roleLines,
    "",
    "When a decision is about where work or investment belongs, place it in one of these portfolios first; a decision that fits none of them is a signal the model needs updating, not a reason to bypass it. Our mission (`[[org-mission]]`) says why the business exists; this page says where its work lives.",
  ].join("\n");

  return {
    slug: "org-how-we-are-organized",
    title: "How we are organized",
    body,
    abstract: "Our operating model mapped into the four portfolios every decision and budget line works against.",
  };
}

function buildToolsAndDataPage(input: {
  orgLabel: string;
  supplyNames: string[];
  forEmployeeNames: string[];
}): GeneratedPage | null {
  if (input.supplyNames.length === 0 && input.forEmployeeNames.length === 0) return null;

  const sections: string[] = [];
  if (input.supplyNames.length > 0) {
    sections.push(
      "What the business consumes to deliver (recorded in `Manufacturing & Delivery`):",
      "",
      listNames(input.supplyNames),
      "",
    );
  }
  if (input.forEmployeeNames.length > 0) {
    sections.push(
      "What our workforce works with day to day (recorded in `Workforce`):",
      "",
      listNames(input.forEmployeeNames),
      "",
    );
  }

  const body = [
    OPERATING_MODEL_SEED_MARKER,
    "# Our tools and data",
    "",
    `${input.orgLabel} runs on one platform model: the tools, supplies, and systems below are recorded as products in our portfolios — one place, one truth — rather than a scatter of disconnected lists.`,
    "",
    ...sections,
    "When a decision is about adopting, replacing, or paying for a tool or supplier, check what is already recorded here first: prefer extending what we run to adding a parallel system, and when something new genuinely earns its place, record it in the portfolio so the model stays true.",
  ].join("\n");

  return {
    slug: "org-tools-and-data",
    title: "Our tools and data",
    body,
    abstract: "The tools, supplies, and systems this business runs on, recorded in one platform model.",
  };
}

async function productNamesInPortfolio(
  db: SeedOperatingModelPagesClient,
  slug: string,
): Promise<ProductRow[]> {
  const portfolio = (await db.portfolio.findUnique({
    where: { slug },
    select: { id: true },
  })) as { id: string } | null;
  if (!portfolio) return [];

  return (await db.digitalProduct.findMany({
    where: { portfolioId: portfolio.id },
    select: { id: true, productId: true, name: true, description: true },
    orderBy: { name: "asc" },
  })) as ProductRow[];
}

/**
 * Generate the operating-model WWWD pages from the persisted map. Idempotent;
 * never overwrites an operator-authored or operator-edited body.
 */
export async function seedOrgOperatingModelPages(
  input: SeedOperatingModelPagesInput,
): Promise<SeedOperatingModelPagesResult> {
  const db = input.db ?? (prisma as unknown as SeedOperatingModelPagesClient);
  const embed = input.embed ?? storeWikiPage;
  const organizationId = input.organizationId;

  const [org, bc, soldProducts, supplyProducts, forEmployeeProducts] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }) as Promise<{ name: string | null } | null>,
    db.businessContext.findUnique({
      where: { organizationId },
      select: { targetMarket: true, portfolioDecomposition: true },
    }) as Promise<{ targetMarket: string | null; portfolioDecomposition: unknown } | null>,
    productNamesInPortfolio(db, PORTFOLIO_SLUGS.sold),
    productNamesInPortfolio(db, PORTFOLIO_SLUGS.supply),
    productNamesInPortfolio(db, PORTFOLIO_SLUGS.forEmployees),
  ]);

  const orgLabel = (org?.name ?? "").trim() || "this organization";

  // The market-offer product's ServiceOfferings are the actual catalog lines
  // (e.g. "New Patient Examination"), more concrete than the product name.
  const marketOffer = soldProducts.find(
    (p) => p.productId === `DP-MARKET-OFFER-${organizationId}`,
  );
  const offerings = marketOffer
    ? ((await db.serviceOffering.findMany({
        where: { digitalProductId: marketOffer.id },
        select: { name: true },
        orderBy: { name: "asc" },
      })) as Array<{ name: string }>)
    : [];

  const decomposition =
    bc && typeof bc.portfolioDecomposition === "object" && bc.portfolioDecomposition !== null && !Array.isArray(bc.portfolioDecomposition)
      ? (bc.portfolioDecomposition as PortfolioDecomposition)
      : null;

  const candidates: Array<GeneratedPage | null> = [
    buildWhatWeSellPage({
      orgLabel,
      targetMarket: bc?.targetMarket ?? null,
      offeringNames: offerings.map((o) => o.name),
      productNames: soldProducts.map((p) => p.name),
    }),
    buildHowWeAreOrganizedPage({ orgLabel, decomposition }),
    buildToolsAndDataPage({
      orgLabel,
      supplyNames: supplyProducts.map((p) => p.name),
      forEmployeeNames: forEmployeeProducts.map((p) => p.name),
    }),
  ];

  const result: SeedOperatingModelPagesResult = {
    written: [],
    preservedOperatorEdits: [],
    skippedNoData: [],
    embedded: true,
  };

  const allSlugs = ["org-what-we-sell", "org-how-we-are-organized", "org-tools-and-data"];
  const generatedSlugs = new Set(
    candidates.filter((c): c is GeneratedPage => c !== null).map((c) => c.slug),
  );
  for (const slug of allSlugs) {
    if (!generatedSlugs.has(slug)) result.skippedNoData.push(slug);
  }

  const profileId = `org-perspective-${organizationId}`;
  const profile = (await db.decisionPerspectiveProfile.findUnique({
    where: { profileId },
    select: { profileId: true, currentVersionId: true },
  })) as { profileId: string; currentVersionId: string | null } | null;

  for (const page of candidates) {
    if (!page) continue;

    const existing = (await db.wikiPage.findFirst({
      where: { organizationId, slug: page.slug },
      select: { id: true, body: true },
    })) as { id: string; body: string } | null;

    // Operator owns the body the moment the seed marker is gone.
    if (existing && !existing.body.includes(OPERATING_MODEL_SEED_MARKER)) {
      result.preservedOperatorEdits.push(page.slug);
      continue;
    }

    // Unchanged derived content → true no-op (no revision, no re-embed).
    if (existing && existing.body === page.body) {
      continue;
    }

    const saved = (await upsertWikiPage(db as unknown as Parameters<typeof upsertWikiPage>[0], {
      organizationId,
      slug: page.slug,
      title: page.title,
      body: page.body,
      pageKind: "stance",
      status: "published",
      isKernel: false,
      abstract: page.abstract,
    })) as { id: string };

    await appendRevision(db as unknown as Parameters<typeof appendRevision>[0], {
      pageId: saved.id,
      title: page.title,
      body: page.body,
      changeKind: "ingest",
      changeSummary: "operating-model map seed",
    });

    const ok = await embed({
      pageId: saved.id,
      slug: page.slug,
      title: page.title,
      body: page.body,
      abstract: page.abstract,
      pageKind: "stance",
      status: "published",
      isKernel: false,
      kernelVersion: null,
      organizationId,
      kernelPageId: null,
    });
    if (!ok) result.embedded = false;

    if (profile) {
      const materialId = `${profileId}:${page.slug}`;
      await db.perspectiveMaterial.upsert({
        where: { materialId },
        update: {
          profileVersionId: profile.currentVersionId,
          sourceType: "stance",
          sourceRef: { wikiPageId: saved.id, slug: page.slug, organizationId },
          summary: page.abstract,
          freshness: "current",
        },
        create: {
          materialId,
          profileId,
          profileVersionId: profile.currentVersionId,
          sourceType: "stance",
          sourceRef: { wikiPageId: saved.id, slug: page.slug, organizationId },
          scope: { domains: [PLAN_READINESS_DOMAIN_CLASS] },
          domainClass: PLAN_READINESS_DOMAIN_CLASS,
          direction: "support",
          domains: [PLAN_READINESS_DOMAIN_CLASS],
          freshness: "current",
          evidenceGrade: "B",
          confidenceWeight: 0.6,
          reviewStatus: "approved",
          promotionState: "promoted",
          summary: page.abstract,
        },
      });
    }

    result.written.push(page.slug);
  }

  return result;
}

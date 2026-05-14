// EP-WIKI-001 Phase 1a: typed CRUD helpers for the wiki kernel + per-org overlay.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 1a)
//
// Style mirrors discovery-fingerprint-store.ts — callers pass in a `db`
// client so the helpers can run inside a Prisma $transaction or against
// a mocked client in tests.

// Helper signature uses `any` on the parameter (not `unknown`) so the
// real Prisma delegate methods — whose argument types are union-typed
// SelectSubsets — remain assignable. This matches the runtime contract
// (we forward whatever shape Prisma expects); tests pass narrow mocks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaWriteAction<TResult = unknown> = (args: any) => Promise<TResult>;

export type WikiStoreClient = {
  wikiPage: {
    create: PrismaWriteAction;
    update: PrismaWriteAction;
    findUnique: PrismaWriteAction;
    findFirst: PrismaWriteAction;
    findMany: PrismaWriteAction;
  };
  wikiPageRevision: {
    create: PrismaWriteAction;
    findFirst: PrismaWriteAction;
  };
  wikiPageLink: {
    upsert: PrismaWriteAction;
  };
  wikiPageSource: {
    upsert: PrismaWriteAction;
  };
  rawSource: {
    upsert: PrismaWriteAction;
  };
  wikiIngestEvent: {
    create: PrismaWriteAction;
  };
};

type WikiPageUpsertClient = Pick<WikiStoreClient, "wikiPage">;
type WikiRevisionClient = Pick<WikiStoreClient, "wikiPageRevision">;
type WikiPageLinkClient = Pick<WikiStoreClient, "wikiPageLink">;
type WikiPageSourceClient = Pick<WikiStoreClient, "wikiPageSource">;
type RawSourceClient = Pick<WikiStoreClient, "rawSource">;
type WikiIngestEventClient = Pick<WikiStoreClient, "wikiIngestEvent">;

// ─── Types ──────────────────────────────────────────────────────────────────

// Page kinds, statuses, and the principle-only taxonomy live in
// wiki-taxonomy.ts (the single source of truth used by seed, lint, MCP
// schemas, retrieval, and UI). Imported for local use in this file's input
// types AND re-exported so existing callers importing from wiki-store keep
// working.
import type {
  PrincipleAppliesTo,
  PrincipleDimension,
  PrincipleTier,
  WikiPageKind,
  WikiPageStatus,
} from "./wiki-taxonomy";
export { WIKI_PAGE_KINDS, WIKI_PAGE_STATUSES } from "./wiki-taxonomy";
export type {
  PrincipleAppliesTo,
  PrincipleDimension,
  PrincipleTier,
  WikiPageKind,
  WikiPageStatus,
};

/**
 * Optional principle-only fields. Only meaningful when pageKind === "principle".
 * The store layer accepts incomplete principle data; required-field gating
 * (tier present, direction present for commandment/core, dimension vector
 * dimensions in registry, applies-to populated, etc.) lives in lint
 * detectors per spec section 14.
 */
export type WikiPagePrincipleInput = {
  principleTier?: PrincipleTier | null;
  principleDirection?: string | null;
  principleWeight?: number | null;
  principleWeightRationale?: string | null;
  /**
   * Signed dimension vector keyed by registry dimensions, values in [-1..1].
   * Validation against PRINCIPLE_DIMENSIONS happens at the seed/lint layer;
   * the store passes through whatever the caller supplies so a draft with
   * an unknown key can still be saved for lint to surface.
   */
  principleDimensionVector?: Record<PrincipleDimension | string, number> | null;
  principleDimensions?: PrincipleDimension[] | string[];
  principleAppliesTo?: PrincipleAppliesTo[] | string[];
  principlePublic?: boolean;
  principlePublicRationale?: string | null;
};

/** Revision provenance defined in EP-WIKI-001 §4. */
export type WikiRevisionChangeKind = "ingest" | "manual" | "lint-fix" | "kernel-merge";

export type UpsertWikiPageInput = {
  /** Kernel rows leave organizationId undefined; org overlay rows set it. */
  organizationId?: string | null;
  slug: string;
  title: string;
  body: string;
  pageKind: WikiPageKind;
  status?: WikiPageStatus;
  isKernel?: boolean;
  kernelVersion?: string | null;
  /** Set to the kernel page being overridden; null for kernel rows and org-original rows. */
  kernelPageId?: string | null;
  derivedFromKernelVersion?: string | null;
  abstract?: string | null;
} & WikiPagePrincipleInput;

/**
 * Build the principle-field subset of the create/update data object. Only
 * emits keys when the caller supplied a principle-shaped input — preserves
 * the contract that non-principle pages never carry principle metadata at
 * the DB layer (their absence is the marker, not explicit nulls).
 */
function principleDataFromInput(
  input: UpsertWikiPageInput,
): Record<string, unknown> {
  if (input.pageKind !== "principle") {
    return {};
  }
  const data: Record<string, unknown> = {};
  if (input.principleTier !== undefined) {
    data.principleTier = input.principleTier;
  }
  if (input.principleDirection !== undefined) {
    data.principleDirection = input.principleDirection;
  }
  if (input.principleWeight !== undefined) {
    data.principleWeight = input.principleWeight;
  }
  if (input.principleWeightRationale !== undefined) {
    data.principleWeightRationale = input.principleWeightRationale;
  }
  if (input.principleDimensionVector !== undefined) {
    data.principleDimensionVector = input.principleDimensionVector;
  }
  if (input.principleDimensions !== undefined) {
    data.principleDimensions = input.principleDimensions;
  }
  if (input.principleAppliesTo !== undefined) {
    data.principleAppliesTo = input.principleAppliesTo;
  }
  if (input.principlePublic !== undefined) {
    data.principlePublic = input.principlePublic;
  }
  if (input.principlePublicRationale !== undefined) {
    data.principlePublicRationale = input.principlePublicRationale;
  }
  return data;
}

export type AppendRevisionInput = {
  pageId: string;
  title: string;
  body: string;
  changeKind: WikiRevisionChangeKind;
  changeSummary?: string | null;
  createdById?: string | null;
  createdByAgentId?: string | null;
};

export type LinkPagesInput = {
  fromPageId: string;
  toPageId: string;
};

export type AttachSourceInput = {
  pageId: string;
  sourceId: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Idempotent upsert keyed on (organizationId, slug). Kernel rows use
 * organizationId = null; org overlay rows set it to the requesting tenant.
 *
 * Per EP-WIKI-001 §3.3, kernel and org rows are physically separate — an
 * org override of a kernel page is a new WikiPage row with kernelPageId
 * pointing at the kernel row, not a flag on the kernel row itself.
 *
 * Implementation note: this is a findFirst-then-update-or-create rather
 * than a single `upsert` call because `@@unique([organizationId, slug])`
 * with a nullable `organizationId` doesn't work cleanly through Prisma's
 * compound-key upsert API — Prisma narrows the `organizationId` field
 * in the compound-key shape to non-nullable, so kernel rows (where
 * `organizationId IS NULL`) can't be addressed that way. PostgreSQL also
 * treats NULLs as distinct under the default constraint, so two kernel
 * rows with the same slug would be inserted by a naive `create`. The
 * findFirst-then-update-or-create pattern works for both kernel and
 * overlay rows uniformly.
 */
export async function upsertWikiPage(
  db: WikiPageUpsertClient,
  input: UpsertWikiPageInput,
): Promise<unknown> {
  const principleData = principleDataFromInput(input);
  const data = {
    slug: input.slug,
    title: input.title,
    body: input.body,
    pageKind: input.pageKind,
    status: input.status ?? "draft",
    isKernel: input.isKernel ?? false,
    kernelVersion: input.kernelVersion ?? null,
    organizationId: input.organizationId ?? null,
    kernelPageId: input.kernelPageId ?? null,
    derivedFromKernelVersion: input.derivedFromKernelVersion ?? null,
    abstract: input.abstract ?? null,
    ...principleData,
  };

  const existing = (await db.wikiPage.findFirst({
    where: { organizationId: data.organizationId, slug: data.slug },
    select: { id: true },
  })) as { id: string } | null;

  if (existing) {
    return db.wikiPage.update({
      where: { id: existing.id },
      data: {
        title: data.title,
        body: data.body,
        pageKind: data.pageKind,
        status: data.status,
        isKernel: data.isKernel,
        kernelVersion: data.kernelVersion,
        kernelPageId: data.kernelPageId,
        derivedFromKernelVersion: data.derivedFromKernelVersion,
        abstract: data.abstract,
        ...principleData,
      },
    });
  }

  return db.wikiPage.create({ data });
}

/**
 * Append a new revision and auto-increment the version. Caller is
 * responsible for updating the WikiPage body in the same transaction
 * if the new revision is the canonical content.
 */
export async function appendRevision(
  db: WikiRevisionClient,
  input: AppendRevisionInput,
): Promise<unknown> {
  const latest = (await db.wikiPageRevision.findFirst({
    where: { pageId: input.pageId },
    orderBy: { version: "desc" },
    select: { version: true },
  })) as { version: number } | null;

  const nextVersion = (latest?.version ?? 0) + 1;

  return db.wikiPageRevision.create({
    data: {
      pageId: input.pageId,
      version: nextVersion,
      title: input.title,
      body: input.body,
      changeKind: input.changeKind,
      changeSummary: input.changeSummary ?? null,
      createdById: input.createdById ?? null,
      createdByAgentId: input.createdByAgentId ?? null,
    },
  });
}

/**
 * Idempotent edge upsert. Multiple ingest passes that re-extract the
 * same wikilinks should not produce duplicate edges or fail.
 */
export async function linkPages(
  db: WikiPageLinkClient,
  input: LinkPagesInput,
): Promise<unknown> {
  return db.wikiPageLink.upsert({
    where: {
      fromPageId_toPageId: {
        fromPageId: input.fromPageId,
        toPageId: input.toPageId,
      },
    },
    create: {
      fromPageId: input.fromPageId,
      toPageId: input.toPageId,
    },
    update: {},
  });
}

/**
 * Idempotent source citation. Required by the publish gate
 * (EP-WIKI-001 §13: "WikiPageSource rows required for status=published").
 */
export async function attachSource(
  db: WikiPageSourceClient,
  input: AttachSourceInput,
): Promise<unknown> {
  return db.wikiPageSource.upsert({
    where: {
      pageId_sourceId: {
        pageId: input.pageId,
        sourceId: input.sourceId,
      },
    },
    create: {
      pageId: input.pageId,
      sourceId: input.sourceId,
    },
    update: {},
  });
}

/**
 * Lookup a wiki page by (organizationId, slug). Pass organizationId = null
 * to read kernel rows. Returns null when no row exists.
 *
 * Uses findFirst rather than findUnique for the same reason `upsertWikiPage`
 * does: Prisma's compound-key shape narrows organizationId to non-null, so
 * kernel rows can't be addressed via the compound key.
 */
export async function getWikiPage(
  db: WikiPageUpsertClient,
  args: { organizationId: string | null; slug: string },
): Promise<unknown> {
  return db.wikiPage.findFirst({
    where: {
      organizationId: args.organizationId,
      slug: args.slug,
    },
  });
}

// ─── Raw source ingest ──────────────────────────────────────────────────────

/**
 * Source types accepted by `RawSource.sourceType`. Mirrors the enum-shaped
 * convention documented in EP-WIKI-001 §4 and the founder-kernel folder
 * layout (`raw-sources/{papers,articles,specs,frameworks}` plus the
 * `external-url` catch-all for ad-hoc URL fetches).
 */
export const RAW_SOURCE_TYPES = [
  "paper",
  "article",
  "spec",
  "doc",
  "framework",
  "external-url",
] as const;
export type RawSourceType = (typeof RAW_SOURCE_TYPES)[number];

export function isRawSourceType(value: unknown): value is RawSourceType {
  return (
    typeof value === "string" &&
    (RAW_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

export type UpsertRawSourceInput = {
  /**
   * Stable, idempotent key for the source. The seed pipeline uses the slug
   * (e.g. `articles/sibling-portfolios`); ad-hoc URL ingests should use the
   * canonical URL.
   */
  sourceKey: string;
  sourceType: RawSourceType;
  title: string;
  authors?: string[];
  publishedAt?: Date | null;
  url?: string | null;
  doi?: string | null;
  /** Free-form structured pointer for sources without a URL (e.g. internal locator). */
  locator?: Record<string, unknown> | null;
  abstract?: string | null;
  excerpt?: string | null;
  fullTextPath?: string | null;
  license?: string | null;
  retrievedAt?: Date | null;
  /** Kernel rows leave organizationId undefined; org overlay rows set it. */
  organizationId?: string | null;
  isKernel?: boolean;
};

/**
 * Idempotent upsert keyed on `sourceKey @unique`. Re-ingesting the same
 * source updates mutable fields (title, abstract, excerpt, retrievedAt)
 * without rotating the row id — this preserves every `WikiPageSource`
 * citation pointed at it.
 *
 * `sourceKey` is intentionally a single-column unique (unlike WikiPage's
 * compound nullable key), so Prisma's `upsert` works directly here.
 */
export async function upsertRawSource(
  db: RawSourceClient,
  input: UpsertRawSourceInput,
): Promise<unknown> {
  const data = {
    sourceKey: input.sourceKey,
    sourceType: input.sourceType,
    title: input.title,
    authors: input.authors ?? [],
    publishedAt: input.publishedAt ?? null,
    url: input.url ?? null,
    doi: input.doi ?? null,
    locator: input.locator ?? undefined,
    abstract: input.abstract ?? null,
    excerpt: input.excerpt ?? null,
    fullTextPath: input.fullTextPath ?? null,
    license: input.license ?? null,
    retrievedAt: input.retrievedAt ?? null,
    organizationId: input.organizationId ?? null,
    isKernel: input.isKernel ?? false,
  };

  return db.rawSource.upsert({
    where: { sourceKey: input.sourceKey },
    create: data,
    update: {
      sourceType: data.sourceType,
      title: data.title,
      authors: data.authors,
      publishedAt: data.publishedAt,
      url: data.url,
      doi: data.doi,
      locator: data.locator,
      abstract: data.abstract,
      excerpt: data.excerpt,
      fullTextPath: data.fullTextPath,
      license: data.license,
      retrievedAt: data.retrievedAt,
      organizationId: data.organizationId,
      isKernel: data.isKernel,
    },
  });
}

export type RecordIngestEventInput = {
  sourceId: string;
  organizationId?: string | null;
  /** Wiki page ids touched by this ingest run; empty when only the source was upserted. */
  touchedPageIds?: string[];
  agentId?: string | null;
  userId?: string | null;
  /** Kernel version active at ingest time; null for org-only ingests. */
  kernelVersion?: string | null;
};

/**
 * Append-only audit row. Each invocation produces one event; the table is
 * the durable record of "who ingested what, when, and which pages it
 * touched". Pages-touched stays empty for Phase 2.1 source-only ingests
 * and gets populated by Phase 2.3 once the LLM proposal/commit path is
 * wired in.
 */
export async function recordIngestEvent(
  db: WikiIngestEventClient,
  input: RecordIngestEventInput,
): Promise<unknown> {
  return db.wikiIngestEvent.create({
    data: {
      sourceId: input.sourceId,
      organizationId: input.organizationId ?? null,
      touchedPageIds: input.touchedPageIds ?? [],
      agentId: input.agentId ?? null,
      userId: input.userId ?? null,
      kernelVersion: input.kernelVersion ?? null,
    },
  });
}

// ─── List principles by tier ────────────────────────────────────────────────

/**
 * Postgres-first principle retrieval, used by recallPrincipleContext to
 * always inject in-scope commandments regardless of Qdrant availability.
 *
 * - Filters to `pageKind = "principle"`, `status = "published"`, and the
 *   supplied tier.
 * - Scopes by `organizationId`: pass `null` for kernel-only; pass an org
 *   id to include BOTH that org's overlay rows AND kernel rows (kernel
 *   fallback per EP-WIKI-001 §3.3).
 * - `appliesTo` performs Prisma `has` array containment against the
 *   `principleAppliesTo` column.
 * - Default `limit` is 50 — generous enough for every commandment (cap 10)
 *   and a comfortable core slice; callers tighten as needed.
 * - Orders by `lastReviewedAt` desc then `title` asc so repeated calls
 *   return rows in the same order.
 *
 * Throws on unknown tier values to make seed/lint typos visible immediately
 * instead of returning silently empty results.
 */
export async function listPrinciplesByTier(
  db: { wikiPage: { findMany: PrismaWriteAction } },
  args: {
    tier: PrincipleTier;
    organizationId?: string | null;
    appliesTo?: PrincipleAppliesTo | string;
    limit?: number;
  },
): Promise<unknown[]> {
  if (
    !(["commandment", "core", "contextual"] as readonly string[]).includes(
      args.tier,
    )
  ) {
    throw new Error(
      `listPrinciplesByTier: unknown tier "${args.tier}". Allowed: commandment, core, contextual.`,
    );
  }

  const where: Record<string, unknown> = {
    pageKind: "principle",
    status: "published",
    principleTier: args.tier,
  };

  if (args.organizationId === null || args.organizationId === undefined) {
    if (args.organizationId === null) {
      where.organizationId = null;
    }
    // organizationId === undefined → no scope filter; caller wants either.
  } else {
    where.OR = [
      { organizationId: args.organizationId },
      { organizationId: null },
    ];
  }

  if (args.appliesTo !== undefined) {
    where.principleAppliesTo = { has: args.appliesTo };
  }

  return (await db.wikiPage.findMany({
    where,
    orderBy: [{ lastReviewedAt: "desc" }, { title: "asc" }],
    take: args.limit ?? 50,
  })) as unknown[];
}

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
  PrincipleConsumerArchetype,
  PrincipleConsumerContext,
  PrincipleDimension,
  PrincipleRingScope,
  PrincipleTier,
  WikiPageKind,
  WikiPageStatus,
} from "./wiki-taxonomy";
import type { PrincipleRuntimeEnforcement } from "./wiki-frontmatter";
export { WIKI_PAGE_KINDS, WIKI_PAGE_STATUSES } from "./wiki-taxonomy";
export type {
  PrincipleAppliesTo,
  PrincipleConsumerArchetype,
  PrincipleConsumerContext,
  PrincipleDimension,
  PrincipleRingScope,
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
  /**
   * Ring-scope axis — depth of the Reduction Gear loop the principle binds.
   * Independent of `principleConsumerArchetype` / `principleConsumerContexts`
   * (which describe domain). Validation against `PRINCIPLE_RING_SCOPES`
   * happens at seed/lint layer; the store passes through whatever the
   * caller supplies so a draft with an unknown value can still be saved
   * for lint to surface. See spec
   * `2026-05-24-founder-kernel-evolution-discipline-design.md` §3.
   */
  principleRingScope?: PrincipleRingScope[] | string[];
  /**
   * Consumer archetype — answers "who is expected to consume this principle?"
   * Independent axis from `principleAppliesTo`; the coherence rule for valid
   * combinations is in spec section 8A.1 and is enforced by lint, not at the
   * store layer. The store passes whatever the caller supplies so a draft
   * with an incoherent pairing can still be saved for lint to surface.
   */
  principleConsumerArchetype?: PrincipleConsumerArchetype | string | null;
  /**
   * Route/domain context slugs that scope a `route-domain-specific` archetype
   * (e.g., `["build-studio"]`). Empty array for non-route archetypes. Slug
   * shape and the "route-domain-specific requires at least one context" rule
   * are enforced by `isPrincipleConsumerContextSlug` + lint, not here.
   */
  principleConsumerContexts?: PrincipleConsumerContext[] | string[];
  principlePublic?: boolean;
  principlePublicRationale?: string | null;
  /**
   * Runtime enforcement payload (spec 2026-05-24, BI-43F95F77). Stored as
   * JSONB; consumed by apps/web/lib/kernel/runtime-gate.ts at execution
   * time. Store layer accepts the shape unchanged — schema validation
   * lives in lib/wiki/principle-lint-detectors.ts and runtime-gate's own
   * loader filters.
   */
  principleRuntimeEnforcement?: PrincipleRuntimeEnforcement | null;
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
  /**
   * Free-form frontmatter carried into the `WikiPage.metadata` Json column
   * (IT4IT, Scott Page, sensitivity, and — for profession-corpus pages — the
   * WSID variant axes `professionJurisdiction` / `professionCompetencyLevel`,
   * per the location/competency-variants spec). Merged as-is; the store does
   * not validate shape (seed/lint own that). Omitted = column left untouched.
   */
  metadata?: Record<string, unknown> | null;
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
  if (input.principleRingScope !== undefined) {
    data.principleRingScope = input.principleRingScope;
  }
  if (input.principleConsumerArchetype !== undefined) {
    data.principleConsumerArchetype = input.principleConsumerArchetype;
  }
  if (input.principleConsumerContexts !== undefined) {
    data.principleConsumerContexts = input.principleConsumerContexts;
  }
  if (input.principlePublic !== undefined) {
    data.principlePublic = input.principlePublic;
  }
  if (input.principlePublicRationale !== undefined) {
    data.principlePublicRationale = input.principlePublicRationale;
  }
  if (input.principleRuntimeEnforcement !== undefined) {
    data.principleRuntimeEnforcement = input.principleRuntimeEnforcement;
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
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
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
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
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
 * - Default `limit` is 50 — generous enough for every commandment (commandments
 *   are uncapped as of 2026-05-22; 19+ exist) and a comfortable core slice;
 *   callers tighten as needed but should not drop below the commandment count.
 * - Orders by `lastReviewedAt` desc then `title` asc so repeated calls
 *   return rows in the same order.
 * - `consumerContexts` (BI-5BB1A364), when supplied, filters out
 *   `route-domain-specific` rows whose `principleConsumerContexts` doesn't
 *   intersect the caller's declared contexts. Omitted (the default) is a
 *   no-op — every row still reaches the caller, matching the historical
 *   "consult everything" contract; the `principle_decide` scoring layer is
 *   responsible for down-weighting a route-domain-specific commandment when
 *   no context was declared at all.
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
    /**
     * Optional ring-scope filter (BI-4AA1074B Slice 2; spec §5.2).
     *
     * When provided, rows must satisfy one of:
     *   - `principleRingScope` is empty (backward-compat for un-backfilled rows)
     *   - `principleRingScope` contains `universal-ring` (earned-universal pass)
     *   - intersection with caller `ringScope` is non-empty
     *
     * When the caller's own scope contains `universal-ring`, the filter is a
     * no-op (caller did not constrain; consult the full kernel).
     *
     * Implemented via Prisma `AND` + nested `OR` so the SQL plan is a single
     * round-trip rather than a fetch-then-filter; same shape as the existing
     * `organizationId` OR clause.
     */
    ringScope?: PrincipleRingScope[] | string[];
    /**
     * Optional consumer-context filter (BI-5BB1A364).
     *
     * When provided (non-empty), rows must satisfy one of:
     *   - `principleConsumerContexts` is empty — backward-compat for
     *     `universal` / `generalist` / `specialist` archetypes, which never
     *     populate this column, and for un-backfilled `route-domain-specific`
     *     rows.
     *   - intersection with the caller's declared `consumerContexts` is
     *     non-empty.
     *
     * A `route-domain-specific` principle whose declared contexts don't
     * intersect the caller's is excluded from retrieval entirely — same
     * contract shape as `ringScope` above. When the caller does NOT declare
     * `consumerContexts` at all (the common case today), this filter is a
     * complete no-op: retrieval still "consults everything", matching prior
     * behavior. Scoring-layer attenuation (principle-decide-pack.ts) is what
     * keeps a contextless route-domain-specific commandment from voting at
     * full weight in that case — retrieval and scoring split the contract on
     * purpose, mirroring how ringScope's retrieval filter and its
     * commandmentConflict-adjacent scoring concerns stay separate.
     */
    consumerContexts?: PrincipleConsumerContext[] | string[];
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

  // Accumulate independent AND clauses so ring-scope and consumer-context
  // filtering compose instead of one silently clobbering the other (both
  // used to write `where.AND` directly, which was safe only because only
  // one filter ever existed at a time).
  const andClauses: Array<{ OR: Array<Record<string, unknown>> }> = [];

  // Ring-scope filter. Skipped entirely when the caller declared
  // `universal-ring` because that means "I am not constraining" — the
  // full kernel should reach the decision math.
  if (
    args.ringScope !== undefined &&
    args.ringScope.length > 0 &&
    !args.ringScope.includes("universal-ring")
  ) {
    andClauses.push({
      OR: [
        // Empty array — un-backfilled rows still pass so existing
        // behavior is preserved as ring-scope rolls out.
        { principleRingScope: { isEmpty: true } },
        // Author tagged universal-ring — passes any caller.
        { principleRingScope: { has: "universal-ring" } },
        // Intersection with caller scope is non-empty.
        { principleRingScope: { hasSome: args.ringScope } },
      ],
    });
  }

  // Consumer-context filter (BI-5BB1A364). Skipped entirely when the
  // caller did not declare `consumerContexts` — that means "I am not
  // constraining", same posture as an unset ringScope, and preserves
  // today's "consult everything" retrieval behavior verbatim.
  if (args.consumerContexts !== undefined && args.consumerContexts.length > 0) {
    andClauses.push({
      OR: [
        // Empty array — universal/generalist/specialist archetypes (and
        // un-backfilled route-domain-specific rows) never populate this
        // column, so they still pass.
        { principleConsumerContexts: { isEmpty: true } },
        // Intersection with the caller's declared contexts is non-empty.
        { principleConsumerContexts: { hasSome: args.consumerContexts } },
      ],
    });
  }

  if (andClauses.length > 0) {
    where.AND = andClauses;
  }

  return (await db.wikiPage.findMany({
    where,
    orderBy: [{ lastReviewedAt: "desc" }, { title: "asc" }],
    take: args.limit ?? 50,
  })) as unknown[];
}

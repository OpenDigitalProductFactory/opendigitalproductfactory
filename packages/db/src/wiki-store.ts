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
    upsert: PrismaWriteAction;
    findUnique: PrismaWriteAction;
    findFirst: PrismaWriteAction;
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
};

type WikiPageUpsertClient = Pick<WikiStoreClient, "wikiPage">;
type WikiRevisionClient = Pick<WikiStoreClient, "wikiPageRevision">;
type WikiPageLinkClient = Pick<WikiStoreClient, "wikiPageLink">;
type WikiPageSourceClient = Pick<WikiStoreClient, "wikiPageSource">;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Page kinds defined in docs/founder-kernel/SCHEMA.md and EP-WIKI-001 §4. */
export type WikiPageKind =
  | "entity"
  | "summary"
  | "decision"
  | "runbook"
  | "index"
  | "stance"
  | "heuristic";

/** Status lifecycle defined in EP-WIKI-001 §4. */
export type WikiPageStatus = "draft" | "published" | "review-needed" | "archived";

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
};

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
 */
export async function upsertWikiPage(
  db: WikiPageUpsertClient,
  input: UpsertWikiPageInput,
): Promise<unknown> {
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
  };

  return db.wikiPage.upsert({
    where: {
      organizationId_slug: {
        organizationId: input.organizationId ?? null,
        slug: input.slug,
      },
    },
    create: data,
    update: {
      title: data.title,
      body: data.body,
      pageKind: data.pageKind,
      status: data.status,
      isKernel: data.isKernel,
      kernelVersion: data.kernelVersion,
      kernelPageId: data.kernelPageId,
      derivedFromKernelVersion: data.derivedFromKernelVersion,
      abstract: data.abstract,
    },
  });
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
 */
export async function getWikiPage(
  db: WikiPageUpsertClient,
  args: { organizationId: string | null; slug: string },
): Promise<unknown> {
  return db.wikiPage.findUnique({
    where: {
      organizationId_slug: {
        organizationId: args.organizationId,
        slug: args.slug,
      },
    },
  });
}

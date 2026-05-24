// EP-WIKI-001 Phase 4b1: lint runtime orchestrator.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 4b)
//
// Wraps the pure detectors from `lint-detectors.ts` (PR #419) with a
// Prisma snapshot fetcher and a finding persister. Designed to be
// called from:
//   - the Inngest scheduled job (queue/functions/wiki-lint.ts)
//   - the wiki_lint MCP tool (Phase 4b2)
//   - admin endpoint for on-demand triggering (Phase 4b2)
//
// Phase 4b1 ships the orchestrator + scheduled job only. Phase 4b2
// adds the admin UI + MCP tool. Phase 4b3 adds detectContradictions
// (Qdrant cosine + LLM judge) and detectMissingXrefs (entity NER).

import {
  runDetectors,
  type LintFinding,
  type LintRawSource,
  type LintWikiPage,
  type LintWikiPageLink,
  type LintWikiPageSource,
} from "./lint-detectors";
import {
  runPrincipleDetectors,
  type LintPrincipleWikiPage,
} from "./principle-lint-detectors";
import { runPrincipleSimilarityDetectors } from "./principle-similarity";
import { generateEmbedding } from "@/lib/inference/embedding";

// ─── Input ──────────────────────────────────────────────────────────────────

export type RunWikiLintInput = {
  /** Tenant scope. `null` lints the kernel; a string lints that org's overlay rows. */
  organizationId: string | null;
  /** Prisma client (or a Prisma-shaped mock for tests). */
  prisma: WikiLintPrismaClient;
  /** Current kernel version from `docs/founder-kernel/manifest.json`. */
  currentKernelVersion: string;
  /** Optional override; default 180 days per spec §6. */
  staleThresholdDays?: number;
};

export type RunWikiLintResult = {
  organizationId: string | null;
  scannedPageCount: number;
  findingsOpened: number;
  findingsKept: number;
  findingsResolved: number;
};

// ─── Prisma surface ─────────────────────────────────────────────────────────

/**
 * Narrow view of the Prisma client that this orchestrator touches. Allows
 * the helper to be tested with a typed mock instead of a full PrismaClient
 * instance. Production callers pass the real `prisma` import.
 */
export type WikiLintPrismaClient = {
  wikiPage: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  wikiPageLink: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  wikiPageSource: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  rawSource: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  wikiLintFinding: {
    findMany: (args: unknown) => Promise<unknown[]>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
};

// ─── Snapshot fetch ─────────────────────────────────────────────────────────

/**
 * Build a typed snapshot of the wiki in the shape detectors expect.
 *
 * Per spec §3.3: kernel rows (organizationId IS NULL) are visible to every
 * org overlay (kernel fallback). When linting an org, the snapshot
 * includes both org-scoped rows AND kernel rows; when linting the kernel,
 * only kernel rows are included.
 */
export async function fetchWikiSnapshot(
  prisma: WikiLintPrismaClient,
  organizationId: string | null,
): Promise<{
  pages: LintWikiPage[];
  principlePages: LintPrincipleWikiPage[];
  links: LintWikiPageLink[];
  sources: LintWikiPageSource[];
  rawSources: LintRawSource[];
}> {
  const orgFilter =
    organizationId === null
      ? { organizationId: null }
      : { OR: [{ organizationId }, { organizationId: null }] };

  const [pages, links, sources, rawSources] = await Promise.all([
    prisma.wikiPage.findMany({ where: orgFilter }) as Promise<unknown[]>,
    prisma.wikiPageLink.findMany({}) as Promise<unknown[]>,
    prisma.wikiPageSource.findMany({}) as Promise<unknown[]>,
    prisma.rawSource.findMany({}) as Promise<unknown[]>,
  ]);

  const pageRows = pages as Array<Record<string, unknown>>;
  return {
    pages: pageRows.map(asLintWikiPage),
    principlePages: pageRows.map(asLintPrincipleWikiPage),
    links: (links as Array<Record<string, unknown>>).map(asLintWikiPageLink),
    sources: (sources as Array<Record<string, unknown>>).map(asLintWikiPageSource),
    rawSources: (rawSources as Array<Record<string, unknown>>).map(asLintRawSource),
  };
}

function asLintWikiPage(r: Record<string, unknown>): LintWikiPage {
  return {
    id: String(r["id"]),
    slug: String(r["slug"]),
    title: String(r["title"]),
    body: String(r["body"]),
    pageKind: String(r["pageKind"]),
    status: String(r["status"]),
    isKernel: Boolean(r["isKernel"]),
    kernelVersion: (r["kernelVersion"] as string | null) ?? null,
    organizationId: (r["organizationId"] as string | null) ?? null,
    kernelPageId: (r["kernelPageId"] as string | null) ?? null,
    derivedFromKernelVersion: (r["derivedFromKernelVersion"] as string | null) ?? null,
  };
}

/**
 * Build a principle-aware snapshot row, populating the principle-only
 * fields from the Prisma row. Non-principle rows still go through this
 * helper so the principle aggregator can filter on pageKind === "principle"
 * without a parallel pre-filter — the principle-only fields are nullable /
 * empty for non-principles per the schema defaults.
 */
function asLintPrincipleWikiPage(
  r: Record<string, unknown>,
): LintPrincipleWikiPage {
  const base = asLintWikiPage(r);
  const reviewed = r["lastReviewedAt"];
  return {
    ...base,
    principleTier: (r["principleTier"] as string | null) ?? null,
    principleDirection: (r["principleDirection"] as string | null) ?? null,
    principleWeight: (r["principleWeight"] as number | null) ?? null,
    principleWeightRationale:
      (r["principleWeightRationale"] as string | null) ?? null,
    principleDimensionVector:
      (r["principleDimensionVector"] as Record<string, number> | null) ?? null,
    principleDimensions: (r["principleDimensions"] as string[] | undefined) ?? [],
    principleAppliesTo: (r["principleAppliesTo"] as string[] | undefined) ?? [],
    principlePublic: Boolean(r["principlePublic"] ?? false),
    principlePublicRationale:
      (r["principlePublicRationale"] as string | null) ?? null,
    principleRuntimeEnforcement:
      (r["principleRuntimeEnforcement"] as
        | import("@dpf/db/wiki-frontmatter").PrincipleRuntimeEnforcement
        | null) ?? null,
    lastReviewedAt: reviewed instanceof Date ? reviewed : null,
  };
}

function asLintWikiPageLink(r: Record<string, unknown>): LintWikiPageLink {
  return { fromPageId: String(r["fromPageId"]), toPageId: String(r["toPageId"]) };
}

function asLintWikiPageSource(r: Record<string, unknown>): LintWikiPageSource {
  return { pageId: String(r["pageId"]), sourceId: String(r["sourceId"]) };
}

function asLintRawSource(r: Record<string, unknown>): LintRawSource {
  const retrievedAt = r["retrievedAt"];
  return {
    id: String(r["id"]),
    retrievedAt: retrievedAt instanceof Date ? retrievedAt : null,
  };
}

// ─── Finding persistence ────────────────────────────────────────────────────

/**
 * Idempotent finding persistence per the spec: a re-run does not produce
 * duplicate rows. Strategy:
 *   1. Fetch all open findings for the scope.
 *   2. For each new finding, if a row exists with the same
 *      (organizationId, pageId, findingKind), update its detail/severity
 *      in place. Otherwise insert.
 *   3. Any open finding from the prior run that wasn't re-emitted is
 *      marked `status: "resolved"` with the current timestamp.
 *
 * The `(organizationId, pageId, findingKind)` triple is the natural key
 * — a page has at most one open finding of each kind at a time. The
 * schema doesn't enforce uniqueness here yet; we enforce it in the
 * orchestrator and may add a composite unique index in a later PR.
 */
export async function persistFindings(
  prisma: WikiLintPrismaClient,
  organizationId: string | null,
  findings: LintFinding[],
): Promise<{ opened: number; kept: number; resolved: number }> {
  const existing = (await prisma.wikiLintFinding.findMany({
    where: { organizationId, status: "open" },
  })) as Array<{
    id: string;
    pageId: string;
    findingKind: string;
  }>;

  const existingByKey = new Map<string, { id: string }>();
  for (const f of existing) {
    existingByKey.set(`${f.pageId}::${f.findingKind}`, { id: f.id });
  }

  const seenKeys = new Set<string>();
  let opened = 0;
  let kept = 0;

  for (const f of findings) {
    const key = `${f.pageId}::${f.findingKind}`;
    seenKeys.add(key);
    const prior = existingByKey.get(key);
    if (prior) {
      kept += 1;
      await prisma.wikiLintFinding.update({
        where: { id: prior.id },
        data: {
          detail: f.detail,
          severity: f.severity,
          status: "open",
        },
      });
    } else {
      opened += 1;
      await prisma.wikiLintFinding.create({
        data: {
          organizationId: f.organizationId,
          pageId: f.pageId,
          findingKind: f.findingKind,
          severity: f.severity,
          status: "open",
          detail: f.detail,
        },
      });
    }
  }

  // Resolve findings that disappeared in this run.
  const now = new Date();
  let resolved = 0;
  for (const f of existing) {
    const key = `${f.pageId}::${f.findingKind}`;
    if (!seenKeys.has(key)) {
      resolved += 1;
      await prisma.wikiLintFinding.update({
        where: { id: f.id },
        data: { status: "resolved", resolvedAt: now },
      });
    }
  }

  return { opened, kept, resolved };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * One full lint pass over the wiki scope. Fetches the snapshot, runs
 * every detector that's available in this phase, persists findings
 * idempotently. Safe to re-run; safe to call concurrently for
 * different `organizationId` values.
 *
 * Returns counts so the caller (Inngest job, MCP tool, admin button)
 * can surface a one-line result.
 */
export async function runWikiLint(input: RunWikiLintInput): Promise<RunWikiLintResult> {
  const snap = await fetchWikiSnapshot(input.prisma, input.organizationId);

  // Generate direction embeddings for similarity detectors. Silent-
  // degradation: if embedding generation fails for any page (Ollama down,
  // empty direction), skip that page — the similarity detectors will
  // naturally produce zero findings for missing embeddings and the rest of
  // the lint pass still runs.
  const embeddings = new Map<string, number[]>();
  for (const page of snap.principlePages) {
    if (page.pageKind !== "principle") continue;
    if (!page.principleDirection) continue;
    try {
      const vec = await generateEmbedding(page.principleDirection);
      if (vec) embeddings.set(page.id, vec);
    } catch {
      // Treat as missing — similarity detectors handle absence
    }
  }

  const findings = [
    ...runDetectors({
      pages: snap.pages,
      links: snap.links,
      sources: snap.sources,
      rawSources: snap.rawSources,
      currentKernelVersion: input.currentKernelVersion,
      staleThresholdDays: input.staleThresholdDays,
    }),
    ...runPrincipleDetectors({ pages: snap.principlePages }),
    ...runPrincipleSimilarityDetectors({
      pages: snap.principlePages,
      embeddings,
    }),
  ];

  const persisted = await persistFindings(input.prisma, input.organizationId, findings);

  return {
    organizationId: input.organizationId,
    scannedPageCount: snap.pages.length,
    findingsOpened: persisted.opened,
    findingsKept: persisted.kept,
    findingsResolved: persisted.resolved,
  };
}

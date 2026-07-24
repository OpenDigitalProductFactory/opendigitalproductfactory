// packages/db/src/seed-wiki-kernel.ts
// EP-WIKI-001 Phase 5 machinery: reads docs/founder-kernel/, parses YAML
// frontmatter on each markdown, upserts kernel rows (RawSource + WikiPage),
// extracts [[wikilinks]], attaches source citations, optionally seeds
// Qdrant directly from a precomputed embeddings.jsonl sidecar.
//
// Idempotent: re-running advances the revision chain only when content
// has changed, and never duplicates links or source citations.
//
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 5)
//
// Style mirrors seed-skills.ts and seed-prompt-templates.ts.

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { PrismaClient } from "../generated/client/client";
import { QDRANT_COLLECTIONS, upsertVectors, type VectorPoint } from "./qdrant";
import {
  PRINCIPLE_CONSUMER_ARCHETYPES,
  PRINCIPLE_DIMENSIONS,
  PRINCIPLE_RING_SCOPES,
  isPrincipleConsumerArchetype,
  isPrincipleConsumerContextSlug,
  isPrincipleDimension,
  isPrincipleRingScope,
} from "./wiki-taxonomy";
import {
  appendRevision,
  attachSource,
  linkPages,
  upsertWikiPage,
  type WikiPagePrincipleInput,
  type WikiPageKind,
  type WikiPageStatus,
} from "./wiki-store";
import { applyWikiSlugMigrations } from "./wiki-slug-migrations";
import {
  parseFrontmatter as parseFrontmatterShared,
  extractWikilinks as extractWikilinksShared,
  type RawSourceFrontmatter as RawSourceFrontmatterShared,
  type WikiPageFrontmatter as WikiPageFrontmatterShared,
} from "./wiki-frontmatter";

// Re-export the shared frontmatter parser + types so existing imports of
// these symbols from `./seed-wiki-kernel` keep working. The canonical
// home is now `./wiki-frontmatter` (see Phase 2.1 — extracted so apps/web
// can pull the parser through @dpf/db without dragging in this module's
// `__dirname`-based KERNEL_DIR constant).
export const parseFrontmatter = parseFrontmatterShared;
export const extractWikilinks = extractWikilinksShared;
export type RawSourceFrontmatter = RawSourceFrontmatterShared;
export type WikiPageFrontmatter = WikiPageFrontmatterShared;

const KERNEL_DIR = join(__dirname, "..", "..", "..", "docs", "founder-kernel");

// ─── Manifest ───────────────────────────────────────────────────────────────

type Manifest = {
  kernelVersion: string;
  schemaVersion: string;
  pageCount: number;
  sourceCount: number;
  embeddingModel: string | null;
  builtAt: string | null;
  description?: string;
};

function readManifest(): Manifest {
  const path = join(KERNEL_DIR, "manifest.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as Manifest;
}

// ─── Frontmatter Parser ─────────────────────────────────────────────────────
// `parseFrontmatter` is now defined in `./wiki-frontmatter` and re-exported
// at the top of this file (for back-compat with imports of
// `./seed-wiki-kernel`). The shared module exists so apps/web can pull the
// parser through @dpf/db without dragging in this module's `__dirname`-
// based KERNEL_DIR constant.

// ─── Principle Payload Extractor ───────────────────────────────────────────

/**
 * Pull the principle-only fields out of a `WikiPageFrontmatter` and shape
 * them for `upsertWikiPage`'s `WikiPagePrincipleInput`.
 *
 * - Returns `{}` for non-principle pages so callers can spread the result
 *   unconditionally without leaking principle keys onto other kinds.
 * - Validates every key in `principleDimensionVector` and every entry in
 *   `principleDimensions` against the `PRINCIPLE_DIMENSIONS` registry.
 *   Throws with a clear message naming the offending key — per
 *   `feedback_check_tool_signals.md`, silent skip on bad frontmatter is
 *   the failure mode to avoid.
 * - Derives `principleDimensions` from `Object.keys(principleDimensionVector)`
 *   when the frontmatter omits it, so authors do not have to repeat the
 *   axis list in two places.
 * - Required-field gating (direction present for commandment/core, etc.)
 *   lives in lint detectors per spec section 14, not in this helper.
 */
export function extractPrinciplePayload(
  frontmatter: WikiPageFrontmatter,
): WikiPagePrincipleInput {
  if (frontmatter.pageKind !== "principle") {
    return {};
  }

  // Validate dimension vector keys against the registry.
  if (frontmatter.principleDimensionVector) {
    for (const dim of Object.keys(frontmatter.principleDimensionVector)) {
      if (!isPrincipleDimension(dim)) {
        throw new Error(
          `Unknown principle dimension "${dim}" in principleDimensionVector. ` +
            `Allowed dimensions: ${PRINCIPLE_DIMENSIONS.join(", ")}. ` +
            `Add the dimension to PRINCIPLE_DIMENSIONS in wiki-taxonomy.ts ` +
            `via a follow-up spec/PR before referencing it from frontmatter.`,
        );
      }
    }
  }

  // Validate explicit principleDimensions if supplied.
  if (frontmatter.principleDimensions) {
    for (const dim of frontmatter.principleDimensions) {
      if (!isPrincipleDimension(dim)) {
        throw new Error(
          `Unknown principle dimension "${dim}" in principleDimensions. ` +
            `Allowed dimensions: ${PRINCIPLE_DIMENSIONS.join(", ")}.`,
        );
      }
    }
  }

  // Validate consumer-archetype value against the registry.
  if (frontmatter.principleConsumerArchetype !== undefined) {
    if (!isPrincipleConsumerArchetype(frontmatter.principleConsumerArchetype)) {
      throw new Error(
        `Unknown principleConsumerArchetype "${frontmatter.principleConsumerArchetype}". ` +
          `Allowed archetypes: ${PRINCIPLE_CONSUMER_ARCHETYPES.join(", ")}. ` +
          `Add the archetype to PRINCIPLE_CONSUMER_ARCHETYPES in wiki-taxonomy.ts ` +
          `via a follow-up spec/PR before referencing it from frontmatter.`,
      );
    }
  }

  // Validate ring-scope values against the registry. Fail fast on unknown
  // values rather than silently dropping them — silent skip on bad
  // frontmatter is the failure mode `feedback_check_tool_signals.md` and
  // `make-silent-failures-observable` both forbid.
  if (frontmatter.principleRingScope) {
    for (const scope of frontmatter.principleRingScope) {
      if (!isPrincipleRingScope(scope)) {
        throw new Error(
          `Unknown principleRingScope value "${scope}". ` +
            `Allowed ring scopes: ${PRINCIPLE_RING_SCOPES.join(", ")}. ` +
            `Add the ring scope to PRINCIPLE_RING_SCOPES in wiki-taxonomy.ts ` +
            `via a follow-up spec/PR before referencing it from frontmatter.`,
        );
      }
    }
  }

  // Validate consumer-context slug shape (governed kebab-case slugs, not a
  // closed enum — new contexts ship via authoring without a schema change).
  if (frontmatter.principleConsumerContexts) {
    for (const slug of frontmatter.principleConsumerContexts) {
      if (!isPrincipleConsumerContextSlug(slug)) {
        throw new Error(
          `Malformed principleConsumerContexts slug "${slug}". ` +
            `Contexts must be lowercase kebab-case strings (alphanumeric and ` +
            `single hyphens; no leading/trailing hyphen, no double hyphens, ` +
            `no underscores, no whitespace).`,
        );
      }
    }
  }

  // route-domain-specific requires at least one consumer context per spec §8A.
  if (
    frontmatter.principleConsumerArchetype === "route-domain-specific" &&
    (!frontmatter.principleConsumerContexts ||
      frontmatter.principleConsumerContexts.length === 0)
  ) {
    throw new Error(
      `principleConsumerArchetype "route-domain-specific" requires at least ` +
        `one principleConsumerContexts entry (e.g., "build-studio"). ` +
        `If this principle truly applies everywhere, use "universal", ` +
        `"ai-coworker-universal", "generalist", or "specialist" instead.`,
    );
  }

  // Coherence matrix (spec §8A.1) — belt-and-suspenders alongside the
  // principle-incoherent-archetype-applies-to lint detector. Seed-time
  // rejection prevents an incoherent page from ever entering the DB.
  if (
    frontmatter.principleConsumerArchetype !== undefined &&
    frontmatter.principleAppliesTo !== undefined
  ) {
    const archetype = frontmatter.principleConsumerArchetype;
    const appliesTo = frontmatter.principleAppliesTo;
    const includesHuman = appliesTo.includes("human");

    if (
      includesHuman &&
      (archetype === "ai-coworker-universal" ||
        archetype === "generalist" ||
        archetype === "specialist")
    ) {
      throw new Error(
        `Coherence violation (spec §8A.1): principleConsumerArchetype ` +
          `"${archetype}" cannot include "human" in principleAppliesTo. ` +
          `These archetypes describe agent classes; humans should use ` +
          `"universal" (paired with another population) or ` +
          `"route-domain-specific" instead.`,
      );
    }

    if (archetype === "universal" && appliesTo.length < 2) {
      throw new Error(
        `Coherence violation (spec §8A.1): principleConsumerArchetype ` +
          `"universal" requires at least two principleAppliesTo populations. ` +
          `A principle that targets only one population is not universal — ` +
          `tighten the archetype to "ai-coworker-universal", "generalist", ` +
          `"specialist", or "route-domain-specific".`,
      );
    }
  }

  const dimensions =
    frontmatter.principleDimensions ??
    (frontmatter.principleDimensionVector
      ? Object.keys(frontmatter.principleDimensionVector)
      : undefined);

  const payload: WikiPagePrincipleInput = {};
  if (frontmatter.principleTier !== undefined) {
    payload.principleTier = frontmatter.principleTier as never;
  }
  if (frontmatter.principleDirection !== undefined) {
    payload.principleDirection = frontmatter.principleDirection;
  }
  if (frontmatter.principleWeight !== undefined) {
    payload.principleWeight = frontmatter.principleWeight;
  }
  if (frontmatter.principleWeightRationale !== undefined) {
    payload.principleWeightRationale = frontmatter.principleWeightRationale;
  }
  if (frontmatter.principleDimensionVector !== undefined) {
    payload.principleDimensionVector = frontmatter.principleDimensionVector;
  }
  if (dimensions !== undefined) {
    payload.principleDimensions = dimensions as never;
  }
  if (frontmatter.principleAppliesTo !== undefined) {
    payload.principleAppliesTo = frontmatter.principleAppliesTo as never;
  }
  if (frontmatter.principleRingScope !== undefined) {
    payload.principleRingScope = frontmatter.principleRingScope as never;
  }
  if (frontmatter.principleConsumerArchetype !== undefined) {
    payload.principleConsumerArchetype =
      frontmatter.principleConsumerArchetype as never;
  }
  if (frontmatter.principleConsumerContexts !== undefined) {
    payload.principleConsumerContexts =
      frontmatter.principleConsumerContexts as never;
  }
  if (frontmatter.principlePublic !== undefined) {
    payload.principlePublic = frontmatter.principlePublic;
  }
  if (frontmatter.principlePublicRationale !== undefined) {
    payload.principlePublicRationale = frontmatter.principlePublicRationale;
  }
  if (frontmatter.principleRuntimeEnforcement !== undefined) {
    payload.principleRuntimeEnforcement = frontmatter.principleRuntimeEnforcement;
  }
  return payload;
}

// ─── Wikilink Extractor ─────────────────────────────────────────────────────
// `extractWikilinks` lives in `./wiki-frontmatter` alongside the parser
// and is re-exported at the top of this file.

// ─── Filesystem Walk ────────────────────────────────────────────────────────

function walkMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkMarkdownFiles(full));
    } else if (st.isFile() && entry.endsWith(".md") && !entry.startsWith("README")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Derive a slug from a kernel markdown path.
 * - `docs/founder-kernel/wiki/entities/digital-product.md`
 *   → `entities/digital-product`
 * - `docs/founder-kernel/raw-sources/papers/it4it-overview.md`
 *   → `papers/it4it-overview`
 *
 * The `wiki/` and `raw-sources/` prefixes are stripped because the slug
 * is namespaced by what kind of folder it lives in (subfolder name).
 */
export function deriveSlug(absolutePath: string, baseDir: string): string {
  const rel = absolutePath.startsWith(baseDir)
    ? absolutePath.slice(baseDir.length).replace(/^[/\\]+/, "")
    : absolutePath;
  // Normalise Windows backslashes to forward slashes so slugs are
  // consistent across platforms and the upsert key never duplicates.
  return rel.replace(/\\/g, "/").replace(/\.md$/, "");
}

// ─── Seed: Raw Sources ──────────────────────────────────────────────────────

async function seedRawSources(
  prisma: PrismaClient,
  kernelVersion: string,
): Promise<{ count: number; slugToId: Map<string, string> }> {
  const sourcesDir = join(KERNEL_DIR, "raw-sources");
  const files = walkMarkdownFiles(sourcesDir);
  const slugToId = new Map<string, string>();

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const { frontmatter, body } = parseFrontmatter<RawSourceFrontmatter>(raw);
    const sourceKey = frontmatter.sourceKey ?? deriveSlug(file, sourcesDir);
    if (!frontmatter.sourceType || !frontmatter.title) {
      throw new Error(
        `seed-wiki-kernel: ${file} is missing required frontmatter (sourceType + title).`,
      );
    }
    const sourceType = frontmatter.sourceType;
    const title = frontmatter.title;

    const upserted = (await prisma.rawSource.upsert({
      where: { sourceKey },
      create: {
        sourceKey,
        sourceType,
        title,
        authors: frontmatter.authors ?? [],
        publishedAt: frontmatter.publishedAt ? new Date(frontmatter.publishedAt) : null,
        url: frontmatter.url ?? null,
        doi: frontmatter.doi ?? null,
        license: frontmatter.license ?? null,
        abstract: frontmatter.abstract ?? null,
        excerpt: body || null,
        isKernel: true,
        // Kernel sources have no organizationId.
      },
      update: {
        sourceType,
        title,
        authors: frontmatter.authors ?? [],
        publishedAt: frontmatter.publishedAt ? new Date(frontmatter.publishedAt) : null,
        url: frontmatter.url ?? null,
        doi: frontmatter.doi ?? null,
        license: frontmatter.license ?? null,
        abstract: frontmatter.abstract ?? null,
        excerpt: body || null,
      },
    })) as { id: string };

    slugToId.set(sourceKey, upserted.id);
  }

  void kernelVersion; // currently unused; placeholder for future per-version source pinning.
  return { count: files.length, slugToId };
}

// ─── Seed: Wiki Pages ───────────────────────────────────────────────────────

async function seedWikiPages(
  prisma: PrismaClient,
  kernelVersion: string,
  sourceSlugToId: Map<string, string>,
): Promise<{
  count: number;
  slugToId: Map<string, string>;
  orphanLinks: Array<{ from: string; to: string }>;
  /** Per-page metadata needed to build Qdrant payloads in `seedWikiQdrant`. */
  pages: SeedablePage[];
}> {
  const wikiDir = join(KERNEL_DIR, "wiki");
  const files = walkMarkdownFiles(wikiDir);
  const slugToId = new Map<string, string>();
  const bodies = new Map<string, string>();
  const pages: SeedablePage[] = [];

  // Pass 1: upsert pages and append revisions.
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    const slug = frontmatter.slug ?? deriveSlug(file, wikiDir);
    const status = frontmatter.status ?? "published";

    const principlePayload = extractPrinciplePayload(frontmatter);

    const upserted = (await upsertWikiPage(prisma, {
      slug,
      title: frontmatter.title,
      body,
      pageKind: frontmatter.pageKind,
      status,
      isKernel: true,
      kernelVersion,
      abstract: frontmatter.abstract ?? null,
      ...principlePayload,
    })) as { id: string };

    slugToId.set(slug, upserted.id);
    bodies.set(slug, body);
    pages.push({
      id: upserted.id,
      slug,
      title: frontmatter.title,
      body,
      pageKind: frontmatter.pageKind,
      status,
      // Thread principle metadata into the Qdrant payload (BI-30AA6B76).
      principleTier: principlePayload.principleTier ?? null,
      principleAppliesTo: principlePayload.principleAppliesTo,
      principleRingScope: principlePayload.principleRingScope,
      principleDimensions: principlePayload.principleDimensions,
      principlePublic: principlePayload.principlePublic ?? undefined,
    });

    // Append a revision tagged kernel-merge if the body changed since
    // the last revision; otherwise no-op.
    const latest = (await prisma.wikiPageRevision.findFirst({
      where: { pageId: upserted.id },
      orderBy: { version: "desc" },
      select: { body: true },
    })) as { body: string } | null;

    if (!latest || latest.body !== body) {
      await appendRevision(prisma, {
        pageId: upserted.id,
        title: frontmatter.title,
        body,
        changeKind: "kernel-merge",
        changeSummary: latest ? `Kernel update to v${kernelVersion}` : `Initial kernel seed v${kernelVersion}`,
      });
    }

    // Attach source citations from frontmatter.
    for (const sourceSlug of frontmatter.sources ?? []) {
      const sourceId = sourceSlugToId.get(sourceSlug);
      if (!sourceId) {
        console.warn(`[seed-wiki-kernel] page ${slug} cites unknown source ${sourceSlug}`);
        continue;
      }
      await attachSource(prisma, { pageId: upserted.id, sourceId });
    }
  }

  // Pass 2: extract [[wikilinks]] from each body and create edges.
  const orphanLinks: Array<{ from: string; to: string }> = [];
  for (const [fromSlug, body] of bodies.entries()) {
    const fromId = slugToId.get(fromSlug);
    if (!fromId) continue;
    for (const toSlug of extractWikilinks(body)) {
      const toId = slugToId.get(toSlug);
      if (!toId) {
        orphanLinks.push({ from: fromSlug, to: toSlug });
        continue;
      }
      await linkPages(prisma, { fromPageId: fromId, toPageId: toId });
    }
  }

  return { count: files.length, slugToId, orphanLinks, pages };
}

// ─── Seed: Qdrant points from the precomputed embeddings sidecar ────────────

/**
 * Read `docs/founder-kernel/embeddings.jsonl` (if present) and upsert
 * the corresponding points into the `wiki-pages` Qdrant collection.
 *
 * Per EP-WIKI-001 §5: installs whose configured embedding model matches
 * the manifest skip live embedding entirely — the sidecar is the
 * canonical path. Live embedding for the kernel happens via Phase 2b
 * ingest only when the sidecar is missing or stale (handled elsewhere).
 *
 * Payload shape mirrors `apps/web/lib/wiki/embeddings.ts:storeWikiPage`
 * so `searchWikiPages` finds the seeded points without surprises.
 *
 * Silent-degradation: if Qdrant is unreachable or the upsert throws,
 * the seed completes successfully (Postgres rows are still there) but
 * `qdrantPointsSeeded` is `0` and a warning is logged. Wiki retrieval
 * will degrade gracefully until Qdrant is back.
 */
export type SeedablePage = {
  id: string;
  slug: string;
  title: string;
  body: string;
  pageKind: string;
  status: string;
  // Principle payload fields, threaded from `extractPrinciplePayload` so
  // `buildKernelQdrantPoints` writes the SAME Qdrant payload as the runtime
  // `storeWikiPage` (apps/web/lib/wiki/embeddings.ts). Without these,
  // principle-filtered retrieval (principle_decide, wiki_query
  // tier/appliesTo/ringScope) cannot find sidecar-seeded principle pages —
  // BI-30AA6B76. Only meaningful when pageKind === "principle".
  principleTier?: string | null;
  principleAppliesTo?: string[];
  principleRingScope?: string[];
  principleDimensions?: string[];
  principlePublic?: boolean;
};

/**
 * Build Qdrant `VectorPoint` objects from kernel pages + sidecar records.
 * Pure — no I/O. Exported for testing; production code goes through
 * `seedWikiQdrant`.
 *
 * Payload shape mirrors `apps/web/lib/wiki/embeddings.ts:storeWikiPage`
 * so `searchWikiPages` finds the seeded points without surprises. Slugs
 * in the sidecar with no matching page are skipped (warning logged).
 */
export function buildKernelQdrantPoints(
  pages: SeedablePage[],
  records: EmbeddingRecord[],
  kernelVersion: string,
  now: Date = new Date(),
): VectorPoint[] {
  const pageBySlug = new Map(pages.map((p) => [p.slug, p]));
  const out: VectorPoint[] = [];
  const timestamp = now.toISOString();
  for (const rec of records) {
    const page = pageBySlug.get(rec.slug);
    if (!page) {
      console.warn(`[seed-wiki-kernel] sidecar contains slug "${rec.slug}" with no matching wiki page; skipping`);
      continue;
    }
    const payload: Record<string, unknown> = {
      entityType: "wiki-page",
      entityId: page.id,
      slug: page.slug,
      title: page.title,
      contentPreview: page.body.slice(0, 500),
      pageKind: page.pageKind,
      status: page.status,
      isKernel: true,
      // Kernel rows have organizationId = null.
      organizationId: null,
      kernelVersion,
      kernelPageId: null,
      timestamp,
    };
    // Principle-only payload keys — mirror storeWikiPage() so principle
    // retrieval filters (tier/appliesTo/ringScope) match sidecar-seeded
    // principle pages. Absence is the marker; never write null/empty for
    // non-principle pages (BI-30AA6B76).
    if (page.pageKind === "principle") {
      if (page.principleTier != null) payload.principleTier = page.principleTier;
      if (page.principleAppliesTo !== undefined) payload.principleAppliesTo = page.principleAppliesTo;
      if (page.principleRingScope !== undefined) payload.principleRingScope = page.principleRingScope;
      if (page.principleDimensions !== undefined) payload.principleDimensions = page.principleDimensions;
      if (page.principlePublic !== undefined) payload.principlePublic = page.principlePublic;
    }
    out.push({ id: `wiki-page-${page.id}`, vector: rec.vector, payload });
  }
  return out;
}

/**
 * Read `docs/founder-kernel/embeddings.jsonl` (if present) and upsert
 * the corresponding points into the `wiki-pages` Qdrant collection.
 *
 * Per EP-WIKI-001 §5: installs whose configured embedding model matches
 * the manifest skip live embedding entirely — the sidecar is the
 * canonical path. Live embedding for the kernel happens via Phase 2b
 * ingest only when the sidecar is missing or stale (handled elsewhere).
 *
 * Silent-degradation: if Qdrant is unreachable or the upsert throws,
 * the seed completes successfully (Postgres rows are still there) but
 * `qdrantPointsSeeded` is `0` and a warning is logged. Wiki retrieval
 * will degrade gracefully until Qdrant is back.
 */
async function seedWikiQdrant(
  pages: SeedablePage[],
  kernelVersion: string,
): Promise<{ pointsSeeded: number; sidecarPresent: boolean }> {
  const records = readEmbeddingsSidecar();
  if (records === null) {
    return { pointsSeeded: 0, sidecarPresent: false };
  }

  const vectorPoints = buildKernelQdrantPoints(pages, records, kernelVersion);
  if (vectorPoints.length === 0) {
    return { pointsSeeded: 0, sidecarPresent: true };
  }

  try {
    await upsertVectors(QDRANT_COLLECTIONS.WIKI_PAGES, vectorPoints);
    return { pointsSeeded: vectorPoints.length, sidecarPresent: true };
  } catch (err) {
    console.warn("[seed-wiki-kernel] failed to upsert wiki points into Qdrant; pages remain in Postgres:", err);
    return { pointsSeeded: 0, sidecarPresent: true };
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export type SeedWikiKernelResult = {
  kernelVersion: string;
  sourceCount: number;
  pageCount: number;
  orphanLinks: Array<{ from: string; to: string }>;
  /** When true, kernel content directories are missing and nothing was seeded. */
  emptyKernel: boolean;
  /**
   * Number of points upserted into the `wiki-pages` Qdrant collection
   * from the precomputed `docs/founder-kernel/embeddings.jsonl` sidecar.
   * Zero when the sidecar is missing (seed completes; live embedding
   * happens via Phase 2b ingest) or when Qdrant is unreachable.
   */
  qdrantPointsSeeded: number;
  /** Whether the embeddings.jsonl sidecar exists. */
  embeddingsSidecarPresent: boolean;
};

/**
 * Seed the founder kernel from `docs/founder-kernel/`.
 *
 * Idempotent — re-running advances the revision chain only when body
 * content has changed; never duplicates RawSource rows, page rows,
 * link edges, or source citations.
 *
 * If the `wiki/` and `raw-sources/` directories don't exist yet
 * (Phase 5 not done), returns `{ emptyKernel: true }` without error.
 */
export async function seedWikiKernel(prisma: PrismaClient): Promise<SeedWikiKernelResult> {
  // Probe the kernel directory BEFORE calling readManifest(). If the
  // founder-kernel content isn't present in the image at all (e.g. the
  // Dockerfile is missing `COPY docs/founder-kernel/`), readManifest()
  // would throw ENOENT and the docker-entrypoint's
  // `|| echo "WARN Seed had warnings"` would swallow the failure — the
  // operator then sees a non-fatal warning and a permanently empty
  // /wiki page. Surfacing this as a typed, actionable warning makes the
  // packaging gap visible the moment it happens.
  if (!existsSync(KERNEL_DIR)) {
    console.warn(
      `[seedWikiKernel] founder-kernel directory not present at ${KERNEL_DIR}. ` +
        `The container image is missing 'COPY docs/founder-kernel/' — wiki pages will be empty until the image is rebuilt with that COPY. ` +
        `Returning an empty-kernel result; no rows seeded.`,
    );
    return {
      kernelVersion: "0.0.0",
      sourceCount: 0,
      pageCount: 0,
      orphanLinks: [],
      emptyKernel: true,
      qdrantPointsSeeded: 0,
      embeddingsSidecarPresent: false,
    };
  }

  const manifest = readManifest();
  const sourcesDir = join(KERNEL_DIR, "raw-sources");
  const wikiDir = join(KERNEL_DIR, "wiki");

  if (!existsSync(sourcesDir) && !existsSync(wikiDir)) {
    return {
      kernelVersion: manifest.kernelVersion,
      sourceCount: 0,
      pageCount: 0,
      orphanLinks: [],
      emptyKernel: true,
      qdrantPointsSeeded: 0,
      embeddingsSidecarPresent: false,
    };
  }

  // BI-5FE47130 — rename migrated slugs BEFORE the upsert pass.
  //
  // A principle moving from the kernel to a profession corpus changes its slug
  // (`principles/x` -> `professions/<p>/x`). upsertWikiPage keys on
  // (organizationId, slug), so without this the seed would find no row for the
  // new slug, create a fresh one, and strand the original — losing the page's
  // version history and decision references, and leaving a stale Qdrant point.
  // Renaming first means the existing row is simply found under its new key and
  // updated in place, id intact.
  await applyWikiSlugMigrations(prisma as never);

  const sources = await seedRawSources(prisma, manifest.kernelVersion);
  const pages = await seedWikiPages(prisma, manifest.kernelVersion, sources.slugToId);
  const qdrant = await seedWikiQdrant(pages.pages, manifest.kernelVersion);

  return {
    kernelVersion: manifest.kernelVersion,
    sourceCount: sources.count,
    pageCount: pages.count,
    orphanLinks: pages.orphanLinks,
    emptyKernel: false,
    qdrantPointsSeeded: qdrant.pointsSeeded,
    embeddingsSidecarPresent: qdrant.sidecarPresent,
  };
}

// ─── Embeddings Sidecar ─────────────────────────────────────────────────────

export type EmbeddingRecord = {
  /** wiki page slug, e.g. "entities/digital-product" */
  slug: string;
  /** the embedding vector (768 dims for nomic-embed-text) */
  vector: number[];
  /** model identifier, e.g. "ai/nomic-embed-text-v1.5" */
  model: string;
};

/**
 * Read the precomputed embeddings sidecar, if present. Each line is
 * a JSON-encoded `EmbeddingRecord`. Returns null if the file is
 * missing — caller decides whether to live-embed.
 */
export function readEmbeddingsSidecar(): EmbeddingRecord[] | null {
  const path = join(KERNEL_DIR, "embeddings.jsonl");
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((l) => JSON.parse(l) as EmbeddingRecord);
}

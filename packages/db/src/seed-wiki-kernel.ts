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
  appendRevision,
  attachSource,
  linkPages,
  upsertWikiPage,
  type WikiPageKind,
  type WikiPageStatus,
} from "./wiki-store";

const KERNEL_DIR = join(__dirname, "..", "..", "..", "docs", "founder-kernel");

// ─── Frontmatter Types ──────────────────────────────────────────────────────

export type RawSourceFrontmatter = {
  sourceKey?: string;
  sourceType: string;
  title: string;
  authors?: string[];
  publishedAt?: string;
  url?: string;
  doi?: string;
  license?: string;
  abstract?: string;
};

export type WikiPageFrontmatter = {
  slug?: string;
  title: string;
  pageKind: WikiPageKind;
  status?: WikiPageStatus;
  abstract?: string;
  /** Source slugs (relative to raw-sources/) that this page cites. */
  sources?: string[];
};

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

/**
 * Subset YAML parser — same shape as seed-skills.ts and
 * seed-prompt-templates.ts. Handles scalars, inline arrays, and
 * block-style lists. Does not handle nested objects.
 */
export function parseFrontmatter<T extends Record<string, unknown>>(
  raw: string,
): { frontmatter: T; body: string } {
  const normalised = raw.replace(/\r\n/g, "\n");
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Missing YAML frontmatter delimiters (---)");
  }

  const yamlBlock = match[1];
  const body = match[2].trim();

  const fm: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("#") || line.trim() === "") {
      i++;
      continue;
    }

    const kvMatch = line.match(/^(\w[\w.-]*)\s*:\s*(.*)/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    // Block-style list:
    //   key:
    //     - item1
    //     - item2
    if (value === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const itemMatch = next.match(/^\s+-\s+(.*)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
        j++;
      }
      if (items.length > 0) {
        fm[key] = items;
        i = j;
        continue;
      }
    }

    // Inline array: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      fm[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);
      i++;
      continue;
    }

    // Scalar (with optional surrounding quotes)
    fm[key] = value.replace(/^["']|["']$/g, "");
    i++;
  }

  return { frontmatter: fm as T, body };
}

// ─── Wikilink Extractor ─────────────────────────────────────────────────────

/**
 * Extract all [[slug]] tokens from a body. Returns deduped slugs.
 * Allowed slug characters: letters, digits, slashes, hyphens, underscores.
 */
export function extractWikilinks(body: string): string[] {
  const matches = body.matchAll(/\[\[([a-zA-Z0-9/_-]+)\]\]/g);
  const slugs = new Set<string>();
  for (const m of matches) {
    if (m[1]) slugs.add(m[1]);
  }
  return Array.from(slugs);
}

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
    ? absolutePath.slice(baseDir.length).replace(/^\/+/, "")
    : absolutePath;
  return rel.replace(/\.md$/, "");
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

    const upserted = (await prisma.rawSource.upsert({
      where: { sourceKey },
      create: {
        sourceKey,
        sourceType: frontmatter.sourceType,
        title: frontmatter.title,
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
        sourceType: frontmatter.sourceType,
        title: frontmatter.title,
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
  pages: Array<{
    id: string;
    slug: string;
    title: string;
    body: string;
    pageKind: string;
    status: string;
  }>;
}> {
  const wikiDir = join(KERNEL_DIR, "wiki");
  const files = walkMarkdownFiles(wikiDir);
  const slugToId = new Map<string, string>();
  const bodies = new Map<string, string>();
  const pages: Array<{
    id: string;
    slug: string;
    title: string;
    body: string;
    pageKind: string;
    status: string;
  }> = [];

  // Pass 1: upsert pages and append revisions.
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    const slug = frontmatter.slug ?? deriveSlug(file, wikiDir);
    const status = frontmatter.status ?? "published";

    const upserted = (await upsertWikiPage(prisma, {
      slug,
      title: frontmatter.title,
      body,
      pageKind: frontmatter.pageKind,
      status,
      isKernel: true,
      kernelVersion,
      abstract: frontmatter.abstract ?? null,
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
    out.push({
      id: `wiki-page-${page.id}`,
      vector: rec.vector,
      payload: {
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
      },
    });
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

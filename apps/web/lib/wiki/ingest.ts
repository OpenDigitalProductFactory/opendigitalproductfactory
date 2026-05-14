// EP-WIKI-001 Phase 2.1: file-source ingest orchestrator.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 2.1)
//
// This module is the source-layer floor of the ingest pipeline. It reads a
// raw source from disk, parses the optional founder-kernel frontmatter
// shape, upserts the `RawSource` row, and writes the `WikiIngestEvent`
// audit. It does NOT touch any wiki page or call an LLM — that's Phase 2.2
// (`proposeWikiDiff`) and 2.3 (`commitIngestProposal`).
//
// Splitting the source layer out lets operators pull a source into the
// kernel as a citable receipt before any LLM ever sees it, which matches
// how Mark drafted the v0.2.0 kernel content (raw-source pages first,
// wiki pages second).

import { readFileSync } from "node:fs";
import { basename, extname, sep } from "node:path";
// Import via subpaths rather than the bare `@dpf/db` barrel: the apps/web
// vitest config aliases the bare specifier to `client.ts` (Prisma client
// only) so tests can mock the barrel cleanly. Subpath specifiers resolve
// to the actual modules in both the test and the production builds.
import {
  isRawSourceType,
  recordIngestEvent,
  upsertRawSource,
  type RawSourceType,
  type WikiStoreClient,
} from "@dpf/db/wiki-store";
import {
  parseFrontmatter,
  type RawSourceFrontmatter,
} from "@dpf/db/wiki-frontmatter";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Subset of `WikiStoreClient` this orchestrator needs. */
type IngestClient = Pick<WikiStoreClient, "rawSource" | "wikiIngestEvent">;

export type IngestRawSourceFromFileInput = {
  /** Absolute or process-relative path to a markdown source file on disk. */
  filePath: string;
  /**
   * Override the derived sourceKey. Default: the path's last two segments
   * minus extension, e.g. `articles/sibling-portfolios.md` →
   * `articles/sibling-portfolios`. Required when the file does not live
   * under a directory that names a source type.
   */
  sourceKey?: string;
  /**
   * Override the derived sourceType. Default: the parent directory name,
   * singularised — `articles/foo.md` → `article`, `papers/bar.md` →
   * `paper`. Required when the parent directory name does not map to a
   * known `RawSourceType`.
   */
  sourceType?: RawSourceType;
  /** Org-scoped ingests pass an organizationId; kernel ingests omit it. */
  organizationId?: string | null;
  /** Mark the row as kernel content (defaults to false unless caller opts in). */
  isKernel?: boolean;
  /** Attribution for the audit row. */
  agentId?: string | null;
  userId?: string | null;
  /** Active kernel version — passed through to the audit row. */
  kernelVersion?: string | null;
};

export type IngestRawSourceResult = {
  rawSourceId: string;
  sourceKey: string;
  sourceType: RawSourceType;
  /** True when the row was inserted; false when an existing row was updated. */
  isNew: boolean;
  /** Audit event id created for this ingest. */
  eventId: string;
};

// ─── Path → source key / type derivation ────────────────────────────────────

/**
 * Turn a filesystem path into a stable `sourceKey`. Mirrors the seed walker's
 * derivation: the last two path segments, with the file extension stripped.
 *
 *   /repo/docs/founder-kernel/raw-sources/articles/foo.md → articles/foo
 *   /tmp/papers/bar.markdown                              → papers/bar
 *
 * Falls back to the basename when the path has no parent directory the
 * caller controls.
 */
export function deriveSourceKeyFromPath(filePath: string): string {
  const segments = filePath.split(sep).filter(Boolean);
  const file = segments.at(-1) ?? filePath;
  const parent = segments.at(-2);
  const stem = basename(file, extname(file));
  if (!parent) return stem;
  return `${parent}/${stem}`;
}

/**
 * Map a parent directory name to a `RawSourceType`. The founder-kernel layout
 * uses plurals (`papers/`, `articles/`, `specs/`, `frameworks/`), so we strip
 * the trailing "s" before checking the registry. Returns null when the name
 * is not recognisable — the caller must supply `sourceType` explicitly.
 */
export function deriveSourceTypeFromPath(filePath: string): RawSourceType | null {
  const segments = filePath.split(sep).filter(Boolean);
  const parent = segments.at(-2);
  if (!parent) return null;
  const singular = parent.endsWith("s") ? parent.slice(0, -1) : parent;
  return isRawSourceType(singular) ? singular : null;
}

// ─── Frontmatter helpers ────────────────────────────────────────────────────

/**
 * Read a markdown file and parse its frontmatter when present. Files without
 * a `---` delimiter fall through with empty frontmatter and the entire file
 * body — the caller still gets a citable raw source, it just has no metadata.
 */
function readSourceFile(filePath: string): {
  frontmatter: Partial<RawSourceFrontmatter>;
  body: string;
} {
  const raw = readFileSync(filePath, "utf8");
  if (!raw.trimStart().startsWith("---")) {
    return { frontmatter: {}, body: raw };
  }
  try {
    const { frontmatter, body } = parseFrontmatter<RawSourceFrontmatter>(raw);
    return { frontmatter, body };
  } catch {
    return { frontmatter: {}, body: raw };
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Read a raw-source file from disk, upsert the `RawSource` row, and append
 * a `WikiIngestEvent` audit row. Idempotent on re-run — the same file
 * ingested twice produces one row and two audit events.
 *
 * Phase 2.1 stays narrow on purpose: it does not call any LLM, does not
 * touch any wiki page, does not write to Qdrant. The returned event row
 * carries `touchedPageIds: []` until Phase 2.2/2.3 wires the proposal
 * pipeline through.
 */
export async function ingestRawSourceFromFile(
  db: IngestClient,
  input: IngestRawSourceFromFileInput,
): Promise<IngestRawSourceResult> {
  const { frontmatter, body } = readSourceFile(input.filePath);

  const sourceKey =
    input.sourceKey ??
    frontmatter.sourceKey ??
    deriveSourceKeyFromPath(input.filePath);

  const sourceType =
    input.sourceType ??
    (isRawSourceType(frontmatter.sourceType) ? frontmatter.sourceType : null) ??
    deriveSourceTypeFromPath(input.filePath);
  if (!sourceType) {
    throw new Error(
      `ingestRawSourceFromFile: could not derive sourceType for ${input.filePath}. ` +
        `Pass sourceType explicitly or place the file under one of: papers/, articles/, specs/, frameworks/, docs/, external-urls/.`,
    );
  }

  const title = frontmatter.title?.trim();
  if (!title) {
    throw new Error(
      `ingestRawSourceFromFile: ${input.filePath} has no \`title\` in frontmatter; pass it via frontmatter or rerun with a file that has one.`,
    );
  }

  const retrievedAt = new Date();
  const row = (await upsertRawSource(db, {
    sourceKey,
    sourceType,
    title,
    authors: frontmatter.authors,
    publishedAt: parseDate(frontmatter.publishedAt),
    url: frontmatter.url ?? null,
    doi: frontmatter.doi ?? null,
    abstract: frontmatter.abstract ?? null,
    excerpt: body.trim().length > 0 ? body : null,
    license: frontmatter.license ?? null,
    retrievedAt,
    organizationId: input.organizationId ?? null,
    isKernel: input.isKernel ?? false,
  })) as { id: string; createdAt: Date; updatedAt: Date };

  const isNew =
    row.createdAt instanceof Date && row.updatedAt instanceof Date
      ? row.createdAt.getTime() === row.updatedAt.getTime()
      : false;

  const event = (await recordIngestEvent(db, {
    sourceId: row.id,
    organizationId: input.organizationId ?? null,
    touchedPageIds: [],
    agentId: input.agentId ?? null,
    userId: input.userId ?? null,
    kernelVersion: input.kernelVersion ?? null,
  })) as { id: string };

  return {
    rawSourceId: row.id,
    sourceKey,
    sourceType,
    isNew,
    eventId: event.id,
  };
}

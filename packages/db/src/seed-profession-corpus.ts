// packages/db/src/seed-profession-corpus.ts
// WSID Phase 2 (BI-871126F9): seed profession corpus wiki pages from
// docs/professions/*/wiki/. Generalises seed-wiki-kernel.ts machinery
// for open-license external sources (no kernel manifest; no Qdrant sidecar
// in Phase 2 — Qdrant seeding is a Phase 3+ extension).
//
// Idempotent: re-running advances the revision chain only when body
// content has changed; never duplicates RawSource rows, page rows,
// link edges, or source citations.

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { PrismaClient } from "../generated/client/client";
import { deriveSlug, extractPrinciplePayload, parseFrontmatter } from "./seed-wiki-kernel";
import { appendRevision, attachSource, linkPages, upsertWikiPage } from "./wiki-store";
import { extractWikilinks } from "./wiki-frontmatter";
import type { WikiPageFrontmatter } from "./wiki-frontmatter";

const PROFESSIONS_DIR = join(__dirname, "..", "..", "..", "docs", "professions");

// ─── External source registry (open-license BoKs only) ─────────────────────
//
// Licensed BoKs (DMBOK2, ISO SQL) remain checklist-only per spec §7.7
// (conduit rule): DPF never enrolls as a licensee. Add them here only
// after the org-supplied upload path (Phase 5) is in place.

type ExternalSourceEntry = {
  sourceType: string;
  title: string;
  url: string;
  license: string;
  abstract?: string;
  retrievedAt: string;
};

const PROFESSION_EXTERNAL_SOURCES: Record<string, ExternalSourceEntry> = {
  "owasp/sql-injection-prevention": {
    sourceType: "web-article",
    title: "OWASP SQL Injection Prevention Cheat Sheet",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
    license: "CC-BY-4.0",
    abstract:
      "Comprehensive guide to preventing SQL injection via parameterized queries, " +
      "safe APIs, allow-list validation, and least-privilege database access.",
    retrievedAt: "2026-06-10",
  },
  "owasp/query-parameterization": {
    sourceType: "web-article",
    title: "OWASP Query Parameterization Cheat Sheet",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html",
    license: "CC-BY-4.0",
    abstract:
      "OWASP guide to query parameterization using prepared statements in multiple " +
      "languages, preventing SQL Injection (OWASP Top 10 A03:2021).",
    retrievedAt: "2026-06-10",
  },
  "owasp/top10-a03-injection": {
    sourceType: "web-article",
    title: "OWASP Top 10 A03:2021 — Injection",
    url: "https://owasp.org/Top10/A03_2021-Injection/",
    license: "CC-BY-4.0",
    abstract:
      "OWASP Top 10 entry for injection vulnerabilities. Covers SQL injection, " +
      "NoSQL injection, OS command injection, and prevention strategies.",
    retrievedAt: "2026-06-10",
  },
};

// ─── Source seeding ──────────────────────────────────────────────────────────

async function seedProfessionExternalSources(
  prisma: PrismaClient,
): Promise<{ count: number; sourceKeyToId: Map<string, string> }> {
  const sourceKeyToId = new Map<string, string>();
  let count = 0;

  for (const [sourceKey, meta] of Object.entries(PROFESSION_EXTERNAL_SOURCES)) {
    const upserted = (await prisma.rawSource.upsert({
      where: { sourceKey },
      create: {
        sourceKey,
        sourceType: meta.sourceType,
        title: meta.title,
        url: meta.url,
        license: meta.license,
        abstract: meta.abstract ?? null,
        retrievedAt: new Date(meta.retrievedAt),
        isKernel: false,
      },
      update: {
        sourceType: meta.sourceType,
        title: meta.title,
        url: meta.url,
        license: meta.license,
        abstract: meta.abstract ?? null,
        retrievedAt: new Date(meta.retrievedAt),
      },
    })) as { id: string };

    sourceKeyToId.set(sourceKey, upserted.id);
    count++;
  }

  return { count, sourceKeyToId };
}

// ─── Filesystem helpers ──────────────────────────────────────────────────────

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
 * Derive a wiki slug for a profession corpus page.
 *   docs/professions/data-architect/wiki/parameterized-queries-commandment.md
 *   -> professions/data-architect/parameterized-queries-commandment
 *
 * Strips the `wiki/` path segment and prefixes with `professions/` so
 * profession corpus pages are distinguishable from kernel pages by
 * their slug prefix, which the `detectUnsourcedProfessionPages` lint
 * detector uses as its identification mechanism.
 */
function deriveCorpusSlug(absolutePath: string): string {
  const rel = deriveSlug(absolutePath, PROFESSIONS_DIR);
  // rel = "data-architect/wiki/parameterized-queries-commandment"
  // Strip the wiki/ path segment: "data-architect/parameterized-queries-commandment"
  const stripped = rel.replace(/^([^/]+)\/wiki\//, "$1/");
  return `professions/${stripped}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type SeedProfessionCorpusResult = {
  sourceCount: number;
  pageCount: number;
  orphanLinks: Array<{ from: string; to: string }>;
  emptyCorpus: boolean;
};

/**
 * Seed profession corpus wiki pages from the docs/professions directory.
 *
 * Idempotent - re-running advances the revision chain only when body
 * content has changed; never duplicates RawSource rows, WikiPage rows,
 * link edges, or source citations.
 *
 * If docs/professions/ is absent or contains no wiki pages under any
 * profession-family subdirectory, returns { emptyCorpus: true } without error.
 */
export async function seedProfessionCorpus(
  prisma: PrismaClient,
): Promise<SeedProfessionCorpusResult> {
  if (!existsSync(PROFESSIONS_DIR)) {
    console.warn(
      `[seedProfessionCorpus] docs/professions/ not found at ${PROFESSIONS_DIR}. ` +
        `No corpus seeded.`,
    );
    return { sourceCount: 0, pageCount: 0, orphanLinks: [], emptyCorpus: true };
  }

  const { count: sourceCount, sourceKeyToId } = await seedProfessionExternalSources(prisma);

  // Collect all wiki/*.md files under docs/professions/*/wiki/
  const wikiFiles: string[] = [];
  for (const entry of readdirSync(PROFESSIONS_DIR)) {
    const familyDir = join(PROFESSIONS_DIR, entry);
    if (!statSync(familyDir).isDirectory()) continue; // skip registry.json etc.
    wikiFiles.push(...walkMarkdownFiles(join(familyDir, "wiki")));
  }

  if (wikiFiles.length === 0) {
    return { sourceCount, pageCount: 0, orphanLinks: [], emptyCorpus: true };
  }

  const slugToId = new Map<string, string>();
  const bodies = new Map<string, string>();

  // Pass 1: upsert wiki pages and append revisions.
  for (const file of wikiFiles) {
    const raw = readFileSync(file, "utf8");
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    const slug = deriveCorpusSlug(file);
    const status = frontmatter.status ?? "published";

    const principlePayload = extractPrinciplePayload(frontmatter);

    const upserted = (await upsertWikiPage(prisma, {
      slug,
      title: frontmatter.title,
      body,
      pageKind: frontmatter.pageKind,
      status,
      isKernel: false,
      kernelVersion: null,
      abstract: frontmatter.abstract ?? null,
      ...principlePayload,
    })) as { id: string };

    slugToId.set(slug, upserted.id);
    bodies.set(slug, body);

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
        changeSummary: latest
          ? "Profession corpus content update"
          : "Initial profession corpus seed (WSID Phase 2, BI-871126F9)",
      });
    }

    for (const sourceKey of frontmatter.sources ?? []) {
      const sourceId = sourceKeyToId.get(sourceKey);
      if (!sourceId) {
        console.warn(
          `[seedProfessionCorpus] page ${slug} cites unknown source "${sourceKey}"; ` +
            `add it to PROFESSION_EXTERNAL_SOURCES in seed-profession-corpus.ts`,
        );
        continue;
      }
      await attachSource(prisma, { pageId: upserted.id, sourceId });
    }
  }

  // Pass 2: extract [[wikilinks]] and create edges.
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

  if (orphanLinks.length > 0) {
    const linkPairs = orphanLinks.map((l) => l.from + " -> " + l.to).join(", ");
    console.warn(
      `[seedProfessionCorpus] ${orphanLinks.length} orphan wiki-link(s) — ` +
        "target page not yet seeded: " + linkPairs,
    );
  }

  return {
    sourceCount,
    pageCount: wikiFiles.length,
    orphanLinks,
    emptyCorpus: false,
  };
}

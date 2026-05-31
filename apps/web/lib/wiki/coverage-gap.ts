// Coverage-gap detection (BI-741B6329, EP-CORPUS-BOOTSTRAP).
//
// When a "what would WE do?" (WWWD) query finds no org coverage, the corpus is
// telling us what it's MISSING. We capture that as a deduplicated draft
// "open question" page so the gap surfaces for review/enrichment — turning
// everyday usage into a backlog of corpus growth. Per design §6, a gap records
// a DRAFT PROMPT first; material only follows once a human answers it or
// research fills it (autonomous research is gated on open-Q#4 and intentionally
// NOT wired here).
//
// V1 is a fast, fail-open DB upsert called fire-and-forget from the coworker
// recall path. Dedup/coalesce is by a deterministic org-scoped fingerprint slug
// (open-Q#3): the same topic upserts the same page rather than piling up. A
// later slice (queue + threshold tuning) can move this onto the durable queue.

import { createHash } from "node:crypto";
import { prisma } from "@dpf/db";
import { upsertWikiPage, appendRevision } from "@dpf/db/wiki-store";

const MAX_TOPIC_LEN = 160;

/** Normalise a query into a stable topic key: lowercase, collapse whitespace,
 *  strip trailing punctuation, cap length. */
export function normalizeGapTopic(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?!.\s]+$/g, "")
    .slice(0, MAX_TOPIC_LEN);
}

/** Deterministic, org-scoped fingerprint of a gap topic (16 hex chars). */
export function gapFingerprint(organizationId: string, topic: string): string {
  return createHash("sha256")
    .update(`${organizationId}:${normalizeGapTopic(topic)}`)
    .digest("hex")
    .slice(0, 16);
}

export function gapPageSlug(fingerprint: string): string {
  return `open-question-${fingerprint}`;
}

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type RecordCoverageGapClient = {
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

export type RecordCoverageGapInput = {
  organizationId: string;
  /** The original WWWD question the coworker couldn't answer from org content. */
  query: string;
};

export type RecordCoverageGapResult = {
  recorded: boolean;
  slug: string;
  /** True when this detection created the draft (vs coalescing into an existing one). */
  isNew: boolean;
};

export async function recordCoverageGap(
  input: RecordCoverageGapInput,
  deps: { db?: RecordCoverageGapClient } = {},
): Promise<RecordCoverageGapResult> {
  const topic = normalizeGapTopic(input.query);
  if (topic.length === 0) return { recorded: false, slug: "", isNew: false };

  const db = deps.db ?? (prisma as unknown as RecordCoverageGapClient);
  const slug = gapPageSlug(gapFingerprint(input.organizationId, topic));

  const existing = (await db.wikiPage.findFirst({
    where: { organizationId: input.organizationId, slug },
    select: { id: true },
  })) as { id: string } | null;

  const question = input.query.trim();
  const title = `Open question: ${question.slice(0, 120)}`;
  const body = [
    `# ${title}`,
    "",
    `A coworker was asked a "what would we do?" question on this topic, but the organization has no recorded WWWD stance yet:`,
    "",
    `> ${question}`,
    "",
    `Answer this — edit and publish this page — and it becomes part of your organization's "what would we do" corpus.`,
  ].join("\n");

  const saved = (await upsertWikiPage(db as unknown as Parameters<typeof upsertWikiPage>[0], {
    organizationId: input.organizationId,
    slug,
    title,
    body,
    pageKind: "stance",
    status: "draft", // never retrieved for WWWD answers until a human publishes it
    isKernel: false,
    abstract: `Unanswered WWWD question: ${topic}`,
  })) as { id: string };

  // Only append a revision the first time — re-detection coalesces silently.
  if (!existing) {
    await appendRevision(db as unknown as Parameters<typeof appendRevision>[0], {
      pageId: saved.id,
      title,
      body,
      changeKind: "ingest",
      changeSummary: "coverage-gap detected",
    });
  }

  return { recorded: true, slug, isNew: !existing };
}

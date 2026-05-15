// EP-WIKI-001 Phase 2.3a: turn a `WikiDiffProposal` into real DB writes.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 2.3)
//
// Bridge between Phase 2.2's pure proposal engine (apps/web/lib/wiki/proposal.ts)
// and the WikiPage / WikiPageRevision / WikiPageSource / WikiIngestEvent
// storage layer. Two core jobs:
//
//   1. Translate ClaimProposal / StanceProposal / HeuristicProposal rows
//      into wiki page bodies that fit the SCHEMA.md required-section
//      contract. Templates kept simple — every new page lands as `draft`
//      so Mark reviews before it appears in the published view.
//
//   2. Enforce the spec's runtime guardrails:
//      - Kernel pages are PR-only — runtime ingest cannot write to
//        isKernel = true rows. Org overlay writes only.
//      - Body delta cap (default 30%) on UPDATES — larger rewrites need
//        human approval and are surfaced as errors rather than auto-
//        committed.
//      - Confidence threshold (default 0.5) on claims — low-confidence
//        rows are skipped so the reviewer's signal-to-noise stays high.
//
// Qdrant write is intentionally out of scope here — that's a thin
// concern wired by the production adapter in Phase 2.3b. This module
// owns Postgres state only and is exercised under test with mocked
// Prisma clients.

import {
  appendRevision,
  attachSource,
  getWikiPage,
  linkPages,
  recordIngestEvent,
  upsertWikiPage,
  type WikiStoreClient,
} from "@dpf/db/wiki-store";
import { extractWikilinks } from "@dpf/db/wiki-frontmatter";
import type {
  ClaimProposal,
  HeuristicProposal,
  StanceProposal,
  WikiDiffProposal,
} from "./proposal";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Subset of `WikiStoreClient` this orchestrator needs. */
type CommitClient = Pick<
  WikiStoreClient,
  | "wikiPage"
  | "wikiPageRevision"
  | "wikiPageLink"
  | "wikiPageSource"
  | "wikiIngestEvent"
>;

export type CommitProposalInput = {
  /** RawSource.id from Phase 2.1's `ingestRawSourceFromFile`. */
  rawSourceId: string;
  /** `sourceKey` of the RawSource — used to render `[[raw-sources/<key>]]` cites. */
  sourceKey: string;
  /** Output of `proposeWikiDiff` (Phase 2.2). */
  proposal: WikiDiffProposal;
  /**
   * Org-scoped commit (overlay rows) when set; kernel-scoped (forbidden
   * for runtime writes) when null. Per spec, `commitIngestProposal`
   * REFUSES kernel writes and returns an error instead of throwing — the
   * caller logs it and surfaces to the reviewer.
   */
  organizationId: string | null;
  agentId?: string | null;
  userId?: string | null;
  kernelVersion?: string | null;
  /**
   * Minimum confidence a claim must reach to be committed. Default 0.5.
   * Skipped claims appear in `result.skippedLowConfidence` so the reviewer
   * can see what the model proposed and didn't make the cut.
   */
  acceptThreshold?: number;
  /**
   * Cap on body growth per existing page in one ingest cycle, expressed
   * as a fraction of the existing body length. Default 0.3 (30%) per
   * spec section 6 ("ingest revisions cannot replace >30% of a page in
   * one shot — forces human approval"). Pages that would exceed the cap
   * are surfaced as errors instead of being auto-committed.
   */
  maxBodyDeltaRatio?: number;
};

export type CommitProposalResult = {
  /** Page ids that got a new revision or were created in this commit. */
  touchedPageIds: string[];
  createdPageSlugs: string[];
  updatedPageSlugs: string[];
  /** Claims dropped because confidence < acceptThreshold. */
  skippedLowConfidence: ClaimProposal[];
  /** Per-row errors (kernel-write attempt, body-cap exceeded, etc.). */
  errors: string[];
  /** WikiIngestEvent.id created for this commit. */
  eventId: string;
};

// ─── Body templates ─────────────────────────────────────────────────────────

const NEW_PAGE_TEMPLATES: Record<
  "entity" | "summary" | "decision" | "runbook" | "principle",
  (args: { title: string; excerpt: string; sourceKey: string }) => string
> = {
  entity: ({ title, excerpt, sourceKey }) => `## Definition

${excerpt}

## Properties

(to be authored — Mark)

## Relationships

(to be authored — Mark)

## Source-anchored claims

- ${title}. See [[raw-sources/${sourceKey}]].

## Examples

(to be authored — Mark)
`,
  summary: ({ excerpt, sourceKey }) => `## Source

[[raw-sources/${sourceKey}]]

## Key claims

${excerpt
  .split("\n")
  .filter((l) => l.trim().length > 0)
  .map((l) => `- ${l.trim()}`)
  .join("\n")}

## Stance & heuristics extracted

(to be linked once stance/heuristic pages from this source land)
`,
  decision: ({ title, excerpt, sourceKey }) => `## Context

${excerpt}

## Decision

${title}

## Consequences

(to be authored — Mark)

## Alternatives Considered

(to be authored — Mark)

## Source

[[raw-sources/${sourceKey}]]
`,
  runbook: ({ title, excerpt, sourceKey }) => `## When to use

${excerpt}

## Prerequisites

(to be authored — Mark)

## Steps

1. ${title}

## Verification

(to be authored — Mark)

## Rollback

(to be authored — Mark)

## Source

[[raw-sources/${sourceKey}]]
`,
  // Principle pages have richer required frontmatter (tier, dimensions,
  // applies-to). Runtime-proposed principles are intentionally light: the
  // body skeleton lands as a draft, Mark fills the metadata.
  principle: ({ title, excerpt, sourceKey }) => `## Rule

${title}

## Why

${excerpt}

## Applies To

(to be authored — Mark; set principleAppliesTo in frontmatter)

## How To Apply

(to be authored — Mark)

## Decision Dimensions

(to be authored — Mark; populate principleDimensionVector)

## Examples

(positive + counterexample to be authored)

## Sources

[[raw-sources/${sourceKey}]]
`,
};

function newStanceBody(args: {
  statement: string;
  excerpt: string;
  sourceKey: string;
}): string {
  return `## Stance

${args.statement}

## Reasoning

${args.excerpt}

## When this applies / when it doesn't

(to be authored — Mark)

## Sources

[[raw-sources/${args.sourceKey}]]
`;
}

function newHeuristicBody(args: {
  rule: string;
  excerpt: string;
  sourceKey: string;
}): string {
  return `## Rule

${args.rule}

## Why

${args.excerpt}

## Worked example

(to be authored — Mark)

## Counterexamples

(to be authored — Mark)

## Sources

[[raw-sources/${args.sourceKey}]]
`;
}

/**
 * Append a new "Additional source-anchored claims" section to an existing
 * page body. Idempotent on the section header — re-running with the same
 * claim does not duplicate the bullet (we check for the exact line).
 */
function appendClaimToExistingBody(
  existingBody: string,
  claim: ClaimProposal,
  sourceKey: string,
): string {
  const headerLine = "## Additional source-anchored claims (ingested)";
  const newLine = `- ${claim.claim} — supporting: "${truncateExcerpt(claim.supportingExcerpt)}". See [[raw-sources/${sourceKey}]].`;

  if (existingBody.includes(newLine)) {
    return existingBody;
  }

  if (existingBody.includes(headerLine)) {
    return `${existingBody.trimEnd()}\n${newLine}\n`;
  }

  return `${existingBody.trimEnd()}\n\n${headerLine}\n\n${newLine}\n`;
}

function truncateExcerpt(excerpt: string, max = 240): string {
  const trimmed = excerpt.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

// ─── Title derivation ───────────────────────────────────────────────────────

function titleFromSlug(slug: string): string {
  const stem = slug.split("/").pop() ?? slug;
  return stem
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ─── Commit one row ─────────────────────────────────────────────────────────

type CommitRowDeps = {
  db: CommitClient;
  rawSourceId: string;
  sourceKey: string;
  organizationId: string;
  agentId: string | null;
  userId: string | null;
  kernelVersion: string | null;
  maxBodyDeltaRatio: number;
};

type CommitRowOutcome =
  | { kind: "created" | "updated"; pageId: string; slug: string }
  | { kind: "error"; message: string };

async function commitClaim(
  deps: CommitRowDeps,
  claim: ClaimProposal,
): Promise<CommitRowOutcome> {
  const { db, rawSourceId, sourceKey, organizationId } = deps;
  const existing = (await getWikiPage(db, {
    organizationId,
    slug: claim.targetSlug,
  })) as { id: string; body: string; title: string; isKernel: boolean } | null;

  if (existing) {
    if (existing.isKernel) {
      return {
        kind: "error",
        message: `claim ${claim.targetSlug}: refusing to write — kernel page (kernel pages are PR-only).`,
      };
    }
    const newBody = appendClaimToExistingBody(existing.body, claim, sourceKey);
    if (newBody === existing.body) {
      // Idempotent no-op — claim already present.
      return { kind: "updated", pageId: existing.id, slug: claim.targetSlug };
    }
    if (
      existing.body.length > 0 &&
      (newBody.length - existing.body.length) / existing.body.length >
        deps.maxBodyDeltaRatio
    ) {
      return {
        kind: "error",
        message: `claim ${claim.targetSlug}: refusing to commit — append exceeds maxBodyDeltaRatio (${(((newBody.length - existing.body.length) / existing.body.length) * 100).toFixed(0)}% > ${(deps.maxBodyDeltaRatio * 100).toFixed(0)}%); needs human approval.`,
      };
    }
    await upsertWikiPage(db, {
      organizationId,
      slug: claim.targetSlug,
      title: existing.title,
      body: newBody,
      pageKind: claim.pageKind,
      // Existing rows keep their status; the upsert helper preserves it via
      // findFirst-then-update path. Body change still triggers a revision.
    });
    await appendRevision(db, {
      pageId: existing.id,
      title: existing.title,
      body: newBody,
      changeKind: "ingest",
      changeSummary: `Ingest from ${sourceKey}: ${claim.claim.slice(0, 80)}`,
      createdById: deps.userId,
      createdByAgentId: deps.agentId,
    });
    await attachSource(db, { pageId: existing.id, sourceId: rawSourceId });
    return { kind: "updated", pageId: existing.id, slug: claim.targetSlug };
  }

  // New page — only the kinds the spec lets ingest propose. Stance and
  // heuristic pages from claims would short-circuit pass 3; reject.
  if (claim.pageKind === "stance" || claim.pageKind === "heuristic") {
    return {
      kind: "error",
      message: `claim ${claim.targetSlug}: pass-2 cannot create stance/heuristic pages directly — those come from pass-3.`,
    };
  }

  const template = NEW_PAGE_TEMPLATES[claim.pageKind];
  if (!template) {
    return {
      kind: "error",
      message: `claim ${claim.targetSlug}: no body template for pageKind ${claim.pageKind}.`,
    };
  }
  const title = titleFromSlug(claim.targetSlug);
  const body = template({
    title,
    excerpt: claim.supportingExcerpt,
    sourceKey,
  });
  const created = (await upsertWikiPage(db, {
    organizationId,
    slug: claim.targetSlug,
    title,
    body,
    pageKind: claim.pageKind,
    status: "draft",
  })) as { id: string };

  await appendRevision(db, {
    pageId: created.id,
    title,
    body,
    changeKind: "ingest",
    changeSummary: `Created from ${sourceKey}: ${claim.claim.slice(0, 80)}`,
    createdById: deps.userId,
    createdByAgentId: deps.agentId,
  });
  await attachSource(db, { pageId: created.id, sourceId: rawSourceId });
  return { kind: "created", pageId: created.id, slug: claim.targetSlug };
}

async function commitStance(
  deps: CommitRowDeps,
  stance: StanceProposal,
): Promise<CommitRowOutcome> {
  const { db, rawSourceId, sourceKey, organizationId } = deps;
  const existing = (await getWikiPage(db, {
    organizationId,
    slug: stance.targetSlug,
  })) as { id: string; body: string; title: string; isKernel: boolean } | null;

  if (existing) {
    if (existing.isKernel) {
      return {
        kind: "error",
        message: `stance ${stance.targetSlug}: refusing to write — kernel page (kernel pages are PR-only).`,
      };
    }
    // Existing stance: append the new statement + excerpt as an additional
    // source-anchored support paragraph; body delta cap applies.
    const addition = `\n\n> Additional support from [[raw-sources/${sourceKey}]]: ${stance.statement}\n>\n> "${truncateExcerpt(stance.supportingExcerpt)}"\n`;
    if (existing.body.includes(addition.trim())) {
      return { kind: "updated", pageId: existing.id, slug: stance.targetSlug };
    }
    const newBody = existing.body.trimEnd() + addition;
    if (
      existing.body.length > 0 &&
      (newBody.length - existing.body.length) / existing.body.length >
        deps.maxBodyDeltaRatio
    ) {
      return {
        kind: "error",
        message: `stance ${stance.targetSlug}: refusing to commit — append exceeds maxBodyDeltaRatio.`,
      };
    }
    await upsertWikiPage(db, {
      organizationId,
      slug: stance.targetSlug,
      title: existing.title,
      body: newBody,
      pageKind: "stance",
    });
    await appendRevision(db, {
      pageId: existing.id,
      title: existing.title,
      body: newBody,
      changeKind: "ingest",
      changeSummary: `Ingest stance support from ${sourceKey}`,
      createdById: deps.userId,
      createdByAgentId: deps.agentId,
    });
    await attachSource(db, { pageId: existing.id, sourceId: rawSourceId });
    return { kind: "updated", pageId: existing.id, slug: stance.targetSlug };
  }

  const title = titleFromSlug(stance.targetSlug);
  const body = newStanceBody({
    statement: stance.statement,
    excerpt: stance.supportingExcerpt,
    sourceKey,
  });
  const created = (await upsertWikiPage(db, {
    organizationId,
    slug: stance.targetSlug,
    title,
    body,
    pageKind: "stance",
    status: "draft",
  })) as { id: string };
  await appendRevision(db, {
    pageId: created.id,
    title,
    body,
    changeKind: "ingest",
    changeSummary: `Created stance from ${sourceKey}`,
    createdById: deps.userId,
    createdByAgentId: deps.agentId,
  });
  await attachSource(db, { pageId: created.id, sourceId: rawSourceId });
  return { kind: "created", pageId: created.id, slug: stance.targetSlug };
}

async function commitHeuristic(
  deps: CommitRowDeps,
  heuristic: HeuristicProposal,
): Promise<CommitRowOutcome> {
  const { db, rawSourceId, sourceKey, organizationId } = deps;
  const existing = (await getWikiPage(db, {
    organizationId,
    slug: heuristic.targetSlug,
  })) as { id: string; body: string; title: string; isKernel: boolean } | null;

  if (existing) {
    if (existing.isKernel) {
      return {
        kind: "error",
        message: `heuristic ${heuristic.targetSlug}: refusing to write — kernel page (kernel pages are PR-only).`,
      };
    }
    const addition = `\n\n> Additional support from [[raw-sources/${sourceKey}]]: ${heuristic.rule}\n>\n> "${truncateExcerpt(heuristic.supportingExcerpt)}"\n`;
    if (existing.body.includes(addition.trim())) {
      return {
        kind: "updated",
        pageId: existing.id,
        slug: heuristic.targetSlug,
      };
    }
    const newBody = existing.body.trimEnd() + addition;
    if (
      existing.body.length > 0 &&
      (newBody.length - existing.body.length) / existing.body.length >
        deps.maxBodyDeltaRatio
    ) {
      return {
        kind: "error",
        message: `heuristic ${heuristic.targetSlug}: refusing to commit — append exceeds maxBodyDeltaRatio.`,
      };
    }
    await upsertWikiPage(db, {
      organizationId,
      slug: heuristic.targetSlug,
      title: existing.title,
      body: newBody,
      pageKind: "heuristic",
    });
    await appendRevision(db, {
      pageId: existing.id,
      title: existing.title,
      body: newBody,
      changeKind: "ingest",
      changeSummary: `Ingest heuristic support from ${sourceKey}`,
      createdById: deps.userId,
      createdByAgentId: deps.agentId,
    });
    await attachSource(db, { pageId: existing.id, sourceId: rawSourceId });
    return { kind: "updated", pageId: existing.id, slug: heuristic.targetSlug };
  }

  const title = titleFromSlug(heuristic.targetSlug);
  const body = newHeuristicBody({
    rule: heuristic.rule,
    excerpt: heuristic.supportingExcerpt,
    sourceKey,
  });
  const created = (await upsertWikiPage(db, {
    organizationId,
    slug: heuristic.targetSlug,
    title,
    body,
    pageKind: "heuristic",
    status: "draft",
  })) as { id: string };
  await appendRevision(db, {
    pageId: created.id,
    title,
    body,
    changeKind: "ingest",
    changeSummary: `Created heuristic from ${sourceKey}`,
    createdById: deps.userId,
    createdByAgentId: deps.agentId,
  });
  await attachSource(db, { pageId: created.id, sourceId: rawSourceId });
  return { kind: "created", pageId: created.id, slug: heuristic.targetSlug };
}

// ─── Wikilink graph ─────────────────────────────────────────────────────────

/**
 * After every page write, scan the new body for `[[wikilinks]]` and
 * upsert WikiPageLink edges for the ones that resolve to existing pages
 * in the same scope (org overlay or kernel). Dangling links are not
 * upserted — the lint detector flags them.
 */
async function syncOutLinks(
  db: CommitClient,
  fromPageId: string,
  body: string,
  organizationId: string,
): Promise<void> {
  const slugs = extractWikilinks(body).filter(
    (s) => !s.startsWith("raw-sources/"),
  );
  if (slugs.length === 0) return;

  for (const slug of slugs) {
    const target = (await getWikiPage(db, {
      organizationId,
      slug,
    })) as { id: string } | null;
    if (target && target.id !== fromPageId) {
      await linkPages(db, { fromPageId, toPageId: target.id });
    }
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Commit a `WikiDiffProposal` against the storage layer. Each row commits
 * independently — a single bad row does not abort the rest. Errors are
 * collected on `result.errors` so the reviewer sees the full picture.
 *
 * Refuses to write to kernel pages (organizationId = null) entirely; per
 * spec section 6, kernel pages are PR-only. Org overlays only.
 *
 * Idempotent on re-run when the same proposal is committed twice — the
 * append helper checks for the exact claim line before adding it; existing
 * stances/heuristics deduplicate on the additional-support paragraph.
 */
export async function commitIngestProposal(
  db: CommitClient,
  input: CommitProposalInput,
): Promise<CommitProposalResult> {
  if (input.organizationId === null) {
    const event = (await recordIngestEvent(db, {
      sourceId: input.rawSourceId,
      organizationId: null,
      touchedPageIds: [],
      agentId: input.agentId ?? null,
      userId: input.userId ?? null,
      kernelVersion: input.kernelVersion ?? null,
    })) as { id: string };
    return {
      touchedPageIds: [],
      createdPageSlugs: [],
      updatedPageSlugs: [],
      skippedLowConfidence: [],
      errors: [
        "commitIngestProposal: organizationId is null — kernel writes are not allowed at runtime (kernel pages are PR-only). Pass an organizationId to write an overlay.",
      ],
      eventId: event.id,
    };
  }

  const acceptThreshold = input.acceptThreshold ?? 0.5;
  const maxBodyDeltaRatio = input.maxBodyDeltaRatio ?? 0.3;
  const deps: CommitRowDeps = {
    db,
    rawSourceId: input.rawSourceId,
    sourceKey: input.sourceKey,
    organizationId: input.organizationId,
    agentId: input.agentId ?? null,
    userId: input.userId ?? null,
    kernelVersion: input.kernelVersion ?? null,
    maxBodyDeltaRatio,
  };

  const errors: string[] = [];
  const skippedLowConfidence: ClaimProposal[] = [];
  const touchedPageIds: string[] = [];
  const createdPageSlugs: string[] = [];
  const updatedPageSlugs: string[] = [];

  // Process claims first so subsequent stance/heuristic links resolve.
  for (const claim of input.proposal.claims) {
    if (claim.confidence < acceptThreshold) {
      skippedLowConfidence.push(claim);
      continue;
    }
    const outcome = await commitClaim(deps, claim);
    if (outcome.kind === "error") {
      errors.push(outcome.message);
      continue;
    }
    touchedPageIds.push(outcome.pageId);
    if (outcome.kind === "created") createdPageSlugs.push(outcome.slug);
    else updatedPageSlugs.push(outcome.slug);
  }

  for (const stance of input.proposal.stances) {
    const outcome = await commitStance(deps, stance);
    if (outcome.kind === "error") {
      errors.push(outcome.message);
      continue;
    }
    touchedPageIds.push(outcome.pageId);
    if (outcome.kind === "created") createdPageSlugs.push(outcome.slug);
    else updatedPageSlugs.push(outcome.slug);
  }

  for (const heuristic of input.proposal.heuristics) {
    const outcome = await commitHeuristic(deps, heuristic);
    if (outcome.kind === "error") {
      errors.push(outcome.message);
      continue;
    }
    touchedPageIds.push(outcome.pageId);
    if (outcome.kind === "created") createdPageSlugs.push(outcome.slug);
    else updatedPageSlugs.push(outcome.slug);
  }

  // Sync the wikilink graph for every page we touched. Body lookup is
  // best-effort (a page that just had its body rewritten still exists in
  // the same scope), so any errors here just get appended to result.errors.
  const uniquePageIds = Array.from(new Set(touchedPageIds));
  for (const pageId of uniquePageIds) {
    try {
      const page = (await db.wikiPage.findFirst({
        where: { id: pageId },
        select: { body: true },
      })) as { body: string } | null;
      if (page) {
        await syncOutLinks(db, pageId, page.body, input.organizationId);
      }
    } catch (err) {
      errors.push(
        `link-sync ${pageId}: ${(err as Error).message ?? String(err)}`,
      );
    }
  }

  const event = (await recordIngestEvent(db, {
    sourceId: input.rawSourceId,
    organizationId: input.organizationId,
    touchedPageIds: uniquePageIds,
    agentId: input.agentId ?? null,
    userId: input.userId ?? null,
    kernelVersion: input.kernelVersion ?? null,
  })) as { id: string };

  return {
    touchedPageIds: uniquePageIds,
    createdPageSlugs,
    updatedPageSlugs,
    skippedLowConfidence,
    errors,
    eventId: event.id,
  };
}

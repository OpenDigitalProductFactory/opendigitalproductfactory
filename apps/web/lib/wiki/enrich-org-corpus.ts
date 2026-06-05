// EP-CORPUS-BOOTSTRAP Phase 1: the enrichOrgCorpus façade (BI-7C9D6198).
// Spec: docs/superpowers/specs/2026-05-31-continuous-corpus-enrichment-design.md
//
// One governed contract that every continuous-enrichment SOURCE feeds:
// data-entry, Q&A, document upload, AI research, integration import,
// gap-detection. Each source normalises its input to { text, provenance,
// trust } and calls enrichOrgCorpus(); we own the rest — ingest the raw
// source, run the LLM proposer, commit the resulting overlay pages, embed
// them, and link them to the org's DecisionPerspectiveProfile via
// PerspectiveMaterial rows. Idempotent on re-invoke.
//
// Why a façade, not a per-source pipeline: a corpus that grows from many
// heterogeneous sources at many different times must converge on ONE
// trust/dedup/provenance contract. The seed step (seed-org-wwwd-corpus.ts,
// PR #1360) handles the first-time profile + opinionated archetype seed;
// THIS module handles every enrichment afterwards.

import { prisma } from "@dpf/db";
import {
  ingestRawSourceFromText,
  type IngestRawSourceFromTextInput,
} from "./ingest";
import {
  proposeWikiDiff,
  type InferenceCallable,
  type WikiDiffProposal,
} from "./proposal";
import { loadExistingSlugSnapshot } from "./schema-context";
import {
  commitIngestProposal,
  type CommitProposalResult,
} from "./proposal-commit";
import {
  storeWikiPage,
  type StoreWikiPageInput,
} from "./embeddings";

// ─── Trust → routing rules ──────────────────────────────────────────────────
// FOUNDER DECISION (2026-05-31, BI-1378 / design §6): DRAFT BY DEFAULT so we can
// review. EVERY enrichOrgCorpus output lands as draft + candidate — regardless
// of trust — so a human reviews before it becomes authoritative. The ONLY
// auto-publish path in the platform is the initial onboarding seed
// (seed-org-wwwd-corpus.ts), which is a separate bootstrap, not this façade.
//
// Trust no longer changes review/promotion state; it only sets the evidence
// grade + confidence weight (for later weighting) so the review surface can
// still distinguish first-party facts from AI-found research:
//   first-party (operator typed)       → draft, candidate, grade A
//   derived     (extracted from upload)→ draft, candidate, grade B
//   researched  (AI found, vetted)     → draft, candidate, grade C
//
// Page status follows the existing commit-step convention: NEW pages land as
// status="draft"; appends to already-published pages go straight in. Reviewers
// publish drafts via the existing review affordance (list_wiki_overlay_drafts).
// We layer trust as PerspectiveMaterial grade, NOT as a parallel page status.

export type EnrichmentTrust = "first-party" | "derived" | "researched";

type MaterialTrustShape = {
  evidenceGrade: "A" | "B" | "C";
  confidenceWeight: number;
  reviewStatus: "approved" | "draft";
  promotionState: "promoted" | "candidate";
};

const TRUST_TO_MATERIAL: Record<EnrichmentTrust, MaterialTrustShape> = {
  // Draft by default (BI-1378): trust sets grade/weight, NOT review state.
  "first-party": {
    evidenceGrade: "A",
    confidenceWeight: 0.85,
    reviewStatus: "draft",
    promotionState: "candidate",
  },
  derived: {
    evidenceGrade: "B",
    confidenceWeight: 0.65,
    reviewStatus: "draft",
    promotionState: "candidate",
  },
  researched: {
    evidenceGrade: "C",
    confidenceWeight: 0.4,
    reviewStatus: "draft",
    promotionState: "candidate",
  },
};

// ─── Provenance input ───────────────────────────────────────────────────────

/** The closed set of corpus-bootstrap source kinds (spec §3, §6). */
export type EnrichmentSourceType =
  | "data-entry"
  | "qa"
  | "document"
  | "research"
  | "integration"
  | "gap-detection";

/** Each sourceType has an idiomatic sourceRef shape. We capture it as a
 *  free-form JSON object so the contract stays open as new feeders land. */
export type EnrichmentProvenance = {
  sourceType: EnrichmentSourceType;
  /** Free-form structured pointer — varies by sourceType. Examples:
   *  - data-entry: { field: "mission" }
   *  - qa:         { question, askedBy }
   *  - document:   { documentId, version, page? }
   *  - research:   { agent, urls, model }
   *  - integration:{ provider: "quickbooks", recordKind: "vendor", recordId }
   *  - gap-detection: { topic, originatingQuery } */
  sourceRef: Record<string, unknown>;
};

// ─── Input / Result ─────────────────────────────────────────────────────────

export type EnrichOrgCorpusInput = {
  organizationId: string;
  /** Normalised content the proposer will read. Plain text or markdown. */
  text: string;
  provenance: EnrichmentProvenance;
  trust: EnrichmentTrust;
  /** Optional human-readable title for the RawSource row + audit. Derived
   *  from provenance when omitted. */
  title?: string;
  /** Optional one-paragraph abstract. Recommended for `document` and
   *  `research` sources where the body is long. */
  abstract?: string | null;
  /** Stable idempotency key. Derived from (organizationId, sourceType,
   *  sourceRef) when omitted — sourceRef is JSON-stringified deterministically. */
  sourceKey?: string;
  /** Mapped from provenance.sourceType when omitted. */
  rawSourceType?: import("@dpf/db/wiki-store").RawSourceType;
  /** Attribution forwarded to the audit row + commit. */
  agentId?: string | null;
  userId?: string | null;
  /** Production wiring: `createProductionInference()`. Tests inject a stub. */
  infer: InferenceCallable;
  /** Tests inject a fake DB; production omits and we use the shared prisma. */
  db?: EnrichCorpusClient;
  /** Tests inject a fake embed; production omits and we use storeWikiPage. */
  embed?: (input: StoreWikiPageInput) => Promise<boolean>;
};

export type EnrichOrgCorpusResult = {
  rawSourceId: string;
  /** WikiPages created/updated by this enrichment. */
  committed: Array<{ pageId: string; slug: string }>;
  /** PerspectiveMaterial ids upserted by this enrichment. */
  materialIds: string[];
  /** Future hook: materials this enrichment supersedes (V1 always empty). */
  superseded: string[];
  /** Reviewer-visible signal — claims dropped below the commit threshold,
   *  pages skipped because the org has no profile yet, etc. */
  warnings: string[];
  /** Underlying proposal + commit results, exposed for tests + downstream
   *  observability without re-running the pipeline. */
  proposal: WikiDiffProposal;
  commit: CommitProposalResult;
};

// ─── Structural DB client (testable; matched by real Prisma) ────────────────

/** Subset of PrismaClient the façade needs. Defined structurally so the
 *  test suite can pass a fake without importing the real client. */
export type EnrichCorpusClient = {
  rawSource: { upsert: (args: unknown) => Promise<unknown> };
  wikiIngestEvent: { create: (args: unknown) => Promise<unknown> };
  wikiPage: {
    findFirst: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  wikiPageRevision: {
    create: (args: unknown) => Promise<unknown>;
    findFirst?: (args: unknown) => Promise<unknown>;
  };
  wikiPageSource?: {
    create?: (args: unknown) => Promise<unknown>;
    findFirst?: (args: unknown) => Promise<unknown>;
  };
  rawSourceClient?: unknown;
  decisionPerspectiveProfile: {
    findUnique: (args: unknown) => Promise<unknown>;
  };
  perspectiveMaterial: {
    upsert: (args: unknown) => Promise<unknown>;
  };
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const PLAN_READINESS_DOMAIN_CLASS = "plan-readiness";

/** Stable JSON-stringify for sourceRef so the idempotency key is the same
 *  across re-invocations. Keys are sorted to defeat ordering noise from
 *  callers (e.g. {a,b} vs {b,a}). */
function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableJsonStringify(obj[k])}`)
    .join(",")}}`;
}

function deriveSourceKey(
  organizationId: string,
  provenance: EnrichmentProvenance,
): string {
  return `enrich:${organizationId}:${provenance.sourceType}:${stableJsonStringify(provenance.sourceRef)}`;
}

function deriveTitle(provenance: EnrichmentProvenance, fallback: string): string {
  const ref = provenance.sourceRef;
  if (typeof ref.title === "string" && ref.title.trim().length > 0) {
    return ref.title;
  }
  if (typeof ref.field === "string" && ref.field.trim().length > 0) {
    return `${provenance.sourceType}: ${ref.field}`;
  }
  if (typeof ref.documentId === "string") {
    return `Document ${ref.documentId}`;
  }
  if (typeof ref.question === "string" && ref.question.trim().length > 0) {
    return ref.question.length > 80 ? `${ref.question.slice(0, 77)}...` : ref.question;
  }
  if (typeof ref.recordId === "string" && typeof ref.provider === "string") {
    return `${ref.provider}: ${ref.recordKind ?? "record"} ${ref.recordId}`;
  }
  if (typeof ref.topic === "string") {
    return `Gap: ${ref.topic}`;
  }
  return fallback;
}

/** Provenance.sourceType → RawSource.sourceType mapping. The corpus design
 *  taxonomy (data-entry/qa/document/research/integration/gap-detection) is
 *  richer than the RawSource type registry (paper/article/spec/...). We
 *  collapse the corpus axis onto the storage axis here so existing RawSource
 *  filtering keeps working without a schema change. */
function mapProvenanceToRawSourceType(
  sourceType: EnrichmentSourceType,
): import("@dpf/db/wiki-store").RawSourceType {
  switch (sourceType) {
    case "document":
      return "doc";
    case "research":
      return "article";
    case "qa":
    case "data-entry":
    case "gap-detection":
      return "doc";
    case "integration":
      return "external-url";
  }
}

// ─── The façade ─────────────────────────────────────────────────────────────

/**
 * Enrich a single org's WWWD corpus with one new piece of content from one
 * source. The pipeline:
 *
 *   1. Upsert RawSource (sourceKey-keyed; idempotent) + WikiIngestEvent audit
 *      via {@link ingestRawSourceFromText} — no filesystem access.
 *   2. Load the org-scoped existing-slug snapshot so the proposer dedups
 *      against pages that already exist.
 *   3. Run the three-pass LLM proposer to extract claims/stances/heuristics.
 *   4. Commit the proposal: create draft pages, append to existing published
 *      ones, write WikiPageRevisions, link WikiPageSource citations.
 *   5. For each touched page: embed it into Qdrant (fail-open) and upsert a
 *      PerspectiveMaterial row linking the page to the org's
 *      DecisionPerspectiveProfile current version. Material state reflects
 *      the trust level (researched → draft/candidate; first-party/derived →
 *      approved/promoted).
 *
 * Idempotency contract:
 * - Re-invoking with the same (organizationId, sourceType, sourceRef) upserts
 *   the same RawSource row, finds the same overlay pages, and re-asserts the
 *   same PerspectiveMaterial rows. New audit/revision rows are written each
 *   call (audit IS append-only by design); the resulting corpus state is
 *   stable.
 *
 * Profile contract:
 * - The org's DecisionPerspectiveProfile must already exist (seeded by
 *   `seedOrgWwwdCorpus` at onboarding completion). If absent, the WikiPages
 *   still commit (the operator can see the candidate content), but no
 *   PerspectiveMaterial rows are written and a warning is returned. This
 *   keeps the contract honest — enrichment never silently overrides the
 *   "no profile yet" intent — while still letting pre-onboarding flows
 *   capture content for later promotion.
 */
export async function enrichOrgCorpus(
  input: EnrichOrgCorpusInput,
): Promise<EnrichOrgCorpusResult> {
  const db = (input.db ?? (prisma as unknown as EnrichCorpusClient));
  const embed = input.embed ?? storeWikiPage;
  const warnings: string[] = [];

  const sourceKey =
    input.sourceKey ?? deriveSourceKey(input.organizationId, input.provenance);
  const sourceType =
    input.rawSourceType ?? mapProvenanceToRawSourceType(input.provenance.sourceType);
  const title = input.title ?? deriveTitle(input.provenance, sourceKey);

  // 1. Source-layer ingest (no filesystem).
  const textIngestInput: IngestRawSourceFromTextInput = {
    sourceKey,
    sourceType,
    title,
    body: input.text,
    abstract: input.abstract ?? null,
    locator: { ...input.provenance.sourceRef, sourceType: input.provenance.sourceType },
    organizationId: input.organizationId,
    isKernel: false,
    agentId: input.agentId ?? null,
    userId: input.userId ?? null,
  };
  const source = await ingestRawSourceFromText(
    db as unknown as Parameters<typeof ingestRawSourceFromText>[0],
    textIngestInput,
  );

  // 2. Org-scoped snapshot for the proposer + the commit step.
  const snapshot = await loadExistingSlugSnapshot(
    db as unknown as Parameters<typeof loadExistingSlugSnapshot>[0],
    { organizationId: input.organizationId },
  );

  // 3. Three-pass LLM extraction.
  const proposal = await proposeWikiDiff({
    source: {
      sourceKey,
      title,
      body: input.text,
      abstract: input.abstract ?? null,
    },
    snapshot,
    infer: input.infer,
  });

  // 4. Commit overlay pages.
  const commit = await commitIngestProposal(
    db as unknown as Parameters<typeof commitIngestProposal>[0],
    {
      rawSourceId: source.rawSourceId,
      sourceKey,
      proposal,
      organizationId: input.organizationId,
      agentId: input.agentId ?? null,
      userId: input.userId ?? null,
    },
  );

  // 5a. Resolve { slug → pageId, body, abstract, pageKind, status } for every
  //     touched page, in one query, so we can embed + upsert materials below.
  const touchedSlugs = [
    ...commit.createdPageSlugs,
    ...commit.updatedPageSlugs,
  ];
  const touchedRows = touchedSlugs.length > 0
    ? ((await db.wikiPage.findMany({
        where: { organizationId: input.organizationId, slug: { in: touchedSlugs } },
        select: {
          id: true,
          slug: true,
          title: true,
          body: true,
          abstract: true,
          pageKind: true,
          status: true,
        },
      })) as Array<{
        id: string;
        slug: string;
        title: string;
        body: string;
        abstract: string | null;
        pageKind: string;
        status: string;
      }>)
    : [];

  const committed: EnrichOrgCorpusResult["committed"] = touchedRows.map((r) => ({
    pageId: r.id,
    slug: r.slug,
  }));

  // 5b. Embed each touched page (fail-open: false → embedded=false on result,
  //     page still exists in Postgres; next embed cycle retries).
  for (const row of touchedRows) {
    const ok = await embed({
      pageId: row.id,
      slug: row.slug,
      title: row.title,
      body: row.body,
      abstract: row.abstract,
      pageKind: row.pageKind,
      status: row.status,
      isKernel: false,
      kernelVersion: null,
      organizationId: input.organizationId,
      kernelPageId: null,
    });
    if (!ok) {
      warnings.push(`embedding for page ${row.slug} failed (fail-open: page persisted, embed will retry)`);
    }
  }

  // 5c. PerspectiveMaterial upserts — link each touched page to the org's
  //     DecisionPerspectiveProfile. If no profile exists, we DO NOT auto-
  //     create one (that's seedOrgWwwdCorpus's job). We commit the WikiPages
  //     anyway so candidate content isn't lost, and warn so the caller can
  //     trigger seeding.
  const profileId = `org-perspective-${input.organizationId}`;
  const profileRow = (await db.decisionPerspectiveProfile.findUnique({
    where: { profileId },
    select: { profileId: true, currentVersionId: true },
  })) as { profileId: string; currentVersionId: string | null } | null;

  const materialIds: string[] = [];
  if (!profileRow) {
    warnings.push(
      `org ${input.organizationId} has no DecisionPerspectiveProfile (${profileId}) — ` +
        `WikiPages committed but no PerspectiveMaterial rows linked. ` +
        `Run seedOrgWwwdCorpus to create the profile, then re-enrich (idempotent).`,
    );
  } else {
    const profileVersionId = profileRow.currentVersionId;
    const trustShape = TRUST_TO_MATERIAL[input.trust];

    for (const row of touchedRows) {
      const materialId = `${profileId}:${row.slug}`;
      await db.perspectiveMaterial.upsert({
        where: { materialId },
        update: {
          profileVersionId: profileVersionId,
          sourceType: row.pageKind,
          sourceRef: {
            wikiPageId: row.id,
            slug: row.slug,
            organizationId: input.organizationId,
            enrichment: {
              sourceType: input.provenance.sourceType,
              sourceRef: input.provenance.sourceRef,
              trust: input.trust,
              rawSourceId: source.rawSourceId,
            },
          },
          summary: row.abstract,
          freshness: "current",
          // Enrichment never sets review/promotion state (draft by default,
          // BI-1378) — and crucially never DEMOTES: if a human has since
          // reviewed this material to approved/promoted, re-enrichment must
          // preserve that. So on update we refresh only content-derived grading
          // (evidenceGrade/confidenceWeight) and leave reviewStatus/promotionState
          // untouched. trustShape.reviewStatus is always "draft" now, so this
          // guard is belt-and-suspenders against a future non-draft trust shape.
          ...(trustShape.reviewStatus === "draft"
            ? {
                evidenceGrade: trustShape.evidenceGrade,
                confidenceWeight: trustShape.confidenceWeight,
              }
            : {}),
        },
        create: {
          materialId,
          profileId,
          profileVersionId: profileVersionId,
          sourceType: row.pageKind,
          sourceRef: {
            wikiPageId: row.id,
            slug: row.slug,
            organizationId: input.organizationId,
            enrichment: {
              sourceType: input.provenance.sourceType,
              sourceRef: input.provenance.sourceRef,
              trust: input.trust,
              rawSourceId: source.rawSourceId,
            },
          },
          scope: { domains: [PLAN_READINESS_DOMAIN_CLASS] },
          domainClass: PLAN_READINESS_DOMAIN_CLASS,
          direction: "support",
          domains: [PLAN_READINESS_DOMAIN_CLASS],
          freshness: "current",
          evidenceGrade: trustShape.evidenceGrade,
          confidenceWeight: trustShape.confidenceWeight,
          reviewStatus: trustShape.reviewStatus,
          promotionState: trustShape.promotionState,
          summary: row.abstract,
        },
      });
      materialIds.push(materialId);
    }
  }

  // Surface dropped-claim signal so the caller can show the reviewer what
  // the LLM proposed but didn't make the cut.
  for (const dropped of commit.skippedLowConfidence) {
    warnings.push(
      `claim skipped (confidence below threshold): "${dropped.claim}" → ${dropped.targetSlug}`,
    );
  }
  for (const err of commit.errors) {
    warnings.push(`commit error: ${err}`);
  }

  return {
    rawSourceId: source.rawSourceId,
    committed,
    materialIds,
    superseded: [],
    warnings,
    proposal,
    commit,
  };
}

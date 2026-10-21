// ─── Shared Backlog-Ingest Front Door ───────────────────────────────────────
// One path every detector / queue files portal-dev work through, so work lands
// in the backlog (BacklogItem) the instant it is detected — no manual promotion
// step, no parallel queue. Generalizes the process-observer-triage pattern
// (pure builder + dedup + injectable deps) and gives it three-layer provenance.
//
// Provenance (per EA review): typed back-link (set by the caller on its own
// origin row), a BacklogItemActivity(kind="intake_origin") audit row written
// here, and a body marker as a no-migration compatibility bridge.
//
// See docs/superpowers/specs/2026-06-06-work-intake-unification-design.md
// (EP-INTAKE-UNIFY, BI-2BB06F90).

import { randomUUID } from "crypto";

import { prisma as defaultPrisma } from "@dpf/db";

import {
  BACKLOG_SOURCE_VALUES,
  BACKLOG_SCOPE_KIND_VALUES,
  BACKLOG_WORK_TYPE_VALUES,
  DEMAND_STAGE_VALUES,
  initialDemandStageForInput,
  type BacklogWorkType,
  type BacklogSource,
  type BacklogTriageOutcome,
  type BacklogEffortSize,
  type BacklogScopeKind,
  type DemandStage,
} from "@/lib/explore/backlog";
import {
  FILING_DUPLICATE_LIMIT,
  FILING_DUPLICATE_THRESHOLD,
  findDuplicateCandidates,
  type FilingDuplicateCandidate,
} from "@/lib/demand/dedup";
import {
  findImplementationCandidates,
  type ImplementationCandidate,
} from "@/lib/operate/implementation-scan";
import { listRepoSourceFiles } from "@/lib/operate/repo-file-inventory";
import { isRecord } from "@/lib/shared/coerce";

const defaultListRepoFiles = listRepoSourceFiles;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BacklogIngestInput {
  title: string;
  body?: string | null;
  /** The WHAT (closed enum) — required on every item per the workType spec. */
  workType: BacklogWorkType;
  /** The ORIGIN (closed enum) — how the work arrived. */
  source: BacklogSource;
  /** Ownership axis. Defaults to "portfolio" (platform-level work). */
  type?: "product" | "portfolio";
  /** Lifecycle status. Defaults to "triaging" so the item enters normal triage. */
  status?: "triaging" | "open" | "in-progress";
  triageOutcome?: BacklogTriageOutcome;
  /** Advisory suggestion for triage (non-binding). */
  proposedOutcome?: BacklogTriageOutcome;
  effortSize?: BacklogEffortSize;
  priority?: number;
  /** Semantic (EP-…) or cuid epic id; resolved to the FK in the orchestrator. */
  epicId?: string;
  digitalProductId?: string | null;
  organizationId?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
  demandStage?: DemandStage | null;
  taxonomyNodeId?: string | null;
  submittedById?: string | null;
  agentId?: string | null;
  /** Explicit full item id (e.g. BI-PORT-005). Generated when omitted. */
  itemId?: string;
  /** Item-id prefix used when no explicit itemId, e.g. "IMP" → BI-IMP-XXXXXXXX. */
  itemIdPrefix?: string;
  /** Provenance back-link to the origin record (e.g. {kind:"improvement", id:"IP-6F240"}). */
  origin?: { kind: string; id: string };
  /** Roadmap/budget scope: platform/common/archetype-specific/multi-archetype. */
  scopeKind?: BacklogScopeKind | null;
  archetypeCategories?: string[];
  archetypeIds?: string[];
  scopeRationale?: string | null;
  lifecycleTags?: string[];
  /**
   * Opt-in origin reconciliation for sources that re-deliver the same record
   * on every poll (BI-952F08BA, spec §6.1). Absent → existing recurrence
   * semantics (non-terminal dedupe + occurrence bump) are unchanged.
   */
  reconcile?: OriginReconciliation;
}

/** Source identity and state for a reconciled origin (spec §6.1). */
export interface OriginReconciliation {
  /** Lowercased `owner/repo` the qualified origin id belongs to. */
  repository: string;
  /** Canonical link to the source record. */
  sourceUrl: string | null;
  /** Source state as the origin reports it (e.g. "open" / "closed"). */
  state: string;
  /** Content/state fingerprint; a different value is a source change. */
  fingerprint: string;
  /** Legacy unqualified origin id to dual-read (the bare issue number). */
  legacyId?: string;
}

/**
 * What one ingest call did. `recurred` is the legacy recurrence path (count
 * bumped); the other three non-create values belong to reconciled origins.
 */
export type BacklogIngestOutcome = "created" | "recurred" | "unchanged" | "changed" | "needs-review";

export interface BacklogIngestResult {
  /** Semantic item id (BI-…). */
  itemId: string;
  /** Internal cuid (BacklogItem.id) — useful for FK writes by callers. */
  id: string;
  /** false = matched an existing item (or, for needs-review, created nothing). */
  created: boolean;
  /** Optional for the same reason as `implementationCandidates`. */
  outcome?: BacklogIngestOutcome;
  /** For `needs-review`: the item ids that claim this origin ambiguously. */
  reviewCandidates?: string[];
  /**
   * Files that may ALREADY implement what this item proposes to build
   * (BI-1A1EC5EC). Advisory — the item is still created. Empty when the item is
   * not build-intent, when nothing scored, or when no inventory was available.
   *
   * Existing dedup answers "is there another BI for this?"; this answers the
   * different question "does this already EXIST?" A backlog sweep cannot: it
   * searches backlog rows, not source.
   *
   * OPTIONAL on purpose. `ingestBacklogItem` always populates it, but the many
   * test fakes and injected ingest functions across the codebase legitimately
   * return only the identity fields. Requiring an advisory that a fake does not
   * produce would make every one of them a type error — the field is metadata
   * about the filing, not part of the filing contract.
   */
  implementationCandidates?: ImplementationCandidate[];

  /**
   * Items already on the backlog that look like this one (BI-3722E9A1).
   *
   * Optional for the same reason as `implementationCandidates`: it is
   * metadata about the filing, not part of the filing contract, and the
   * many injected ingest fakes legitimately return only identity fields.
   */
  duplicateCandidates?: FilingDuplicateCandidate[];

  /**
   * Set when meaning-based matching could not run (embeddings deferred or
   * failed). The advisory says so rather than letting an empty list read as
   * "nothing similar exists" (BI-3722E9A1).
   */
  duplicateSemanticUnavailable?: string | null;
}

/**
 * Minimal structural view of the stores the front door touches. Lets tests
 * inject a fake without standing up a Prisma client.
 */
/**
 * Statuses worth warning about (BI-3722E9A1). Open work first, but a
 * recently-done item matters too: filing the same thing again usually means
 * a regression, and the closed item carries the evidence that found it.
 */
const DUPLICATE_POOL_STATUSES = ["triaging", "open", "in-progress", "done"] as const;

/** Bounds the scan's cost on a backlog that is thousands of rows deep. */
const DUPLICATE_POOL_LIMIT = 500;

export interface IngestBacklogStore {
  backlogItem: {
    findFirst(args: unknown): Promise<{ id: string; itemId: string } | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<{ id: string; itemId: string }>;
    /** Candidate pool for the duplicate advisory (BI-3722E9A1). */
    findMany?(args: unknown): Promise<Array<{ id?: string; itemId: string; title: string; body: string | null; status: string }>>;
  };
  backlogItemActivity: {
    create(args: unknown): Promise<unknown>;
    /** Origin history for reconciliation (BI-952F08BA). Required when `reconcile` is set. */
    findMany?(args: unknown): Promise<Array<{ payload: unknown }>>;
  };
  epic: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
}

export interface BacklogIngestDeps {
  store?: IngestBacklogStore;
  /** Override knowledge indexing (default: fire-and-forget semantic-memory store). */
  indexKnowledge?: (args: { entityId: string; title: string; content: string }) => void;
  /**
   * Repo file inventory for the implementation scan (BI-1A1EC5EC). Injectable so
   * tests need no filesystem, and so a deployment with no source checkout simply
   * returns nothing rather than failing to file.
   */
  listRepoFiles?: () => Promise<string[]>;
  /**
   * Meaning-based duplicate search (BI-3722E9A1). Injectable so tests need
   * no vector store and no embedding model, and so an install without them files
   * normally with a lexical-only advisory.
   */
  searchSimilarItems?: (query: string) => Promise<{
    status: string;
    reason?: string;
    results: Array<{ entityId: string; title: string; score: number }>;
  }>;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Stable, queryable, human-readable provenance marker embedded in the body. */
export function backlogOriginMarker(kind: string, id: string): string {
  return `[origin:${kind}:${id}]`;
}

/**
 * Repository-qualified origin id for a GitHub issue: `owner/repo#<number>`,
 * lowercased because GitHub repository names are case-insensitive. The issue
 * number alone is not an identity: two repositories reuse every number
 * (BI-952F08BA, spec §6.1).
 */
export function qualifiedIssueOriginId(repository: string, number: number | string): string {
  return `${repository.trim().toLowerCase()}#${String(number).trim()}`;
}

const GITHUB_ISSUE_URL = /https?:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/issues\/(\d+)/gi;

/** Parse a GitHub issue URL into its lowercased repository and number. */
export function parseGithubIssueUrl(url: string | null | undefined): { repository: string; number: number } | null {
  if (!url) return null;
  const match = new RegExp(GITHUB_ISSUE_URL.source, "i").exec(url.trim());
  if (!match) return null;
  return { repository: `${match[1]}/${match[2]}`.toLowerCase(), number: Number(match[3]) };
}

/**
 * The repositories a legacy (unqualified) intake's stored source links name
 * for this issue number. Read from the item body (where composeInboundBody
 * wrote the URL) and from any `source.url` an intake_origin payload carries.
 */
function storedIssueRepositories(texts: Array<string | null | undefined>, issueNumber: string): Set<string> {
  const repos = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(GITHUB_ISSUE_URL)) {
      if (match[3] === issueNumber) repos.add(`${match[1]}/${match[2]}`.toLowerCase());
    }
  }
  return repos;
}

export function generateBacklogItemId(prefix?: string): string {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const trimmed = prefix?.trim();
  return trimmed ? `BI-${trimmed.toUpperCase()}-${suffix}` : `BI-${suffix}`;
}

/** Append the marker on its own line, idempotently (never double-appends). */
export function composeIngestBody(
  body: string | null | undefined,
  marker: string | null,
): string | null {
  const base = typeof body === "string" && body.trim() ? body.trimEnd() : null;
  if (!marker) return base;
  if (base && base.includes(marker)) return base;
  return base ? `${base}\n\n${marker}` : marker;
}

/**
 * Map an ImprovementProposal category to a backlog workType. Mirrors the
 * create_backlog_item required-field contract so auto-filed items are never
 * workType-less (the historical prioritizeImprovement defect).
 */
export function improvementCategoryToWorkType(
  category: string | null | undefined,
): BacklogWorkType {
  const c = (category ?? "").toLowerCase();
  if (c === "skill") return "skill";
  if (c.includes("bug") || c.includes("defect") || c.includes("error") || c.includes("broken")) {
    return "bug";
  }
  if (c.includes("doc")) return "doc";
  if (c.includes("tool")) return "tool";
  if (c.includes("refactor") || c.includes("debt") || c.includes("cleanup")) return "refactor";
  if (c.includes("chore")) return "chore";
  return "feature";
}

/**
 * Validate an ingest request against the canonical enums and the same
 * status/triageOutcome pairing rules create_backlog_item enforces. Returns an
 * error message, or null when valid. Single validation authority for both the
 * MCP boundary and queue callers (EA review: no duplicated validation path).
 */
export function validateIngestInput(input: {
  workType?: string;
  source?: string;
  status?: string;
  triageOutcome?: string | null;
  effortSize?: string | null;
  scopeKind?: string | null;
  organizationId?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
  digitalProductId?: string | null;
  demandStage?: string | null;
}): string | null {
  if (!input.workType || !(BACKLOG_WORK_TYPE_VALUES as readonly string[]).includes(input.workType)) {
    return `workType is required (one of: ${BACKLOG_WORK_TYPE_VALUES.join(" | ")}).`;
  }
  if (!input.source || !(BACKLOG_SOURCE_VALUES as readonly string[]).includes(input.source)) {
    return `source must be one of: ${BACKLOG_SOURCE_VALUES.join(" | ")}.`;
  }
  const status = input.status ?? "triaging";
  const triageOutcome = input.triageOutcome ?? null;
  if (status !== "triaging" && !triageOutcome) {
    return "triageOutcome is required when status is not 'triaging'.";
  }
  if (status === "triaging" && triageOutcome) {
    return "triageOutcome must not be set when status='triaging'.";
  }
  if (triageOutcome === "build" && !input.effortSize) {
    return "effortSize is required when triageOutcome='build'.";
  }
  if (input.scopeKind && !(BACKLOG_SCOPE_KIND_VALUES as readonly string[]).includes(input.scopeKind)) {
    return `scopeKind must be one of: ${BACKLOG_SCOPE_KIND_VALUES.join(" | ")}.`;
  }
  const narrowTargets = [
    input.productLineId,
    input.businessProductId,
    input.digitalProductId,
  ].filter((value) => Boolean(value?.trim()));
  if (narrowTargets.length > 1) {
    return "Choose one product-management target: product line, business product, or digital product.";
  }
  if (
    (input.productLineId || input.businessProductId) &&
    !input.organizationId
  ) {
    return "organizationId is required for business product demand.";
  }
  if (
    input.demandStage !== undefined &&
    input.demandStage !== null &&
    !(DEMAND_STAGE_VALUES as readonly string[]).includes(input.demandStage)
  ) {
    return `demandStage must be one of: ${DEMAND_STAGE_VALUES.join(" | ")}.`;
  }
  if (
    narrowTargets.length > 0 &&
    input.demandStage !== undefined &&
    input.demandStage !== null &&
    input.demandStage !== "raw"
  ) {
    return "New scoped product demand must enter at raw.";
  }
  return null;
}

function cleanStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

// ─── Default knowledge indexing (fire-and-forget) ─────────────────────────────

async function defaultSearchSimilarItems(query: string) {
  const { searchPlatformKnowledge } = await import("@/lib/semantic-memory");
  const found = await searchPlatformKnowledge({ query, entityType: "backlog", limit: 8 });
  return {
    status: found.status,
    reason: "reason" in found ? found.reason : undefined,
    results: found.results.map((r) => ({
      entityId: r.entityId,
      title: r.title,
      score: r.score,
    })),
  };
}

function defaultIndexKnowledge(args: { entityId: string; title: string; content: string }): void {
  import("@/lib/semantic-memory")
    .then(({ storePlatformKnowledge }) =>
      storePlatformKnowledge({
        entityId: args.entityId,
        entityType: "backlog",
        title: args.title,
        content: args.content,
      }),
    )
    .catch(() => {});
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * File (or dedupe) a BacklogItem for portal-dev work. Every detector/queue and
 * create_backlog_item route through here so the backlog is the single source of
 * truth for the work while the origin record stays the evidence.
 *
 * Throws on invalid input (the canonical validation authority). The MCP boundary
 * (create_backlog_item) catches and maps to its structured {success:false}; queue
 * callers may let it throw.
 *
 * Dedup: when `origin` is supplied and a non-terminal item already carries its
 * marker, the existing item's occurrenceCount is bumped, an intake_origin
 * activity row is appended, and no duplicate is created.
 *
 * Reconciled origins (`reconcile` set — a source that re-delivers the same
 * record on every poll) instead match their one canonical item in ANY status,
 * never bump counts or change status, and append an intake_origin event only
 * when the source itself changed. See `reconcileOrigin` (BI-952F08BA).
 */
export async function ingestBacklogItem(
  input: BacklogIngestInput,
  deps: BacklogIngestDeps = {},
): Promise<BacklogIngestResult> {
  const store = deps.store ?? (defaultPrisma as unknown as IngestBacklogStore);
  const indexKnowledge = deps.indexKnowledge ?? defaultIndexKnowledge;

  const status = input.status ?? "triaging";
  const triageOutcome = input.triageOutcome ?? null;
  const effortSize = input.effortSize ?? null;

  const validationError = validateIngestInput({
    workType: input.workType,
    source: input.source,
    status,
    triageOutcome,
    effortSize,
    scopeKind: input.scopeKind ?? null,
    organizationId: input.organizationId ?? null,
    productLineId: input.productLineId ?? null,
    businessProductId: input.businessProductId ?? null,
    digitalProductId: input.digitalProductId ?? null,
    demandStage: input.demandStage,
  });
  if (validationError) {
    throw new Error(`[backlog-ingest] ${validationError}`);
  }

  const marker = input.origin ? backlogOriginMarker(input.origin.kind, input.origin.id) : null;

  // Provenance audit row (canonical record; the body marker is only a bridge).
  const writeOriginActivity = async (backlogCuid: string, created: boolean): Promise<void> => {
    if (!input.origin) return;
    await store.backlogItemActivity.create({
      data: {
        backlogItemId: backlogCuid,
        kind: "intake_origin",
        summary: created
          ? `Filed from ${input.origin.kind} ${input.origin.id}`
          : `Recurrence from ${input.origin.kind} ${input.origin.id}`,
        payload: {
          origin: input.origin,
          created,
          createdBy: "backlog-ingest",
          ...(input.reconcile ? { source: sourceSnapshot(input.reconcile) } : {}),
        },
        ...(input.submittedById ? { recordedById: input.submittedById } : {}),
        ...(input.agentId ? { recordedByAgentId: input.agentId } : {}),
      },
    });
  };

  // Reconciled origins (opt-in, spec §6.1): match across EVERY status, never
  // bump counts, never reopen, record only real source changes.
  if (input.origin && input.reconcile) {
    const reconciled = await reconcileOrigin(store, input.origin, input.reconcile, {
      submittedById: input.submittedById ?? null,
      agentId: input.agentId ?? null,
    });
    if (reconciled) return reconciled;
  }

  // Dedup by origin marker against non-terminal items.
  if (marker && !input.reconcile) {
    const existing = await store.backlogItem.findFirst({
      where: { body: { contains: marker }, status: { notIn: ["done", "deferred", "retired"] } },
      select: { id: true, itemId: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      await store.backlogItem.update({
        where: { id: existing.id },
        data: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date() },
      });
      await writeOriginActivity(existing.id, false);
      // A recurrence of a known origin needs no scan — the item already exists
      // and was already advised when it was first filed.
      return {
        itemId: existing.itemId,
        id: existing.id,
        created: false,
        outcome: "recurred",
        implementationCandidates: [],
      };
    }
  }

  // Resolve epic semantic id → cuid FK.
  let epicCuid: string | null = null;
  if (input.epicId && input.epicId.trim()) {
    const raw = input.epicId.trim();
    const epicRow = await store.epic.findFirst({
      where: { OR: [{ epicId: raw }, { id: raw }] },
      select: { id: true },
    });
    epicCuid = epicRow?.id ?? null;
  }

  const itemId = input.itemId?.trim() || generateBacklogItemId(input.itemIdPrefix);
  const body = composeIngestBody(input.body, marker);
  const demandStage = initialDemandStageForInput(input);

  const item = await store.backlogItem.create({
    data: {
      itemId,
      title: input.title || "Untitled",
      type: input.type ?? "portfolio",
      status,
      workType: input.workType,
      source: input.source,
      lastSeenAt: new Date(),
      ...(body !== null ? { body } : {}),
      ...(triageOutcome ? { triageOutcome } : {}),
      ...(input.proposedOutcome ? { proposedOutcome: input.proposedOutcome } : {}),
      ...(effortSize ? { effortSize } : {}),
      ...(typeof input.priority === "number" ? { priority: input.priority } : {}),
      ...(epicCuid ? { epicId: epicCuid } : {}),
      ...(input.digitalProductId ? { digitalProductId: input.digitalProductId } : {}),
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input.productLineId ? { productLineId: input.productLineId } : {}),
      ...(input.businessProductId ? { businessProductId: input.businessProductId } : {}),
      ...(demandStage ? { demandStage } : {}),
      ...(input.taxonomyNodeId ? { taxonomyNodeId: input.taxonomyNodeId } : {}),
      ...(input.submittedById ? { submittedById: input.submittedById } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.scopeKind ? { scopeKind: input.scopeKind } : {}),
      ...(input.archetypeCategories ? { archetypeCategories: cleanStringArray(input.archetypeCategories) } : {}),
      ...(input.archetypeIds ? { archetypeIds: cleanStringArray(input.archetypeIds) } : {}),
      ...(input.scopeRationale && input.scopeRationale.trim() ? { scopeRationale: input.scopeRationale.trim() } : {}),
      ...(input.lifecycleTags ? { lifecycleTags: cleanStringArray(input.lifecycleTags) } : {}),
    },
  });

  await writeOriginActivity(item.id, true);
  if (demandStage === "raw") {
    await store.backlogItemActivity.create({
      data: {
        backlogItemId: item.id,
        kind: "demand_classified",
        summary: "New scoped product demand entered intake",
        payload: { from: "unclassified", to: "raw", deterministic: true },
        ...(input.submittedById
          ? { recordedById: input.submittedById }
          : {}),
        ...(input.agentId
          ? { recordedByAgentId: input.agentId }
          : {}),
      },
    });
  }
  indexKnowledge({ entityId: item.itemId, title: input.title, content: input.body ?? "" });

  // ─── Implementation scan (BI-1A1EC5EC) ──────────────────────────────────────
  // Runs AFTER the create, deliberately. It is advisory, and a filing surface
  // that could fail because a heuristic threw would be a worse defect than the
  // one being fixed. Any error is swallowed to an empty result.
  //
  // Recorded as an activity row so the advice survives the tool response — the
  // whole failure mode this addresses is a check whose output vanished.
  let implementationCandidates: ImplementationCandidate[] = [];
  try {
    const files = deps.listRepoFiles ? await deps.listRepoFiles() : await defaultListRepoFiles();
    if (files.length > 0) {
      implementationCandidates = findImplementationCandidates(input.title, files, {
        workType: input.workType,
      });
    }
    if (implementationCandidates.length > 0) {
      await store.backlogItemActivity.create({
        data: {
          backlogItemId: item.id,
          kind: "intake_origin",
          summary: `Possible existing implementation: ${implementationCandidates[0].path}`,
          payload: {
            createdBy: "implementation-scan",
            advisory: true,
            candidates: implementationCandidates,
          },
          ...(input.submittedById ? { recordedById: input.submittedById } : {}),
          ...(input.agentId ? { recordedByAgentId: input.agentId } : {}),
        },
      });
    }
  } catch {
    implementationCandidates = [];
  }

  // BI-3722E9A1. `findDuplicateCandidates` existed as an opt-in tool that
  // nothing called, and this tool's own description asked the filer to
  // remember to sweep first. That is the shape this install has twice paid
  // to remove: the queued-claim resumer (13 of 41 sessions remembered) and
  // the WWMD ratification no surface offered. Measured cost on 2026-09-12:
  // one subsystem took six items in a day from two sessions, including a
  // full duplicate diagnosis of a defect already measured in an open PR.
  //
  // Advisory, never blocking. A similarity score cannot tell the same
  // defect from an adjacent one, so it must not decide whether work exists.
  // Errors swallow to empty: a filing must never fail because the pool
  // could not be read.
  let duplicateCandidates: FilingDuplicateCandidate[] = [];
  let duplicateSemanticUnavailable: string | null = null;
  try {
    const pool = store.backlogItem.findMany
      ? await store.backlogItem.findMany({
        where: { status: { in: DUPLICATE_POOL_STATUSES } },
        select: { itemId: true, title: true, body: true, status: true },
        orderBy: { createdAt: "desc" },
        take: DUPLICATE_POOL_LIMIT,
      })
      : [];
    const statusById = new Map(pool.map((p) => [p.itemId, p.status]));
    const lexical = findDuplicateCandidates(
      { itemId: item.itemId, title: input.title, body: input.body ?? null },
      pool,
      FILING_DUPLICATE_THRESHOLD,
    ).map((c) => ({
      ...c,
      status: statusById.get(c.itemId) ?? "unknown",
      matchedBy: "lexical" as const,
    }));

    // The lexical score compares words. The pair that motivated this
    // feature does not share enough of them: one item is written about
    // memory fencing a running gate, the other about load average not
    // being CPU, and they are the same subsystem. Meaning-based search is
    // what closes that gap, over the index THIS front door already writes.
    const semantic = deps.searchSimilarItems ?? defaultSearchSimilarItems;
    const found = await semantic(`${input.title}\n\n${input.body ?? ""}`);
    if (found.status !== "ok") {
      duplicateSemanticUnavailable = found.reason ?? found.status;
    }
    const semanticHits = found.results
      .filter((r) => r.entityId && r.entityId !== item.itemId)
      .map((r) => ({
        itemId: r.entityId,
        title: r.title,
        similarity: Math.round(r.score * 1000) / 1000,
        status: statusById.get(r.entityId) ?? "unknown",
        matchedBy: "semantic" as const,
      }));

    const byId = new Map<string, FilingDuplicateCandidate>();
    for (const c of [...lexical, ...semanticHits]) {
      const seen = byId.get(c.itemId);
      if (!seen) {
        byId.set(c.itemId, c);
        continue;
      }
      // Found by both signals: keep the stronger score and say so, because
      // agreement between two independent signals is worth the filer's eye.
      byId.set(c.itemId, {
        ...seen,
        similarity: Math.max(seen.similarity, c.similarity),
        matchedBy: "both",
      });
    }
    duplicateCandidates = [...byId.values()]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, FILING_DUPLICATE_LIMIT);
  } catch {
    duplicateCandidates = [];
  }

  return {
    itemId: item.itemId,
    id: item.id,
    created: true,
    outcome: "created",
    implementationCandidates,
    duplicateCandidates,
    duplicateSemanticUnavailable,
  };
}

// ─── Origin reconciliation (BI-952F08BA, spec §6.1) ───────────────────────────

/** What an intake_origin payload records about the source at that moment. */
function sourceSnapshot(r: OriginReconciliation): Record<string, string | null> {
  return { repository: r.repository, url: r.sourceUrl, state: r.state, fingerprint: r.fingerprint };
}

type CandidateRow = { id?: string; itemId: string; body: string | null; status: string };

interface OriginHistory {
  /** Newest recorded source snapshot, or null when none was ever recorded. */
  latest: { fingerprint: string; state: string | null } | null;
  /** Whether a legacy → qualified mapping has already been recorded. */
  mapped: boolean;
  /** Source URLs any intake_origin payload recorded. */
  urls: string[];
}

function readOriginHistory(rows: Array<{ payload: unknown }>, qualifiedId: string): OriginHistory {
  let latest: OriginHistory["latest"] = null;
  let mapped = false;
  const urls: string[] = [];
  // Rows arrive newest first.
  for (const row of rows) {
    const payload = isRecord(row.payload) ? row.payload : null;
    if (!payload) continue;
    const source = isRecord(payload.source) ? payload.source : null;
    if (source) {
      if (typeof source.url === "string") urls.push(source.url);
      if (!latest && typeof source.fingerprint === "string") {
        latest = { fingerprint: source.fingerprint, state: typeof source.state === "string" ? source.state : null };
      }
    }
    const mapping = isRecord(payload.mapping) ? payload.mapping : null;
    const to = mapping && isRecord(mapping.to) ? mapping.to : null;
    if (to && to.id === qualifiedId) mapped = true;
  }
  return { latest, mapped, urls };
}

function changeKind(fromState: string | null, toState: string): "reopened" | "closed" | "edited" {
  if (fromState && fromState !== toState) {
    if (toState === "open") return "reopened";
    if (toState === "closed") return "closed";
  }
  return "edited";
}

/**
 * Resolve a reconciled origin to its one canonical item, or to a review stop.
 * Returns null only when no item claims the origin, so the caller creates one.
 *
 * Dual-read: the qualified marker matches by itself; a legacy unqualified
 * marker is accepted only when the item's stored source URL names the same
 * repository. An unresolvable legacy item, or more than one claimant, stops
 * for review — no work is created and no status changes.
 */
async function reconcileOrigin(
  store: IngestBacklogStore,
  origin: { kind: string; id: string },
  reconcile: OriginReconciliation,
  actor: { submittedById: string | null; agentId: string | null },
): Promise<BacklogIngestResult | null> {
  const findItems = store.backlogItem.findMany;
  const findActivities = store.backlogItemActivity.findMany;
  if (!findItems || !findActivities) {
    throw new Error("[backlog-ingest] origin reconciliation needs backlogItem.findMany and backlogItemActivity.findMany.");
  }
  const select = { id: true, itemId: true, body: true, status: true };
  const history = async (id: string) => readOriginHistory(
    await findActivities({
      where: { backlogItemId: id, kind: "intake_origin" },
      select: { payload: true },
      orderBy: { recordedAt: "desc" },
    }),
    origin.id,
  );

  const qualifiedMarker = backlogOriginMarker(origin.kind, origin.id);
  const qualified = (await findItems({ where: { body: { contains: qualifiedMarker } }, select })) as CandidateRow[];

  const accepted = new Map<string, { row: CandidateRow; viaLegacy: boolean }>();
  for (const row of qualified) if (row.id) accepted.set(row.id, { row, viaLegacy: false });

  const unresolved: CandidateRow[] = [];
  const repository = reconcile.repository.toLowerCase();
  if (reconcile.legacyId) {
    const legacyMarker = backlogOriginMarker(origin.kind, reconcile.legacyId);
    const legacy = (await findItems({ where: { body: { contains: legacyMarker } }, select })) as CandidateRow[];
    for (const row of legacy) {
      if (!row.id || accepted.has(row.id)) continue;
      const repos = storedIssueRepositories([row.body, ...(await history(row.id)).urls], reconcile.legacyId);
      if (repos.size === 1 && repos.has(repository)) accepted.set(row.id, { row, viaLegacy: true });
      else if (repos.size !== 1) unresolved.push(row);
      // Exactly one OTHER repository: a different issue that shares the number.
    }
  }

  if (accepted.size > 1 || unresolved.length > 0) {
    return {
      itemId: "",
      id: "",
      created: false,
      outcome: "needs-review",
      reviewCandidates: [...[...accepted.values()].map((a) => a.row.itemId), ...unresolved.map((r) => r.itemId)],
      implementationCandidates: [],
    };
  }
  const match = [...accepted.values()][0];
  if (!match?.row.id) return null;

  const itemCuid = match.row.id;
  const past = await history(itemCuid);
  const snapshot = sourceSnapshot(reconcile);
  const recordedBy = {
    ...(actor.submittedById ? { recordedById: actor.submittedById } : {}),
    ...(actor.agentId ? { recordedByAgentId: actor.agentId } : {}),
  };

  if (match.viaLegacy && !past.mapped) {
    // Audited, once: the legacy identity now resolves to the qualified one.
    // The snapshot doubles as the change baseline for a legacy item.
    await store.backlogItemActivity.create({
      data: {
        backlogItemId: itemCuid,
        kind: "intake_origin",
        summary: `Origin ${origin.kind} ${reconcile.legacyId} resolved to ${origin.id}`,
        payload: {
          origin,
          created: false,
          createdBy: "backlog-ingest",
          mapping: { from: { kind: origin.kind, id: reconcile.legacyId }, to: origin, resolvedBy: "stored-source-url" },
          source: snapshot,
        },
        ...recordedBy,
      },
    });
  }

  let outcome: BacklogIngestOutcome = "unchanged";
  if (past.latest && past.latest.fingerprint !== reconcile.fingerprint) {
    const kind = changeKind(past.latest.state, reconcile.state);
    await store.backlogItemActivity.create({
      data: {
        backlogItemId: itemCuid,
        kind: "intake_origin",
        summary: `Source ${kind}: ${origin.kind} ${origin.id}`,
        payload: {
          origin,
          created: false,
          createdBy: "backlog-ingest",
          change: { kind, fromState: past.latest.state, toState: reconcile.state },
          source: snapshot,
        },
        ...recordedBy,
      },
    });
    outcome = "changed";
  }

  return {
    itemId: match.row.itemId,
    id: itemCuid,
    created: false,
    outcome,
    implementationCandidates: [],
  };
}
